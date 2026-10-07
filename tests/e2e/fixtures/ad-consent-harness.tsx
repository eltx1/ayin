import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/app/globals.css";

import { PageAdSlot } from "@/components/ads/page-ad-slot";
import { AdEnabledAyinPlayer } from "@/components/player/ad-enabled-ayin-player";
import { CreatorTvPlayer } from "@/components/creator-tv/creator-tv-player";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import {
  registerAdvertisingConsentProvider,
  type AdvertisingConsentSnapshot,
} from "@/lib/advertising-consent";
import type { CreatorTvLinearCapability, PublicCreatorTvResponse } from "@/lib/creator-tv";

class Events {
  listeners = new Map<string, Array<(event: unknown) => void>>();
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((value) => value !== listener),
    );
  }
  emit(type: string, event: unknown = {}) {
    for (const callback of [...(this.listeners.get(type) ?? [])]) callback(event);
  }
}

const media = new WeakMap<HTMLMediaElement, { paused: boolean; time: number; src: string }>();
function mediaState(element: HTMLMediaElement) {
  let state = media.get(element);
  if (!state) {
    state = { paused: true, time: 0, src: "" };
    media.set(element, state);
  }
  return state;
}
const statistics = {
  playCalls: 0,
  pauseCalls: 0,
  imaStarts: 0,
  imaDestroyed: 0,
  imaTags: [] as string[],
  gptDefined: 0,
  gptDisplayed: 0,
  gptDestroyed: 0,
  gptQueued: 0,
  gptPrivacy: [] as unknown[],
  hlsSources: [] as string[],
  hlsDestroyed: 0,
};
Object.defineProperties(HTMLMediaElement.prototype, {
  paused: {
    configurable: true,
    get() {
      return mediaState(this as HTMLMediaElement).paused;
    },
  },
  duration: {
    configurable: true,
    get() {
      return 120;
    },
  },
  readyState: {
    configurable: true,
    get() {
      return mediaState(this as HTMLMediaElement).src ||
        (this as HTMLMediaElement).dataset.syntheticHls
        ? 4
        : 0;
    },
  },
  currentTime: {
    configurable: true,
    get() {
      return mediaState(this as HTMLMediaElement).time;
    },
    set(value: number) {
      mediaState(this as HTMLMediaElement).time = value;
    },
  },
  src: {
    configurable: true,
    get() {
      return mediaState(this as HTMLMediaElement).src;
    },
    set(value: string) {
      mediaState(this as HTMLMediaElement).src = value;
      (this as HTMLMediaElement).dataset.syntheticSrc = value;
    },
  },
});
HTMLMediaElement.prototype.play = function () {
  statistics.playCalls++;
  mediaState(this).paused = false;
  this.dispatchEvent(new Event("play"));
  this.dispatchEvent(new Event("playing"));
  return Promise.resolve();
};
HTMLMediaElement.prototype.pause = function () {
  statistics.pauseCalls++;
  const previous = mediaState(this).paused;
  mediaState(this).paused = true;
  if (!previous) this.dispatchEvent(new Event("pause"));
};
HTMLMediaElement.prototype.load = function () {
  queueMicrotask(() => {
    if (mediaState(this).src) {
      this.dispatchEvent(new Event("loadedmetadata"));
      this.dispatchEvent(new Event("canplay"));
    }
  });
};
HTMLMediaElement.prototype.canPlayType = () => "";

