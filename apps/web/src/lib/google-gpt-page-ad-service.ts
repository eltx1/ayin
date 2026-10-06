import {
  normalizeAdvertisingConsent,
  type AdvertisingConsentSnapshot,
} from "./advertising-consent";
import type { PageAdSize } from "./page-ads";

interface GptSizeMappingBuilder {
  addSize(viewport: PageAdSize, sizes: PageAdSize[]): GptSizeMappingBuilder;
  build(): unknown;
}

interface GptSlot {
  addService(service: GptPubAdsService): GptSlot;
  defineSizeMapping(mapping: unknown): GptSlot;
  setConfig(config: { collapseDiv: "BEFORE_FETCH" }): GptSlot;
}

interface GptSlotEvent {
  slot: GptSlot;
}

interface GptSlotRenderEvent extends GptSlotEvent {
  isEmpty: boolean;
}

interface GptPubAdsService {
  addEventListener(
    type: string,
    listener: (event: GptSlotEvent | GptSlotRenderEvent) => void,
  ): void;
  removeEventListener(
    type: string,
    listener: (event: GptSlotEvent | GptSlotRenderEvent) => void,
  ): void;
  setPrivacySettings(settings: {
    nonPersonalizedAds?: boolean;
    limitedAds?: boolean;
    tagForAgeTreatment?: number | string;
  }): void;
}

interface GptApi {
  enums?: { TagForAgeTreatment?: Partial<Record<"CHILD" | "TEEN", number | string>> };
  cmd: Array<() => void>;
  defineSlot(path: string, sizes: PageAdSize[], divId: string): GptSlot | null;
  pubads(): GptPubAdsService;
  sizeMapping(): GptSizeMappingBuilder;
  enableServices(): void;
  display(divId: string): void;
  destroySlots(slots: GptSlot[]): boolean;
}

type GptWindow = Window & { googletag?: GptApi | { cmd: Array<() => void> } };

const GPT_STANDARD_SRC = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";
const GPT_LIMITED_SRC = "https://pagead2.googlesyndication.com/tag/js/gpt.js";
const SDK_TIMEOUT_MS = 10_000;
let loader: Promise<void> | null = null;
let loadedScriptSource: string | null = null;
let servicesEnabled = false;

export class GptRuntimeError extends Error {
  constructor(readonly diagnosticCode: string) {
    super(diagnosticCode);
    this.name = "GptRuntimeError";
  }
}

function gptWindow() {
  return window as GptWindow;
}

function api(): GptApi {
  const value = gptWindow().googletag;
  if (!value || !("defineSlot" in value)) throw new GptRuntimeError("GPT_API_NOT_READY");
  return value;
}

export function gptScriptUrlForConsent(consent: AdvertisingConsentSnapshot) {
  return normalizeAdvertisingConsent(consent).mode === "LIMITED_ADS"
    ? GPT_LIMITED_SRC
    : GPT_STANDARD_SRC;
}

export function gptPrivacySettingsForConsent(
  consent: AdvertisingConsentSnapshot,
  ageEnums?: Partial<Record<"CHILD" | "TEEN", number | string>>,
) {
  const resolved = normalizeAdvertisingConsent(consent);
  const settings: {
    limitedAds?: boolean;
    nonPersonalizedAds?: boolean;
    tagForAgeTreatment?: number | string;
  } = {};
  if (resolved.mode === "LIMITED_ADS") settings.limitedAds = true;
  if (resolved.mode === "NON_PERSONALIZED") settings.nonPersonalizedAds = true;
  if (resolved.ageTreatment) {
    const value = ageEnums?.[resolved.ageTreatment];
    if (
      (typeof value !== "number" && typeof value !== "string") ||
      (typeof value === "number" && !Number.isFinite(value)) ||
      value === ""
    )
      throw new GptRuntimeError("GPT_AGE_TREATMENT_API_UNAVAILABLE");
    settings.tagForAgeTreatment = value;
  }
  return settings;
}

