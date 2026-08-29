import type { VideoAdCallbacks, VideoAdService, VideoAdSlot } from "./video-ads";

const IMA_SDK_URL = "https://imasdk.googleapis.com/js/sdkloader/ima3.js";

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

async function loadImaSdk(): Promise<ImaNamespace> {
  const existing = (window as ImaWindow).google?.ima;
  if (existing) return existing;
  if (!sdkPromise) {
    sdkPromise = new Promise<ImaNamespace>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = IMA_SDK_URL;
      script.async = true;
      script.addEventListener("load", () => {
        const ima = (window as ImaWindow).google?.ima;
        if (ima) resolve(ima);
        else reject(new Error("Google IMA SDK loaded without its runtime namespace."));
      });
      script.addEventListener("error", () =>
        reject(new Error("Google IMA SDK could not be loaded.")),
      );
      document.head.append(script);
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

  async initialize(container: HTMLDivElement, contentVideo: HTMLVideoElement): Promise<void> {
    if (this.container === container && this.contentVideo === contentVideo && this.adsLoader) {
      if (!this.initialized) {
        this.displayContainer?.initialize();
        this.initialized = true;
      }
      return;
    }
    this.destroy();
    this.ima = await loadImaSdk();
    this.container = container;
    this.contentVideo = contentVideo;
    this.displayContainer = new this.ima.AdDisplayContainer(container, contentVideo);
    this.adsLoader = new this.ima.AdsLoader(this.displayContainer);
    this.displayContainer.initialize();
    this.initialized = true;
  }

  async play(_slot: VideoAdSlot, tagUrl: string, callbacks: VideoAdCallbacks): Promise<void> {
    const ima = this.ima;
    const loader = this.adsLoader;
    const content = this.contentVideo;
    const container = this.container;
    if (!ima || !loader || !content || !container) throw new Error("IMA is not initialized.");

    callbacks.onEvent("REQUEST");
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        const imaError = error as ImaErrorEvent;
        const detail = imaError.getError?.();
        callbacks.onEvent(
          "ERROR",
          String(detail?.getErrorCode?.() ?? detail?.toString?.() ?? "IMA_ERROR"),
        );
        this.adsManager?.destroy();
        this.adsManager = null;
        callbacks.onContentResume();
        if (!settled) {
          settled = true;
          reject(error instanceof Error ? error : new Error("IMA ad error."));
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
      request.adTagUrl = tagUrl;
      request.linearAdSlotWidth = Math.max(container.clientWidth, 640);
      request.linearAdSlotHeight = Math.max(container.clientHeight, 360);
      request.nonLinearAdSlotWidth = Math.max(container.clientWidth, 640);
      request.nonLinearAdSlotHeight = 150;
      request.setAdWillAutoPlay(false);
      request.setAdWillPlayMuted(content.muted);
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
}