const managers: AdsManager[] = [];
class AdDisplayContainer {
  constructor(readonly container: HTMLDivElement) {}
  initialize() {}
}
class AdsManager extends Events {
  constructor(readonly container: HTMLDivElement) {
    super();
  }
  init() {}
  start() {
    const frame = document.createElement("iframe");
    frame.srcdoc = "Synthetic advertisement";
    this.container.append(frame);
    statistics.imaStarts++;
    this.emit("CONTENT_PAUSE_REQUESTED");
    this.emit("STARTED");
  }
  destroy() {
    statistics.imaDestroyed++;
  }
}
class AdsLoader extends Events {
  constructor(readonly display: AdDisplayContainer) {
    super();
  }
  requestAds(request: { adTagUrl: string }) {
    statistics.imaTags.push(request.adTagUrl);
    const manager = new AdsManager(this.display.container);
    managers.push(manager);
    queueMicrotask(() => this.emit("ADS_MANAGER_LOADED", { getAdsManager: () => manager }));
  }
  contentComplete() {}
  destroy() {}
}
class AdsRequest {
  setAdWillAutoPlay() {}
  setAdWillPlayMuted() {}
}
Object.assign(window, {
  google: {
    ima: {
      AdDisplayContainer,
      AdsLoader,
      AdsRequest,
      AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: "ADS_MANAGER_LOADED" } },
      AdErrorEvent: { Type: { AD_ERROR: "AD_ERROR" } },
      AdEvent: {
        Type: Object.fromEntries(
          [
            "CONTENT_PAUSE_REQUESTED",
            "CONTENT_RESUME_REQUESTED",
            "LOADED",
            "IMPRESSION",
            "STARTED",
            "FIRST_QUARTILE",
            "MIDPOINT",
            "THIRD_QUARTILE",
            "COMPLETE",
            "CLICK",
          ].map((event) => [event, event]),
        ),
      },
      ViewMode: { NORMAL: "normal" },
    },
  },
});

let holdGpt = false;
const gptCommands: Array<() => void> = [];
const slots: object[] = [];
const pubads = Object.assign(new Events(), {
  setPrivacySettings(value: unknown) {
    statistics.gptPrivacy.push(value);
  },
});
const marker = document.createElement("script");
marker.type = "application/json";
marker.src = "https://pagead2.googlesyndication.com/tag/js/gpt.js";
document.head.append(marker);
Object.assign(window, {
  googletag: {
    enums: { TagForAgeTreatment: { CHILD: "synthetic-child", TEEN: "synthetic-teen" } },
    cmd: {
      push(callback: () => void) {
        if (holdGpt) {
          statistics.gptQueued++;
          gptCommands.push(callback);
        } else callback();
      },
    },
    defineSlot() {
      statistics.gptDefined++;
      const slot = {
        setConfig() {
          return this;
        },
        addService() {
          return this;
        },
      };
      slots.push(slot);
      return slot;
    },
    pubads() {
      return pubads;
    },
    enableServices() {},
    display(id: string) {
      statistics.gptDisplayed++;
      const frame = document.createElement("iframe");
      frame.srcdoc = "Synthetic page advertisement";
      document.getElementById(id)?.append(frame);
    },
    destroySlots() {
      statistics.gptDestroyed++;
    },
  },
});

const hlsInstances: FakeHls[] = [];
class FakeHls {
  static isSupported() {
    return true;
  }
  static Events = {
    MEDIA_ATTACHED: "attached",
    MANIFEST_PARSED: "manifest",
    LEVEL_SWITCHED: "level",
    FRAG_BUFFERED: "fragment",
    ERROR: "error",
  };
  levels = [];
  currentLevel = -1;
  nextLevel = -1;
  listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  constructor() {
    hlsInstances.push(this);
  }
  on(event: string, callback: (...args: unknown[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), callback]);
  }
  emit(event: string, value: unknown = {}) {
    for (const callback of this.listeners.get(event) ?? []) callback(event, value);
  }
  attachMedia(video: HTMLVideoElement) {
    video.dataset.syntheticHls = "attached";
    queueMicrotask(() => this.emit("attached"));
  }
  loadSource(url: string) {
    statistics.hlsSources.push(url);
    queueMicrotask(() => this.emit("manifest"));
  }
  startLoad() {}
  recoverMediaError() {}
  destroy() {
    statistics.hlsDestroyed++;
  }
}
Object.assign(window, { Hls: FakeHls });

