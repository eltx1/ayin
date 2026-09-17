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

const safeDefault: AdvertisingConsentSnapshot = {
  mode: "LIMITED_ADS",
  source: "SAFE_DEFAULT",
  providerManaged: false,
};

let provider: AdvertisingConsentProvider = {
  getSnapshot: () => safeDefault,
};

export function getAdvertisingConsentSnapshot(): AdvertisingConsentSnapshot {
  const snapshot = provider.getSnapshot();
  if (snapshot.source === "SAFE_DEFAULT" && snapshot.mode !== "LIMITED_ADS") {
    return safeDefault;
  }
  return snapshot;
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
