import {
  getAdvertisingConsentSnapshot,
  type AdvertisingConsentSnapshot,
} from "./advertising-consent";
import type {
  VideoAdCallbacks,
  VideoAdPlaybackIntent,
  VideoAdService,
  VideoAdSlot,
} from "./video-ads";

const IMA_SDK_URL = "https://imasdk.googleapis.com/js/sdkloader/ima3.js";
const IMA_SDK_TIMEOUT_MS = 10_000;

interface ImaAdsRequest {
  adTagUrl: string;
  linearAdSlotWidth: number;
  linearAdSlotHeight: number;
  nonLinearAdSlotWidth: number;
  nonLinearAdSlotHeight: number;
  setAdWillAutoPlay(value: boolean): void;
  setAdWillPlayMuted(value: boolean): void;
}

interface ImaAdsManager {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  init(width: number, height: number, viewMode: string): void;
  start(): void;
  destroy(): void;
}

interface ImaAdsLoader {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  requestAds(request: ImaAdsRequest): void;
  contentComplete(): void;
  destroy(): void;
}

interface ImaNamespace {
  AdDisplayContainer: new (
    container: HTMLDivElement,
    content: HTMLVideoElement,
  ) => { initialize(): void };
  AdsLoader: new (displayContainer: { initialize(): void }) => ImaAdsLoader;
  AdsRequest: new () => ImaAdsRequest;
  AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: string } };
  AdErrorEvent: { Type: { AD_ERROR: string } };
  AdEvent: {
    Type: {
      CONTENT_PAUSE_REQUESTED: string;
      CONTENT_RESUME_REQUESTED: string;
      LOADED: string;
      IMPRESSION: string;
      STARTED: string;
      FIRST_QUARTILE: string;
      MIDPOINT: string;
      THIRD_QUARTILE: string;
      COMPLETE: string;
      CLICK: string;
    };
  };
  ViewMode: { NORMAL: string };
}

interface ImaLoadedEvent {
  getAdsManager(content: HTMLVideoElement): ImaAdsManager;
}

interface ImaErrorEvent {
  getError(): { getErrorCode?(): number; toString(): string };
}

type ImaWindow = Window & { google?: { ima?: ImaNamespace } };

let sdkPromise: Promise<ImaNamespace> | null = null;

export class ImaRuntimeError extends Error {
  constructor(readonly diagnosticCode: string) {
    super(diagnosticCode);
    this.name = "ImaRuntimeError";
  }
}

export function classifyImaErrorCode(code: number | null | undefined) {
  if (code === 1009 || code === 303) return `IMA_NO_FILL_${code}`;
  return `IMA_TECHNICAL_${code ?? "UNKNOWN"}`;
}

export function applyGoogleImaConsent(
  tagUrl: string,
  consent: AdvertisingConsentSnapshot,
) {
  let parsed: URL;
  try {
    parsed = new URL(tagUrl);
  } catch {
    return tagUrl;
  }
  if (!isGoogleAdTagHost(parsed.hostname)) return tagUrl;
  if (consent.mode === "LIMITED_ADS") {
    parsed.searchParams.set("ltd", "1");
    parsed.searchParams.delete("npa");
  } else if (consent.mode === "NON_PERSONALIZED") {
    parsed.searchParams.set("npa", "1");
    parsed.searchParams.delete("ltd");
  } else {
    parsed.searchParams.delete("npa");
    parsed.searchParams.delete("ltd");
  }
  return parsed.toString();
}

async function loadImaSdk(): Promise<ImaNamespace> {
  const existing = (window as ImaWindow).google?.ima;
  if (existing) return existing;
  if (!sdkPromise) {
    sdkPromise = new Promise<ImaNamespace>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>(
        `script[src="${IMA_SDK_URL}"]`,
      );
      const script = existingScript ?? document.createElement("script");
      let timeout: number | null = window.setTimeout(() => {
        timeout = null;
        reject(new ImaRuntimeError("IMA_SDK_LOAD_TIMEOUT"));
      }, IMA_SDK_TIMEOUT_MS);
      const clear = () => {
        if (timeout !== null) window.clearTimeout(timeout);
        timeout = null;
      };
      script.addEventListener(
        "load",
        () => {
          clear();
          const ima = (window as ImaWindow).google?.ima;
          if (ima) resolve(ima);
          else reject(new ImaRuntimeError("IMA_SDK_NAMESPACE_MISSING"));
        },
        { once: true },
      );
      script.addEventListener(
        "error",
        () => {
          clear();
          reject(new ImaRuntimeError("IMA_SDK_LOAD_FAILED"));
        },
        { once: true },
      );
      if (!existingScript) {
        script.src = IMA_SDK_URL;
        script.async = true;
        script.crossOrigin = "anonymous";
        document.head.append(script);
      }
    }).catch((error) => {
      sdkPromise = null;
      throw error;
    });
  }
  return sdkPromise;
}

export class GoogleImaVideoAdService implements VideoAdService {
  private container: HTMLDivElement | null = null;
  private contentVideo: HTMLVideoElement | null = null;
  private displayContainer: { initialize(): void } | null = null;
  private adsLoader: ImaAdsLoader | null = null;
  private adsManager: ImaAdsManager | null = null;
  private ima: ImaNamespace | null = null;
  private initialized = false;

  async preload(): Promise<void> {
    this.ima = await loadImaSdk();
  }