export function loadGooglePublisherTag(consent: AdvertisingConsentSnapshot) {
  consent = normalizeAdvertisingConsent(consent);
  const requestedSource = gptScriptUrlForConsent(consent);
  if (loader) {
    if (loadedScriptSource === GPT_STANDARD_SRC && requestedSource === GPT_LIMITED_SRC) {
      return Promise.reject(new GptRuntimeError("GPT_LIMITED_ADS_REQUIRES_LIMITED_SCRIPT"));
    }
    return loader;
  }

  loader = new Promise<void>((resolve, reject) => {
    const target = gptWindow();
    target.googletag ??= { cmd: [] };
    const existingScript = findGptScript();
    if ("defineSlot" in target.googletag) {
      loadedScriptSource = existingScript?.src ?? null;
      if (consent.mode === "LIMITED_ADS" && loadedScriptSource !== GPT_LIMITED_SRC) {
        reject(new GptRuntimeError("GPT_LIMITED_ADS_SCRIPT_UNKNOWN"));
        return;
      }
      resolve();
      return;
    }

    const script = existingScript ?? document.createElement("script");
    if (
      existingScript &&
      existingScript.src !== requestedSource &&
      requestedSource === GPT_LIMITED_SRC
    ) {
      reject(new GptRuntimeError("GPT_LIMITED_ADS_REQUIRES_LIMITED_SCRIPT"));
      return;
    }
    loadedScriptSource = existingScript?.src ?? requestedSource;

    let timeout: number | null = window.setTimeout(() => {
      timeout = null;
      reject(new GptRuntimeError("GPT_SCRIPT_LOAD_TIMEOUT"));
    }, SDK_TIMEOUT_MS);
    const clear = () => {
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = null;
    };
    script.addEventListener(
      "load",
      () => {
        clear();
        resolve();
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => {
        clear();
        reject(new GptRuntimeError("GPT_SCRIPT_LOAD_FAILED"));
      },
      { once: true },
    );
    if (!existingScript) {
      script.async = true;
      script.crossOrigin = "anonymous";
      script.src = requestedSource;
      document.head.append(script);
    }
  });
  return loader;
}

export async function mountGooglePublisherTagSlot(input: {
  divId: string;
  adUnitPath: string;
  sizes: PageAdSize[];
  responsive: Array<{ minWidth: number; sizes: PageAdSize[] }>;
  consent: AdvertisingConsentSnapshot;
  onRender: (filled: boolean) => void;
  signal?: AbortSignal;
}) {
  const noop = () => {};
  if (input.signal?.aborted) return noop;
  await loadGooglePublisherTag(input.consent);
  if (input.signal?.aborted) return noop;
  const googleTag = api();
  const privacySettings = gptPrivacySettingsForConsent(
    input.consent,
    googleTag.enums?.TagForAgeTreatment,
  );
  let slot: GptSlot | null = null;
  let disposed = false;
  let cancelPending: (() => void) | null = null;
  const removers: Array<() => void> = [];
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    cancelPending?.();
    input.signal?.removeEventListener("abort", cleanup);
    for (const remove of removers.splice(0)) remove();
    if (slot) googleTag.destroySlots([slot]);
    slot = null;
  };
  input.signal?.addEventListener("abort", cleanup, { once: true });

  await new Promise<void>((resolve, reject) => {
    cancelPending = resolve;
    googleTag.cmd.push(() => {
      if (disposed || input.signal?.aborted) {
        resolve();
        return;
      }
      try {
        const pubads = googleTag.pubads();
        pubads.setPrivacySettings(privacySettings);
        slot = googleTag.defineSlot(input.adUnitPath, input.sizes, input.divId);
        if (!slot) {
          throw new GptRuntimeError("GPT_SLOT_DEFINITION_FAILED");
        }

        if (input.responsive.length > 0) {
          const builder = googleTag.sizeMapping();
          for (const entry of [...input.responsive].sort((a, b) => b.minWidth - a.minWidth)) {
            builder.addSize([entry.minWidth, 0], entry.sizes);
          }
          slot.defineSizeMapping(builder.build());
        }

        const renderListener = (event: GptSlotEvent | GptSlotRenderEvent) => {
          if (!disposed && event.slot === slot && "isEmpty" in event)
            input.onRender(!event.isEmpty);
        };
        pubads.addEventListener("slotRenderEnded", renderListener);
        removers.push(() => pubads.removeEventListener("slotRenderEnded", renderListener));

        slot.setConfig({ collapseDiv: "BEFORE_FETCH" }).addService(pubads);
        if (!servicesEnabled) {
          googleTag.enableServices();
          servicesEnabled = true;
        }
        googleTag.display(input.divId);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }).catch((error: unknown) => {
    cleanup();
    throw error;
  });
  cancelPending = null;

  return cleanup;
}

function findGptScript() {
  return [...document.querySelectorAll<HTMLScriptElement>("script[src]")].find(
    (script) => script.src === GPT_STANDARD_SRC || script.src === GPT_LIMITED_SRC,
  );
}
