import { apiBaseUrl } from "./api";
import { isMobileHost } from "./mobile-bridge";
import {
  getMobileState,
  getMobileAccountId,
  getMobileProfileId,
  mobileIdentityRefreshing,
  mobileRestricted,
  subscribeMobile,
} from "./mobile-runtime";

const capabilities = [
  "privacy",
  "analytics",
  "ads.gam",
  "ads.webview",
  "ads.banner",
  "ads.interstitial",
  "notifications",
  "session.reset",
  "share",
  "media.pip",
  "upload.recovery",
  "upload.sources",
];
type AdEvent = "none" | "ad_request" | "ad_loaded" | "ad_failed" | "ad_shown" | "ad_dismissed";
let adEvent: AdEvent = "none";
let errorCode: number | null = null;
let failure: "NO_FILL" | "TIMEOUT" | "FAILED" | null = null;
let lastAttempt = 0,
  binding: string | null = null,
  reporting = false;
let consentVersion: number | null = null,
  consentEpoch = 0,
  consentLookup: string | null = null;
export const mobileDiagnosticsEnabled = () => consentVersion !== null;
function context() {
  const state = getMobileState(),
    account = getMobileAccountId(),
    profile = getMobileProfileId();
  if (
    !isMobileHost() ||
    !account ||
    !profile ||
    !state.info ||
    !state.config?.analytics.enabled ||
    mobileRestricted() ||
    mobileIdentityRefreshing()
  )
    return null;
  return {
    state,
    account,
    profile,
    installation: state.info.installationId,
    key: account + ":" + state.info.installationId,
    headers: { "x-ayin-expected-account": account, "x-ayin-viewer-profile": profile },
  };
}
function bind(key: string) {
  if (binding !== key) {
    binding = key;
    lastAttempt = 0;
    consentVersion = null;
    consentLookup = null;
    consentEpoch++;
  }
}
async function readConsent() {
  const current = context();
  if (!current) throw new Error("DIAGNOSTICS_UNAVAILABLE");
  bind(current.key);
  const epoch = consentEpoch;
  consentLookup = current.key;
  const response = await fetch(apiBaseUrl + "/mobile/diagnostics/consent/" + current.installation, {
    credentials: "include",
    cache: "no-store",
    headers: current.headers,
  });
  if (!response.ok) throw new Error("DIAGNOSTICS_UNAVAILABLE");
  const value: unknown = await response.json();
  if (
    !value ||
    typeof value !== "object" ||
    !("consentVersion" in value) ||
    typeof value.consentVersion !== "number" ||
    !Number.isSafeInteger(value.consentVersion) ||
    value.consentVersion < 0 ||
    value.consentVersion > 1_000_000_000 ||
    !("enabled" in value) ||
    typeof value.enabled !== "boolean" ||
    (value.enabled && value.consentVersion === 0) ||
    epoch !== consentEpoch ||
    context()?.key !== current.key
  )
    throw new Error("DIAGNOSTICS_INTERRUPTED");
  consentVersion = value.enabled ? value.consentVersion : null;
  return { current, expectedConsentVersion: value.consentVersion, epoch };
}
export async function enableMobileDiagnostics(): Promise<void> {
  const { current, expectedConsentVersion, epoch } = await readConsent();
  if (epoch !== consentEpoch) throw new Error("DIAGNOSTICS_INTERRUPTED");
  const response = await fetch(apiBaseUrl + "/mobile/diagnostics/consent", {
    method: "PUT",
    credentials: "include",
    headers: { ...current.headers, "content-type": "application/json" },
    body: JSON.stringify({
      installationId: current.installation,
      enabled: true,
      expectedConsentVersion,
    }),
  });
  const value = response.ok ? await response.json() : null;
  if (
    epoch !== consentEpoch ||
    context()?.key !== current.key ||
    !Number.isSafeInteger(value?.consentVersion) ||
    value.consentVersion < 1 ||
    value.consentVersion > 1_000_000_000 ||
    value?.enabled !== true
  )
    throw new Error("DIAGNOSTICS_UNAVAILABLE");
  consentVersion = value.consentVersion;
  await sendMobileDiagnostics();
}
export async function disableMobileDiagnostics(): Promise<void> {
  const state = getMobileState(),
    account = getMobileAccountId();
  consentEpoch++;
  consentVersion = null;
  if (!account || !state.info) return;
  consentLookup = account + ":" + state.info.installationId;
  const response = await fetch(apiBaseUrl + "/mobile/diagnostics/" + state.info.installationId, {
    method: "DELETE",
    credentials: "include",
    headers: { "x-ayin-expected-account": account },
  });
  if (!response.ok) throw new Error("DIAGNOSTICS_WITHDRAWAL_UNCONFIRMED");
}