  async initialize(container: HTMLDivElement, contentVideo: HTMLVideoElement): Promise<void> {
    if (this.container === container && this.contentVideo === contentVideo && this.adsLoader) {
      if (!this.initialized) {
        this.displayContainer?.initialize();
        this.initialized = true;
      }
      return;
    }

    this.destroy();
    const existing = (window as ImaWindow).google?.ima;
    if (existing) {
      // Mobile IMA requires AdDisplayContainer.initialize() to stay in the direct user gesture.
      this.attach(existing, container, contentVideo);
      return;
    }

    const ima = await loadImaSdk();
    this.attach(ima, container, contentVideo);
  }

  async play(
    _slot: VideoAdSlot,
    tagUrl: string,
    callbacks: VideoAdCallbacks,
    playbackIntent?: VideoAdPlaybackIntent,
    consent?: AdvertisingConsentSnapshot,
  ): Promise<void> {
    const ima = this.ima;
    const loader = this.adsLoader;
    const content = this.contentVideo;
    const container = this.container;
    if (!ima || !loader || !content || !container) {
      throw new ImaRuntimeError("IMA_NOT_INITIALIZED");
    }

    callbacks.onEvent("REQUEST");
    return new Promise<void>((resolve) => {
      let settled = false;
      const fail = (error: unknown) => {
        const imaError = error as Partial<ImaErrorEvent>;
        const detail = imaError.getError?.();
        const code = detail?.getErrorCode?.();
        const diagnosticCode =
          error instanceof ImaRuntimeError ? error.diagnosticCode : classifyImaErrorCode(code);
        callbacks.onEvent("ERROR", diagnosticCode);
        this.adsManager?.destroy();
        this.adsManager = null;
        callbacks.onContentResume();
        if (!settled) {
          settled = true;
          // IMA/VAST failures are handled failures: content resumes and the caller must not
          // emit a second generic error for the same ad request.
          resolve();
        }
      };

      loader.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, fail);
      loader.addEventListener(ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, (event) => {
        try {
          const manager = (event as ImaLoadedEvent).getAdsManager(content);
          this.adsManager?.destroy();
          this.adsManager = manager;
          manager.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, fail);
          manager.addEventListener(ima.AdEvent.Type.CONTENT_PAUSE_REQUESTED, () =>
            callbacks.onContentPause(),
          );
          manager.addEventListener(ima.AdEvent.Type.CONTENT_RESUME_REQUESTED, () => {
            callbacks.onContentResume();
            if (!settled) {
              settled = true;
              resolve();
            }
          });
          const eventMap: Array<[string, Parameters<VideoAdCallbacks["onEvent"]>[0]]> = [
            [ima.AdEvent.Type.LOADED, "FILL"],
            [ima.AdEvent.Type.IMPRESSION, "IMPRESSION"],
            [ima.AdEvent.Type.STARTED, "START"],
            [ima.AdEvent.Type.FIRST_QUARTILE, "QUARTILE_25"],
            [ima.AdEvent.Type.MIDPOINT, "MIDPOINT"],
            [ima.AdEvent.Type.THIRD_QUARTILE, "QUARTILE_75"],
            [ima.AdEvent.Type.COMPLETE, "COMPLETE"],
            [ima.AdEvent.Type.CLICK, "CLICK"],
          ];
          for (const [imaEvent, ayinEvent] of eventMap) {
            manager.addEventListener(imaEvent, () => callbacks.onEvent(ayinEvent));
          }
          manager.init(
            Math.max(container.clientWidth, 1),
            Math.max(container.clientHeight, 1),
            ima.ViewMode.NORMAL,
          );
          manager.start();
        } catch (error) {
          fail(error);
        }
      });

      const request = new ima.AdsRequest();
      request.adTagUrl = applyGoogleImaConsent(
        tagUrl,
        consent ?? getAdvertisingConsentSnapshot(),
      );
      request.linearAdSlotWidth = Math.max(container.clientWidth, 640);
      request.linearAdSlotHeight = Math.max(container.clientHeight, 360);
      request.nonLinearAdSlotWidth = Math.max(container.clientWidth, 640);
      request.nonLinearAdSlotHeight = 150;
      request.setAdWillAutoPlay(playbackIntent?.autoPlay ?? false);
      request.setAdWillPlayMuted(playbackIntent?.muted ?? content.muted);
      loader.requestAds(request);
    });
  }

  contentComplete(): void {
    this.adsLoader?.contentComplete();
  }

  destroy(): void {
    this.adsManager?.destroy();
    this.adsLoader?.destroy();
    this.adsManager = null;
    this.adsLoader = null;
    this.displayContainer = null;
    this.container = null;
    this.contentVideo = null;
    this.ima = null;
    this.initialized = false;
  }

  private attach(
    ima: ImaNamespace,
    container: HTMLDivElement,
    contentVideo: HTMLVideoElement,
  ): void {
    this.ima = ima;
    this.container = container;
    this.contentVideo = contentVideo;
    this.displayContainer = new ima.AdDisplayContainer(container, contentVideo);
    this.adsLoader = new ima.AdsLoader(this.displayContainer);
    this.displayContainer.initialize();
    this.initialized = true;
  }
}

function isGoogleAdTagHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "securepubads.g.doubleclick.net" || normalized.endsWith(".doubleclick.net")
  );
}
