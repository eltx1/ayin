export type AdvertisingConsentMode = "PERSONALIZED" | "NON_PERSONALIZED" | "LIMITED_ADS";
export type AdvertisingConsentSource = "SAFE_DEFAULT" | "CMP" | "APPLICATION";

export interface AdvertisingConsentSnapshot {
  mode: AdvertisingConsentMode;
  source: AdvertisingConsentSource;
  providerManaged: boolean;
}

export interface AdvertisingConsentProvider {
  getSnapshot(): AdvertisingConsentSnapshot;
}

const safeDefault: AdvertisingConsentSnapshot = Object.freeze({
  mode: "LIMITED_ADS",
  source: "SAFE_DEFAULT",
  providerManaged: false,
});

let provider: AdvertisingConsentProvider = {
  getSnapshot: () => safeDefault,
};

export function getAdvertisingConsentSnapshot(): AdvertisingConsentSnapshot {
  try {
    return normalizeAdvertisingConsent(provider.getSnapshot());
  } catch {
    return safeDefault;
  }
}

export function normalizeAdvertisingConsent(value: unknown): AdvertisingConsentSnapshot {
  if (!value || typeof value !== "object") return safeDefault;
  const snapshot = value as Record<string, unknown>;
  if (
    typeof snapshot.mode !== "string" ||
    !["PERSONALIZED", "NON_PERSONALIZED", "LIMITED_ADS"].includes(snapshot.mode) ||
    typeof snapshot.source !== "string" ||
    !["SAFE_DEFAULT", "CMP", "APPLICATION"].includes(snapshot.source) ||
    typeof snapshot.providerManaged !== "boolean" ||
    snapshot.source === "SAFE_DEFAULT"
  )
    return safeDefault;
  return {
    mode: snapshot.mode as AdvertisingConsentMode,
    source: snapshot.source as AdvertisingConsentSource,
    providerManaged: snapshot.providerManaged,
  };
}

export function registerAdvertisingConsentProvider(next: AdvertisingConsentProvider) {
  const previous = provider;
  provider = next;
  return () => {
    if (provider === next) provider = previous;
  };
}

export function resetAdvertisingConsentProviderForTests() {
  provider = { getSnapshot: () => safeDefault };
}
