export type AdvertisingConsentMode = "PERSONALIZED" | "NON_PERSONALIZED" | "LIMITED_ADS";
export type AdvertisingConsentSource = "SAFE_DEFAULT" | "CMP" | "APPLICATION";
export type AdvertisingAgeTreatment = "CHILD" | "TEEN";

export interface AdvertisingConsentSnapshot {
  mode: AdvertisingConsentMode;
  source: AdvertisingConsentSource;
  providerManaged: boolean;
  ageTreatment?: AdvertisingAgeTreatment;
}

export interface AdvertisingConsentProvider {
  getSnapshot(): AdvertisingConsentSnapshot;
  // A trusted integration notifies after updating its snapshot. Existing
  // snapshot-only integrations remain readable but cannot announce changes.
  subscribe?(listener: () => void): () => void;
}

const safeDefault: AdvertisingConsentSnapshot = Object.freeze({
  mode: "LIMITED_ADS",
  source: "SAFE_DEFAULT",
  providerManaged: false,
});

interface ProviderRegistration {
  provider: AdvertisingConsentProvider;
  active: boolean;
}

const registrations: ProviderRegistration[] = [];
const listeners = new Set<() => void>();
const revocations = new Set<() => void>();
let unsubscribeProvider: (() => void) | null = null;
let providerSubscriptionFailed = false;
let providerBinding = 0;
let snapshot = safeDefault;
let publishedSnapshot = safeDefault;

export const ADVERTISING_CONSENT_CHANGED = "ADVERTISING_CONSENT_CHANGED";

function currentRegistration() {
  return registrations.at(-1);
}

function equivalent(left: AdvertisingConsentSnapshot, right: AdvertisingConsentSnapshot) {
  return (
    left.mode === right.mode &&
    left.source === right.source &&
    left.providerManaged === right.providerManaged &&
    left.ageTreatment === right.ageTreatment
  );
}

export function getAdvertisingConsentSnapshot(): AdvertisingConsentSnapshot {
  let next = safeDefault;
  try {
    if (!providerSubscriptionFailed) {
      next = normalizeAdvertisingConsent(currentRegistration()?.provider.getSnapshot());
    }
  } catch {
    // A failing provider never supplies permission for personalized delivery.
  }
  if (next.source === "SAFE_DEFAULT" && snapshot.ageTreatment) {
    // An invalid/missing update is not authority to erase a known restriction.
    const ageTreatment =
      snapshot.ageTreatment === "CHILD" || next.ageTreatment === "CHILD" ? "CHILD" : "TEEN";
    next = { ...next, ageTreatment };
  }
  if (!equivalent(snapshot, next)) snapshot = Object.freeze(next);
  return snapshot;
}

export function getServerAdvertisingConsentSnapshot() {
  return safeDefault;
}

function publishConsent() {
  const next = getAdvertisingConsentSnapshot();
  if (publishedSnapshot === next) return;
  publishedSnapshot = next;
  // Revoke SDK authority synchronously, before React's store listeners can
  // commit a new tree or queued provider callbacks can deliver more work.
  for (const revoke of [...revocations]) revoke();
  for (const listener of [...listeners]) listener();
}

export function subscribeAdvertisingConsent(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function bindProvider() {
  const binding = ++providerBinding;
  const previousUnsubscribe = unsubscribeProvider;
  unsubscribeProvider = null;
  try {
    previousUnsubscribe?.();
  } catch {
    /* Superseded callbacks are fenced below. */
  }
  providerSubscriptionFailed = false;
  const registration = currentRegistration();
  let subscribing = true;
  try {
    unsubscribeProvider =
      registration?.provider.subscribe?.(() => {
        if (
          !subscribing &&
          binding === providerBinding &&
          registration.active &&
          currentRegistration() === registration
        )
          publishConsent();
      }) ?? null;
  } catch {
    providerSubscriptionFailed = true;
  }
  subscribing = false;
  publishConsent();
}

export function createAdvertisingConsentScope(expected = getAdvertisingConsentSnapshot()) {
  const controller = new AbortController();
  const revoke = (reason: string) => {
    revocations.delete(onChange);
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const isCurrent = () => {
    if (!controller.signal.aborted && getAdvertisingConsentSnapshot() !== expected)
      revoke(ADVERTISING_CONSENT_CHANGED);
    return !controller.signal.aborted;
  };
  const onChange = () => {
    isCurrent();
  };
  revocations.add(onChange);
  isCurrent();
  return {
    snapshot: expected,
    signal: controller.signal,
    isCurrent,
    release: () => revoke("ADVERTISING_CONSENT_SCOPE_RELEASED"),
  };
}

export function normalizeAdvertisingConsent(value: unknown): AdvertisingConsentSnapshot {
  if (!value || typeof value !== "object") return safeDefault;
  const snapshot = value as Record<string, unknown>;
  const ageTreatment: AdvertisingAgeTreatment | undefined =
    snapshot.ageTreatment === "CHILD" || snapshot.ageTreatment === "TEEN"
      ? snapshot.ageTreatment
      : undefined;
  const fallback: AdvertisingConsentSnapshot = ageTreatment
    ? { ...safeDefault, ageTreatment }
    : safeDefault;
  if (
    typeof snapshot.mode !== "string" ||
    !["PERSONALIZED", "NON_PERSONALIZED", "LIMITED_ADS"].includes(snapshot.mode) ||
    typeof snapshot.source !== "string" ||
    !["SAFE_DEFAULT", "CMP", "APPLICATION"].includes(snapshot.source) ||
    typeof snapshot.providerManaged !== "boolean" ||
    snapshot.source === "SAFE_DEFAULT" ||
    (snapshot.ageTreatment !== undefined && !ageTreatment)
  )
    return fallback;
  return {
    mode:
      ageTreatment && snapshot.mode === "PERSONALIZED"
        ? "NON_PERSONALIZED"
        : (snapshot.mode as AdvertisingConsentMode),
    source: snapshot.source as AdvertisingConsentSource,
    providerManaged: snapshot.providerManaged,
    ...(ageTreatment ? { ageTreatment } : {}),
  };
}

export function registerAdvertisingConsentProvider(next: AdvertisingConsentProvider) {
  const registration = { provider: next, active: true };
  registrations.push(registration);
  bindProvider();
  return () => {
    if (!registration.active) return;
    const wasCurrent = currentRegistration() === registration;
    registration.active = false;
    registrations.splice(registrations.indexOf(registration), 1);
    if (wasCurrent) bindProvider();
  };
}

export function resetAdvertisingConsentProviderForTests() {
  for (const registration of registrations) registration.active = false;
  registrations.length = 0;
  bindProvider();
  snapshot = safeDefault;
  publishConsent();
}
