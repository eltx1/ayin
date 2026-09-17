import type { AdvertisingConsentSnapshot } from "./advertising-consent";
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
  setPrivacySettings(settings: { nonPersonalizedAds?: boolean; limitedAds?: boolean }): void;
}

interface GptApi {
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
  return consent.mode === "LIMITED_ADS" ? GPT_LIMITED_SRC : GPT_STANDARD_SRC;
}

export function gptPrivacySettingsForConsent(consent: AdvertisingConsentSnapshot) {
  if (consent.mode === "LIMITED_ADS") return { limitedAds: true } as const;
  if (consent.mode === "NON_PERSONALIZED") return { nonPersonalizedAds: true } as const;
  return {};
}

export function loadGooglePublisherTag(consent: AdvertisingConsentSnapshot) {
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
}) {
  await loadGooglePublisherTag(input.consent);
  const googleTag = api();
  let slot: GptSlot | null = null;
  const removers: Array<() => void> = [];

  await new Promise<void>((resolve, reject) => {
    googleTag.cmd.push(() => {
      const pubads = googleTag.pubads();
      pubads.setPrivacySettings(gptPrivacySettingsForConsent(input.consent));
      slot = googleTag.defineSlot(input.adUnitPath, input.sizes, input.divId);
      if (!slot) {
        reject(new GptRuntimeError("GPT_SLOT_DEFINITION_FAILED"));
        return;
      }

      if (input.responsive.length > 0) {
        const builder = googleTag.sizeMapping();
        for (const entry of [...input.responsive].sort((a, b) => b.minWidth - a.minWidth)) {
          builder.addSize([entry.minWidth, 0], entry.sizes);
        }
        slot.defineSizeMapping(builder.build());
      }

      const renderListener = (event: GptSlotEvent | GptSlotRenderEvent) => {
        if (event.slot === slot && "isEmpty" in event) input.onRender(!event.isEmpty);
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
    });
  });

  return () => {
    for (const remove of removers) remove();
    if (slot) api().destroySlots([slot]);
  };
}

function findGptScript() {
  return [...document.querySelectorAll<HTMLScriptElement>("script[src]")].find(
    (script) => script.src === GPT_STANDARD_SRC || script.src === GPT_LIMITED_SRC,
  );
}
