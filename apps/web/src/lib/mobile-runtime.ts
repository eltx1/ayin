"use client";
import { apiBaseUrl } from "./api";
import {
  isMobileHost,
  mobileScreenName,
  requestMobile,
  supportsMobile,
  validMobileAnalytics,
  type MobileEventName,
  type MobileInfo,
} from "./mobile-bridge";
import {
  emptyNotificationPreferences,
  parseMobileConfig,
  mobileConfigForCapabilities,
  type MobileConfig,
  type NotificationPreferences,
} from "./mobile-config";
export interface MobileState {
  adultAffirmed: boolean;
  ready: boolean;
  config: MobileConfig | null;
  info: MobileInfo | null;
  analyticsConsent: boolean;
  canRequestAds: boolean;
  preferences: NotificationPreferences;
  notificationsEnabled: boolean;
  error: boolean;
}
const initial: MobileState = {
  adultAffirmed: false,
  ready: false,
  config: null,
  info: null,
  analyticsConsent: false,
  canRequestAds: false,
  preferences: emptyNotificationPreferences(),
  notificationsEnabled: false,
  error: false,
};
let state = initial;
let generation = 0;
let accountId: string | null = null;
let identityEstablished = false;
let identityRefreshing = false;
export const getMobileAccountId = () => accountId;
let childProfile = true;
let privacyCheckedAccount: string | null | undefined = undefined;
export function mobileRestricted(): boolean {
  if (typeof window === "undefined") return true;
  return (
    state.info?.runtimeAllowed === false ||
    !state.adultAffirmed ||
    childProfile ||
    /(?:^|\/)kids(?:\/|$)/.test(window.location.pathname) ||
    new URLSearchParams(window.location.search).get("kids") === "1" ||
    state.config?.ads.audience !== "general"
  );
}
const listeners = new Set<() => void>();
export const getMobileState = () => state;
export const getMobileServerState = () => initial;
export const subscribeMobile = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function publish(patch: Partial<MobileState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
const consentKey = "ayin.mobile.analytics.consent.v1";
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function storedConsent(id: string | null) {
  try {
    return localStorage.getItem(consentKey + ":" + (id ?? "guest")) === "yes";
  } catch {
    return false;
  }
}
const notificationOptOut = new Set<string>();
function notificationsLocallyDisabled(id: string) {
  if (notificationOptOut.has(id)) return true;
  try {
    return localStorage.getItem("ayin.mobile.notifications.off.v1:" + id) === "yes";
  } catch {
    return false;
  }
}
function rememberNotificationOptOut(id: string, disabled: boolean) {
  if (disabled) notificationOptOut.add(id);
  else notificationOptOut.delete(id);
  try {
    localStorage.setItem("ayin.mobile.notifications.off.v1:" + id, disabled ? "yes" : "no");
  } catch {
    /* This session still fails closed. */
  }
}
export async function initializeMobile(signal: AbortSignal): Promise<void> {
  if (!isMobileHost()) return;
  try {
    const response = await fetch(apiBaseUrl + "/mobile/config", { cache: "no-store", signal });
    if (!response.ok) throw new Error("MOBILE_CONFIG_UNAVAILABLE");
    const config = mobileConfigForCapabilities(
      parseMobileConfig(await response.json()),
      supportsMobile("ads.gam") ? ["ads.gam"] : [],
    );
    signal.throwIfAborted();
    const info = await requestMobile<MobileInfo>("runtime.configure", { config });
    signal.throwIfAborted();
    if (
      !info ||
      !["ios", "android"].includes(info.platform) ||
      !uuid.test(info.installationId) ||
      !/^\d+\.\d+\.\d+$/.test(info.appVersion) ||
      typeof info.configured?.firebase !== "boolean" ||
      typeof info.configured?.ads !== "boolean" ||
      (info.boundAccountId !== undefined &&
        info.boundAccountId !== null &&
        !uuid.test(info.boundAccountId))
    )
      throw new Error("MOBILE_INVALID_INFO");
    const consent = false; // Verify the active profile before honoring any previous opt-in.
    if (info.configured.firebase)
      await requestMobile("analytics.consent", { enabled: consent }).catch(() => undefined);
    signal.throwIfAborted();
    publish({ ready: true, info, config, analyticsConsent: consent, error: false });
    await refreshMobileAccount(signal);
  } catch {
    if (!signal.aborted) publish({ ready: true, error: true, canRequestAds: false });
  }
}
/** User ID and tokens stay transient. Server session guards reject in-flight requests after a switch. */
export async function refreshMobileAccount(signal?: AbortSignal): Promise<void> {
  if (!isMobileHost() || !state.info) return;
  const revision = ++generation;
  identityRefreshing = true;
  childProfile = true;
  await requestMobile("analytics.consent", { enabled: false }).catch(() => undefined);
  try {
    const response = await fetch(apiBaseUrl + "/auth/me", {
      credentials: "include",
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    if (signal?.aborted || revision !== generation) return;
    if (response.status !== 401 && !response.ok) throw new Error("IDENTITY_UNAVAILABLE");
    const identity: unknown = response.ok ? await response.json() : null;
    const next =
      identity &&
      typeof identity === "object" &&
      "account" in identity &&
      identity.account &&
      typeof identity.account === "object" &&
      "id" in identity.account &&
      typeof identity.account.id === "string" &&
      uuid.test(identity.account.id)
        ? identity.account.id
        : null;
    if (response.ok && !next) throw new Error("IDENTITY_INVALID");
    if (signal?.aborted || revision !== generation) return;
    childProfile =
      next !== null &&
      !(
        identity &&
        typeof identity === "object" &&
        "profile" in identity &&
        identity.profile &&
        typeof identity.profile === "object" &&
        "isKids" in identity.profile &&
        identity.profile.isKids === false
      );
    const switched = identityEstablished
      ? next !== accountId
      : next !== (state.info.boundAccountId ?? null);
    if (switched) {
      await requestMobile("session.reset");
      if (signal?.aborted || revision !== generation) return;
      privacyCheckedAccount = undefined;
      publish({
        notificationsEnabled: false,
        preferences: emptyNotificationPreferences(),
        canRequestAds: false,
      });
    }
    if (signal?.aborted || revision !== generation) return;
    accountId = next;
    identityEstablished = true;
    let adultAffirmed = false;
    try {
      adultAffirmed = localStorage.getItem("ayin.mobile.adult.v1:" + (next ?? "guest")) === "yes";
    } catch {
      /* Unknown age stays restricted. */
    }
    publish({ adultAffirmed });
    const analyticsConsent =
      storedConsent(next) &&
      state.info.configured.firebase &&
      state.config?.analytics.enabled === true &&
      !mobileRestricted();
    if (state.info.configured.firebase)
      await requestMobile("analytics.consent", { enabled: analyticsConsent }).catch(
        () => undefined,
      );
    if (revision !== generation || signal?.aborted) return;
    publish({ analyticsConsent });
    if (state.info.configured.firebase)
      await requestMobile("analytics.user", { id: analyticsConsent ? next : null }).catch(
        () => undefined,
      );
    if (
      !mobileRestricted() &&
      privacyCheckedAccount !== next &&
      state.config?.ads.enabled &&
      state.info.configured.ads
    ) {
      privacyCheckedAccount = next;
      void requestMobilePrivacy().catch(() => undefined);
    }
    if (
      next &&
      state.info.configured.firebase &&
      state.config?.notifications.enabled &&
      !notificationsLocallyDisabled(next)
    ) {
      const device = await fetch(apiBaseUrl + "/mobile/devices/" + state.info.installationId, {
        credentials: "include",
        cache: "no-store",
        headers: { "x-ayin-expected-account": next },
        ...(signal ? { signal } : {}),
      });
      if (revision !== generation || signal?.aborted) return;
      if (device.ok) {
        const record = await device.json();
        if (
          record?.enabled === true &&
          record.preferences &&
          Object.keys(emptyNotificationPreferences()).every(
            (key) => typeof record.preferences[key] === "boolean",
          )
        ) {
          publish({ notificationsEnabled: true, preferences: record.preferences });
          const token = await requestMobile<{ token: string | null }>("notifications.token", {
            accountId: next,
          });
          if (revision === generation && token?.token) await registerMobileToken(token.token);
        }
      }
    }
  } catch {
    if (!signal?.aborted && revision === generation) {
      accountId = null;
      childProfile = true;
      publish({ notificationsEnabled: false, canRequestAds: false });
      await requestMobile("session.reset").catch(() => undefined);
    }
  } finally {
    if (revision === generation) identityRefreshing = false;
  }
}
export async function detachMobileSession(): Promise<void> {
  if (!isMobileHost()) return;
  generation++;
  const previous = accountId,
    installation = state.info?.installationId;
  accountId = null;
  privacyCheckedAccount = undefined;
  childProfile = true;
  publish({
    adultAffirmed: false,
    analyticsConsent: false,
    notificationsEnabled: false,
    canRequestAds: false,
    preferences: emptyNotificationPreferences(),
  });
  // Reset immediately even if detach cannot reach the server. Backend binds deliveries to live auth sessions.
  await requestMobile("session.reset").catch(() => undefined);
  if (previous && installation)
    await fetch(apiBaseUrl + "/mobile/devices/" + installation, {
      method: "DELETE",
      credentials: "include",
      headers: { "x-ayin-expected-account": previous },
      keepalive: true,
    }).catch(() => undefined);
}
export async function setMobileAnalyticsConsent(enabled: boolean): Promise<void> {
  if (
    (enabled && mobileRestricted()) ||
    !state.config?.analytics.enabled ||
    !state.info?.configured.firebase ||
    !supportsMobile("analytics")
  )
    throw new Error("ANALYTICS_UNAVAILABLE");
  const consent = await requestMobile<{ enabled?: boolean }>("analytics.consent", { enabled });
  if (enabled && consent?.enabled === false) throw new Error("ANALYTICS_DISABLED");
  publish({ analyticsConsent: enabled });
  try {
    localStorage.setItem(consentKey + ":" + (accountId ?? "guest"), enabled ? "yes" : "no");
  } catch {
    /* Consent remains effective for this session. */
  }
  await requestMobile("analytics.user", { id: enabled ? accountId : null });
}
export function trackMobileEvent(
  name: MobileEventName,
  params: Record<string, string | number> = {},
): void {
  if (
    mobileRestricted() ||
    !state.analyticsConsent ||
    !state.config?.analytics.enabled ||
    !state.info?.configured.firebase ||
    !supportsMobile("analytics") ||
    !validMobileAnalytics(name, params)
  )
    return;
  void requestMobile("analytics.event", { name, params }).catch(() => undefined);
}
export async function setMobileAdultAffirmation(affirmed: boolean): Promise<void> {
  try {
    localStorage.setItem("ayin.mobile.adult.v1:" + (accountId ?? "guest"), affirmed ? "yes" : "no");
  } catch {
    /* Current session only. */
  }
  publish({
    adultAffirmed: affirmed,
    ...(affirmed ? {} : { canRequestAds: false, analyticsConsent: false }),
  });
  if (!affirmed) {
    await requestMobile("analytics.consent", { enabled: false });
    await requestMobile("analytics.user", { id: null });
    await requestMobile("ads.hideBanner");
  }
}
export async function requestMobilePrivacy(): Promise<void> {
  if (mobileRestricted() || !state.config || state.config.ads.audience === "unknown")
    throw new Error("AUDIENCE_NOT_CONFIGURED");
  const result = await requestMobile<{ canRequestAds: boolean }>(
    "privacy.request",
    { underAgeOfConsent: state.config.ads.audience === "children" },
    120000,
  );
  publish({ canRequestAds: result?.canRequestAds === true });
}
export function updateMobilePrivacy(canRequestAds: boolean) {
  publish({ canRequestAds });
}
/** Inventory selection is separate from consent: never fall back to web ads to evade a native refusal. */
export function nativeDisplayInventoryActive() {
  return Boolean(
    isMobileHost() &&
    state.info?.configured.ads &&
    state.config?.ads.enabled &&
    state.config.ads.platforms[state.info.platform].enabled &&
    supportsMobile("ads.banner"),
  );
}
export function nativeBannerEnabled() {
  return (
    nativeDisplayInventoryActive() &&
    state.config?.ads.banner.enabled === true &&
    !mobileRestricted()
  );
}
/** Called synchronously at navigation, never after asynchronous loading/consent completes. */
export function requestBrowseInterstitial(previous: string | null, next: string): void {
  const browse = (path: string) => ["home", "search", "channel"].includes(mobileScreenName(path));
  if (
    !previous ||
    previous === next ||
    !browse(previous) ||
    !browse(next) ||
    !state.ready ||
    !isMobileHost() ||
    !state.canRequestAds ||
    mobileRestricted() ||
    !supportsMobile("ads.interstitial") ||
    !state.info?.configured.ads ||
    !state.config?.ads.enabled ||
    !state.config.ads.interstitial.enabled ||
    !state.config.ads.platforms[state.info.platform].enabled ||
    (typeof document !== "undefined" && document.visibilityState !== "visible")
  )
    return;
  // The native service loads on the first transition and shows only on a later transition.
  void requestMobile("ads.interstitial", {
    placement: "browse_transition",
    naturalTransition: true,
  }).catch(() => undefined);
}
export async function registerMobileToken(
  token: string,
  preferences = state.preferences,
): Promise<void> {
  const info = state.info,
    expected = accountId,
    revision = generation;
  if (
    !info ||
    !expected ||
    state.info?.runtimeAllowed === false ||
    !state.config?.notifications.enabled ||
    !state.notificationsEnabled ||
    !/^[A-Za-z0-9_:.\-]{20,4096}$/.test(token)
  )
    return;
  const response = await fetch(apiBaseUrl + "/mobile/devices", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", "x-ayin-expected-account": expected },
    body: JSON.stringify({
      installationId: info.installationId,
      token,
      platform: info.platform,
      appVersion: info.appVersion,
      preferences,
    }),
  });
  if (revision !== generation || expected !== accountId) return;
  if (!response.ok) throw new Error("DEVICE_REGISTRATION_FAILED");
  publish({ preferences });
}
export async function enableMobileNotifications(
  preferences: NotificationPreferences,
): Promise<void> {
  await refreshMobileAccount();
  if (!accountId || state.info?.runtimeAllowed === false || !state.config?.notifications.enabled)
    throw new Error("NOTIFICATIONS_UNAVAILABLE");
  const expected = accountId;
  const permission = await requestMobile<{ granted: boolean }>(
    "notifications.request",
    { accountId: expected },
    120000,
  );
  if (accountId !== expected || !permission?.granted)
    throw new Error("NOTIFICATION_PERMISSION_REQUIRED");
  const result = await requestMobile<{ token: string | null }>("notifications.token", {
    accountId: expected,
  });
  if (accountId !== expected || !result?.token) throw new Error("FCM_TOKEN_UNAVAILABLE");
  publish({ notificationsEnabled: true });
  try {
    await registerMobileToken(result.token, preferences);
    if (accountId === expected) rememberNotificationOptOut(expected, false);
  } catch (error) {
    publish({ notificationsEnabled: false });
    throw error;
  }
}
export async function disableMobileNotifications(): Promise<void> {
  const installation = state.info?.installationId,
    expected = accountId;
  if (!installation || !expected) return;
  rememberNotificationOptOut(expected, true);
  publish({ notificationsEnabled: false, canRequestAds: false });
  await requestMobile("session.reset");
  privacyCheckedAccount = undefined;
  publish({ notificationsEnabled: false, canRequestAds: false });
  const response = await fetch(apiBaseUrl + "/mobile/devices/" + installation, {
    method: "DELETE",
    credentials: "include",
    headers: { "x-ayin-expected-account": expected },
  });
  if (!response.ok) throw new Error("DEVICE_DETACH_FAILED");
  publish({ notificationsEnabled: false, preferences: emptyNotificationPreferences() });
  await refreshMobileAccount();
}

/** Untrusted/delayed FCM events cannot rebind another account's installation. */
export async function registerMobileTokenEvent(
  recipient: unknown,
  token: unknown,
): Promise<boolean> {
  if (identityRefreshing || !accountId || recipient !== accountId || typeof token !== "string")
    return false;
  await registerMobileToken(token);
  return true;
}
export function currentMobileRecipient(recipient: unknown): boolean {
  return !identityRefreshing && !!accountId && recipient === accountId;
}
