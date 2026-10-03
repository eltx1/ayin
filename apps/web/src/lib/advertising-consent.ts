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
  const previous = provider;
  provider = next;
  return () => {
    if (provider === next) provider = previous;
  };
}

export function resetAdvertisingConsentProviderForTests() {
  provider = { getSnapshot: () => safeDefault };
}