export function resetMobileAdDiagnostic() {
  adEvent = "none";
  errorCode = null;
  failure = null;
}
export function recordMobileAdDiagnostic(input: unknown): void {
  if (!input || typeof input !== "object") return;
  const value = input as Record<string, unknown>;
  const event = (
    {
      "ad.request": "ad_request",
      "ad.loaded": "ad_loaded",
      "ad.failed": "ad_failed",
      "ad.shown": "ad_shown",
      "ad.dismissed": "ad_dismissed",
    } as Record<string, AdEvent>
  )[String(value.type)];
  if (!event) return;
  adEvent = event;
  errorCode = null;
  failure = null;
  if (event === "ad_failed") {
    const numeric =
      typeof value.code === "number"
        ? value.code
        : typeof value.code === "string" && /^-?\d{1,4}$/.test(value.code)
          ? Number(value.code)
          : null;
    errorCode =
      numeric !== null && Number.isInteger(numeric) && numeric >= 0 && numeric <= 9999
        ? numeric
        : null;
    failure =
      numeric === -1 || value.code === "timeout"
        ? "TIMEOUT"
        : numeric === (getMobileState().info?.platform === "ios" ? 1 : 3)
          ? "NO_FILL"
          : "FAILED";
  }
}
/** Safe local view: excludes unit IDs, user IDs, messages, token values and URLs. */
export function getMobileDiagnosticSnapshot() {
  const state = getMobileState();
  const status =
    state.error || !state.config
      ? "CONFIG_UNAVAILABLE"
      : state.info?.runtimeAllowed === false || !state.info?.configured.ads
        ? "UNSUPPORTED"
        : mobileRestricted() || mobileIdentityRefreshing()
          ? "RESTRICTED"
          : !state.config.ads.enabled || !state.config.ads.platforms[state.info.platform].enabled
            ? "DISABLED"
            : !state.canRequestAds
              ? "CONSENT_REQUIRED"
              : (failure ?? "READY");
  return {
    platform: state.info?.platform ?? "android",
    appVersion: state.info?.appVersion ?? "0.0.0",
    bridgeVersion: 1 as const,
    capabilities: isMobileHost()
      ? window
          .AyinMobile!.capabilities.filter((value) => capabilities.includes(value))
          .slice(0, capabilities.length)
      : [],
    configRevision: state.configRevision,
    configAppliedAt: state.configAppliedAt,
    lastConfigCheckAt: state.lastConfigCheckAt,
    ads: { status, lastEvent: adEvent, errorCode },
    firebaseConfigured: state.info?.configured.firebase === true,
    runtimeAllowed: state.info?.runtimeAllowed !== false,
  };
}
export async function sendMobileDiagnostics(): Promise<boolean> {
  const state = getMobileState(),
    account = getMobileAccountId(),
    profile = getMobileProfileId();
  if (
    !isMobileHost() ||
    !account ||
    !profile ||
    !state.info ||
    consentVersion === null ||
    !state.config?.analytics.enabled ||
    mobileRestricted() ||
    mobileIdentityRefreshing() ||
    reporting
  )
    return false;
  const key = account + ":" + state.info.installationId;
  if (binding !== key) {
    bind(key);
    return false;
  }
  if (Date.now() - lastAttempt < 60_000) return false;
  lastAttempt = Date.now();
  reporting = true;
  try {
    const response = await fetch(apiBaseUrl + "/mobile/diagnostics", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-ayin-expected-account": account,
        "x-ayin-viewer-profile": profile,
        "x-ayin-diagnostics-consent-version": String(consentVersion),
      },
      body: JSON.stringify({
        ...getMobileDiagnosticSnapshot(),
        installationId: state.info.installationId,
        diagnosticsConsent: true,
      }),
    });
    return response.ok && getMobileAccountId() === account && consentVersion !== null;
  } catch {
    return false;
  } finally {
    reporting = false;
  }
}
export function installMobileDiagnosticsLifecycle(signal: AbortSignal): () => void {
  const changed = () => {
    const state = getMobileState(),
      account = getMobileAccountId();
    const key = account && state.info ? account + ":" + state.info.installationId : null;
    if (key) {
      bind(key);
      if (context() && consentLookup !== key)
        void readConsent()
          .then(() => sendMobileDiagnostics())
          .catch(() => undefined);
      else if (consentVersion !== null) void sendMobileDiagnostics();
    }
    if (!account) {
      binding = null;
      consentVersion = null;
      consentEpoch++;
      consentLookup = null;
      resetMobileAdDiagnostic();
    }
  };
  const native = (event: Event) => {
    recordMobileAdDiagnostic((event as CustomEvent).detail);
    changed();
  };
  const unsubscribe = subscribeMobile(changed);
  const timer = setInterval(() => {
    if (document.visibilityState === "visible") changed();
  }, 60_000);
  window.addEventListener("ayin:mobile-event", native);
  const stop = () => {
    unsubscribe();
    clearInterval(timer);
    window.removeEventListener("ayin:mobile-event", native);
  };
  signal.addEventListener("abort", stop, { once: true });
  return () => {
    signal.removeEventListener("abort", stop);
    stop();
  };
}
