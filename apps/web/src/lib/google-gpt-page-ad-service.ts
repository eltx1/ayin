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

interface GptSlotRenderEvent {
  slot: GptSlot;
  isEmpty: boolean;
}

interface GptPubAdsService {
  addEventListener(type: "slotRenderEnded", listener: (event: GptSlotRenderEvent) => void): void;
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

const GPT_SRC = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";
let loader: Promise<void> | null = null;
let servicesEnabled = false;

function gptWindow() {
  return window as GptWindow;
}

function api(): GptApi {
  const value = gptWindow().googletag;
  if (!value || !("defineSlot" in value)) throw new Error("GPT_API_NOT_READY");
  return value;
}

export function loadGooglePublisherTag() {
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    const target = gptWindow();
    target.googletag ??= { cmd: [] };
    if ("defineSlot" in target.googletag) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("GPT_SCRIPT_FAILED")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.async = true;
    script.src = GPT_SRC;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("GPT_SCRIPT_FAILED")), { once: true });
    document.head.append(script);
  });
  return loader;
}

export async function mountGooglePublisherTagSlot(input: {
  divId: string;
  adUnitPath: string;
  sizes: PageAdSize[];
  responsive: Array<{ minWidth: number; sizes: PageAdSize[] }>;
  onRender: (filled: boolean) => void;
}) {
  await loadGooglePublisherTag();
  const googleTag = api();
  let slot: GptSlot | null = null;

  await new Promise<void>((resolve) => {
    googleTag.cmd.push(() => {
      slot = googleTag.defineSlot(input.adUnitPath, input.sizes, input.divId);
      if (!slot) {
        input.onRender(false);
        resolve();
        return;
      }

      if (input.responsive.length > 0) {
        const builder = googleTag.sizeMapping();
        for (const entry of [...input.responsive].sort((a, b) => b.minWidth - a.minWidth)) {
          builder.addSize([entry.minWidth, 0], entry.sizes);
        }
        slot.defineSizeMapping(builder.build());
      }

      slot.setConfig({ collapseDiv: "BEFORE_FETCH" }).addService(googleTag.pubads());
      googleTag.pubads().addEventListener("slotRenderEnded", (event) => {
        if (event.slot === slot) input.onRender(!event.isEmpty);
      });
      if (!servicesEnabled) {
        googleTag.enableServices();
        servicesEnabled = true;
      }
      googleTag.display(input.divId);
      resolve();
    });
  });

  return () => {
    if (slot) api().destroySlots([slot]);
  };
}