let consent: AdvertisingConsentSnapshot = {
  mode: "PERSONALIZED",
  source: "CMP",
  providerManaged: true,
};
const subscribers = new Set<() => void>();
registerAdvertisingConsentProvider({
  getSnapshot: () => consent,
  subscribe(listener) {
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  },
});
const root = createRoot(document.getElementById("root")!);
const created = Date.now();
const video = {
  id: "synthetic-video",
  slug: "synthetic-video",
  title: "Synthetic current video",
  description: null,
  publishedAt: new Date(created).toISOString(),
  durationMs: 120_000,
  source: { objectKey: "test.mp4", mimeType: "video/mp4" },
  thumbnail: null,
};
const tv = {
  canonicalHandle: "synthetic",
  redirectedFrom: null,
  channel: {
    id: "synthetic-channel",
    handle: "synthetic",
    name: "Synthetic channel",
    description: null,
    createdAt: new Date(created).toISOString(),
  },
  appearance: { accentColor: null, avatar: null, banner: null },
  tv: {
    id: "synthetic-tv",
    slug: "synthetic-tv",
    name: "Synthetic TV",
    status: "ACTIVE",
    state: "ON_AIR",
    offAirReason: null,
  },
  schedule: {
    generatedAt: new Date(created).toISOString(),
    windowEndsAt: new Date(created + 120_000).toISOString(),
    cycleDurationMs: 120_000,
    nowPlaying: {
      occurrenceKey: "synthetic-occurrence",
      source: "AUTO",
      video,
      startsAt: new Date(created - 30_000).toISOString(),
      endsAt: new Date(created + 90_000).toISOString(),
      playbackOffsetMs: 30_000,
    },
    upNext: null,
    guide: [],
    adBreaks: [],
  },
  playback: {
    exactMidProgramSynchronization: false,
    strategy: "BEST_EFFORT_PROGRESSIVE_MP4",
    conceptualOffsetMs: 30_000,
    limitation: "Synthetic timeline",
  },
} as PublicCreatorTvResponse;
const linear = {
  provider: {
    providerKey: "synthetic",
    configured: true,
    status: "READY",
    hlsUrl: "https://provider.invalid/content.m3u8",
    providerResourceId: "synthetic-resource",
  },
  hls: { available: true, url: "https://provider.invalid/content.m3u8" },
  monetization: {
    signaling: {
      enabled: true,
      format: "HLS_CUE_OUT_IN",
      scte35Binary: false,
      emergencyKillSwitch: false,
      taskKillSwitch: false,
      reason: null,
    },
    dai: {
      provider: "GOOGLE_AD_MANAGER_DAI",
      integration: "SSB",
      configured: true,
      available: true,
      assetKey: "synthetic-asset",
      playbackUrl: "https://pubads.g.doubleclick.net/ssai/event/synthetic/master.m3u8",
      contentSourceUrl: "https://provider.invalid/content.m3u8",
      attribution: {
        tvChannelId: "synthetic-tv",
        channelId: "synthetic-channel",
        channelHandle: "synthetic",
        networkCode: "123",
      },
      reason: null,
    },
    clientSideImaFallback: true,
    opportunities: [],
  },
  fallback: { strategy: "PROGRESSIVE_MP4", enabled: true },
} as CreatorTvLinearCapability;

Object.assign(window, {
  consentHarness: {
    statistics,
    generatedAt: created,
    change(value: AdvertisingConsentSnapshot) {
      consent = value;
      for (const listener of [...subscribers]) listener();
    },
    holdGpt(value: boolean) {
      holdGpt = value;
    },
    flushGpt() {
      holdGpt = false;
      for (const callback of gptCommands.splice(0)) callback();
    },
    gptRender(index: number) {
      pubads.emit("slotRenderEnded", { slot: slots[index], isEmpty: false });
    },
    completeAd(index: number) {
      managers[index]?.emit("COMPLETE");
      managers[index]?.emit("CONTENT_RESUME_REQUESTED");
    },
    lateAd(index: number) {
      managers[index]?.emit("STARTED");
      managers[index]?.emit("CONTENT_PAUSE_REQUESTED");
      managers[index]?.emit("CONTENT_RESUME_REQUESTED");
    },
    lateHls() {
      for (const instance of hlsInstances) {
        instance.emit("manifest");
        instance.emit("error", { fatal: true, type: "networkError" });
      }
    },
    render(mode: "page" | "video" | "tv" | "empty") {
      root.render(
        <StrictMode>
          <I18nProvider locale="en">
            {mode === "page" ? (
              <PageAdSlot placementKey="home_top" />
            ) : mode === "video" ? (
              <AdEnabledAyinPlayer
                videoId="synthetic-video"
                title="Synthetic video"
                sourceUrl="/test.mp4"
                autoPlay
                muted
                progressEnabled={false}
              />
            ) : mode === "tv" ? (
              <CreatorTvPlayer initialData={tv} initialLinear={linear} />
            ) : null}
          </I18nProvider>
        </StrictMode>,
      );
    },
  },
});
