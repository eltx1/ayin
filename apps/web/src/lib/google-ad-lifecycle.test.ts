import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdvertisingConsentSnapshot } from "./advertising-consent";
import type { VideoAdCallbacks } from "./video-ads";

const consent: AdvertisingConsentSnapshot = {
  mode: "NON_PERSONALIZED",
  source: "CMP",
  providerManaged: true,
};

class Events {
  listeners = new Map<string, Set<(event: unknown) => void>>();
  addEventListener(type: string, listener: (event: unknown) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, event: unknown = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

function scriptHarness() {
  const script = Object.assign(new Events(), { src: "", async: false, crossOrigin: "" });
  vi.stubGlobal("document", {
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => script,
    head: { append: vi.fn() },
  });
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  return script;
}

function gptHarness(queued = false) {
  const callbacks: Array<() => void> = [];
  const pubads = Object.assign(new Events(), { setPrivacySettings: vi.fn() });
  const slot = { setConfig: vi.fn().mockReturnThis(), addService: vi.fn().mockReturnThis() };
  const gpt = {
    cmd: { push: (callback: () => void) => (queued ? callbacks.push(callback) : callback()) },
    pubads: () => pubads,
    defineSlot: vi.fn(() => slot),
    display: vi.fn(),
    destroySlots: vi.fn(),
    enableServices: vi.fn(),
  };
  return { gpt, pubads, slot, flush: () => callbacks.splice(0).forEach((callback) => callback()) };
}

function imaHarness() {
  const loaders: AdsLoader[] = [],
    managers: AdsManager[] = [];
  const attach = vi.fn();
  class AdsManager extends Events {
    init = vi.fn();
    start = vi.fn();
    destroy = vi.fn();
  }
  class AdsLoader extends Events {
    constructor() {
      super();
      loaders.push(this);
    }
    requestAds = vi.fn();
    contentComplete = vi.fn();
    destroy = vi.fn();
    loaded() {
      const manager = new AdsManager();
      managers.push(manager);
      this.emit("ADS_MANAGER_LOADED", { getAdsManager: () => manager });
      return manager;
    }
  }
  const ima = {
    AdDisplayContainer: class {
      constructor() {
        attach();
      }
      initialize() {}
    },
    AdsLoader,
    AdsRequest: class {
      setAdWillAutoPlay() {}
      setAdWillPlayMuted() {}
    },
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
        ].map((type) => [type, type]),
      ),
    },
    ViewMode: { NORMAL: "normal" },
  };
  return { ima, loaders, managers, attach };
}

const targets = () => ({
  container: { clientWidth: 640, clientHeight: 360 } as HTMLDivElement,
  video: { muted: true } as HTMLVideoElement,
});
const callbacks = (): VideoAdCallbacks => ({
  onEvent: vi.fn(),
  onContentPause: vi.fn(),
  onContentResume: vi.fn(),
});

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("GPT mount ownership", () => {
  it("settles a canceled queued command without waiting for GPT to drain it", async () => {
    scriptHarness();
    const { gpt, flush } = gptHarness(true);
    Object.assign(window, { googletag: gpt });
    const { mountGooglePublisherTagSlot } = await import("./google-gpt-page-ad-service");
    const controller = new AbortController();
    const mounting = mountGooglePublisherTagSlot({
      divId: "slot",
      adUnitPath: "/123/synthetic",
      sizes: [[300, 250]],
      responsive: [],
      consent,
      signal: controller.signal,
      onRender: vi.fn(),
    });
    await Promise.resolve();
    controller.abort();
    const cleanup = await mounting;
    flush();
    cleanup();
    expect(gpt.defineSlot).not.toHaveBeenCalled();
  });

  it("releases a partially constructed slot when GPT throws", async () => {
    scriptHarness();
    const { gpt, slot, pubads } = gptHarness();
    slot.setConfig.mockImplementation(() => {
      throw new Error("synthetic GPT failure");
    });
    Object.assign(window, { googletag: gpt });
    const { mountGooglePublisherTagSlot } = await import("./google-gpt-page-ad-service");
    await expect(
      mountGooglePublisherTagSlot({
        divId: "slot",
        adUnitPath: "/123/synthetic",
        sizes: [[300, 250]],
        responsive: [],
        consent,
        onRender: vi.fn(),
      }),
    ).rejects.toThrow("synthetic GPT failure");
    expect(gpt.destroySlots).toHaveBeenCalledTimes(1);
    expect(pubads.listeners.get("slotRenderEnded")?.size).toBe(0);
  });
  it.each(["script", "command"])(
    "cannot display after abort while awaiting the %s",
    async (phase) => {
      const script = scriptHarness();
      const harness = gptHarness(phase === "command");
      if (phase === "command") Object.assign(window, { googletag: harness.gpt });
      const { mountGooglePublisherTagSlot } = await import("./google-gpt-page-ad-service");
      const controller = new AbortController();
      const input = {
        divId: "slot",
        adUnitPath: "/123/synthetic",
        sizes: [[300, 250]] as [number, number][],
        responsive: [],
        consent,
        onRender: vi.fn(),
        signal: controller.signal,
      };
      const mounting = mountGooglePublisherTagSlot(input);
      await Promise.resolve();
      controller.abort();
      Object.assign(window, { googletag: harness.gpt });
      script.emit("load");
      harness.flush();
      const cleanup = await mounting;
      cleanup();
      expect(harness.gpt.defineSlot).not.toHaveBeenCalled();
      expect(harness.gpt.display).not.toHaveBeenCalled();
    },
  );

  it("destroys an owned slot once and ignores queued render callbacks after abort", async () => {
    scriptHarness();
    const { gpt, pubads, slot } = gptHarness();
    Object.assign(window, { googletag: gpt });
    const { mountGooglePublisherTagSlot } = await import("./google-gpt-page-ad-service");
    const controller = new AbortController(),
      onRender = vi.fn();
    const input = {
      divId: "slot",
      adUnitPath: "/123/synthetic",
      sizes: [[300, 250]] as [number, number][],
      responsive: [],
      consent,
      onRender,
      signal: controller.signal,
    };
    const cleanup = await mountGooglePublisherTagSlot(input);
    const pending = [...pubads.listeners.get("slotRenderEnded")!][0]!;
    controller.abort();
    cleanup();
    cleanup();
    pending({ slot, isEmpty: false });
    expect(gpt.destroySlots).toHaveBeenCalledTimes(1);
    expect(onRender).not.toHaveBeenCalled();
  });
});

describe("IMA request ownership", () => {
  it("rejects overlapping breaks before a second provider request and accepts the next completed break", async () => {
    scriptHarness();
    const harness = imaHarness();
    Object.assign(window, { google: { ima: harness.ima } });
    const { GoogleImaVideoAdService } = await import("./google-ima-video-ad-service");
    const service = new GoogleImaVideoAdService(),
      { container, video } = targets();
    await service.initialize(container, video);
    const first = service.play("PRE_ROLL", "https://ads.invalid/synthetic", callbacks());
    const overlapping = callbacks();
    await expect(
      service.play("MID_ROLL", "https://ads.invalid/synthetic", overlapping),
    ).rejects.toThrow("IMA_REQUEST_IN_PROGRESS");
    expect(harness.loaders[0]!.requestAds).toHaveBeenCalledTimes(1);
    expect(overlapping.onEvent).not.toHaveBeenCalled();
    harness.loaders[0]!.loaded().emit("CONTENT_RESUME_REQUESTED");
    await first;
    const next = service.play("MID_ROLL", "https://ads.invalid/synthetic", callbacks());
    expect(harness.loaders[0]!.requestAds).toHaveBeenCalledTimes(2);
    service.destroy();
    await next;
  });

  it("handles duplicate SDK failures once and removes loader listeners", async () => {
    scriptHarness();
    const harness = imaHarness();
    Object.assign(window, { google: { ima: harness.ima } });
    const { GoogleImaVideoAdService } = await import("./google-ima-video-ad-service");
    const service = new GoogleImaVideoAdService(),
      { container, video } = targets();
    await service.initialize(container, video);
    const listener = callbacks();
    const playback = service.play("PRE_ROLL", "https://ads.invalid/synthetic", listener);
    const loader = harness.loaders[0]!;
    const pending = [...loader.listeners.get("AD_ERROR")!][0]!;
    const error = { getError: () => ({ getErrorCode: () => 303 }) };
    pending(error);
    pending(error);
    await playback;
    expect(listener.onEvent).toHaveBeenCalledTimes(2);
    expect(listener.onEvent).toHaveBeenLastCalledWith("ERROR", "IMA_NO_FILL_303");
    expect(listener.onContentResume).toHaveBeenCalledTimes(1);
    expect(loader.listeners.get("ADS_MANAGER_LOADED")?.size).toBe(0);
    service.destroy();
  });
  it("cannot attach after destroy while the SDK is loading", async () => {
    const script = scriptHarness(),
      harness = imaHarness();
    const { GoogleImaVideoAdService } = await import("./google-ima-video-ad-service");
    const service = new GoogleImaVideoAdService(),
      { container, video } = targets();
    const initializing = service.initialize(container, video).catch(() => undefined);
    service.destroy();
    Object.assign(window, { google: { ima: harness.ima } });
    script.emit("load");
    await initializing;
    expect(harness.attach).not.toHaveBeenCalled();
  });

  it("only the current pre/mid/postroll observes each manager and ad event", async () => {
    scriptHarness();
    const harness = imaHarness();
    Object.assign(window, { google: { ima: harness.ima } });
    const { GoogleImaVideoAdService } = await import("./google-ima-video-ad-service");
    const service = new GoogleImaVideoAdService(),
      { container, video } = targets();
    await service.initialize(container, video);
    const listeners = [callbacks(), callbacks(), callbacks()];
    for (const [index, slot] of (["PRE_ROLL", "MID_ROLL", "POST_ROLL"] as const).entries()) {
      const playback = service.play(slot, "https://ads.invalid/synthetic", listeners[index]!);
      const manager = harness.loaders[0]!.loaded();
      manager.emit("STARTED");
      manager.emit("CONTENT_RESUME_REQUESTED");
      await playback;
      expect(manager.start).toHaveBeenCalledTimes(1);
      expect(listeners[index]!.onEvent).toHaveBeenCalledTimes(2);
      for (const earlier of listeners.slice(0, index)) {
        expect(earlier.onEvent).toHaveBeenCalledTimes(2);
        expect(earlier.onContentResume).toHaveBeenCalledTimes(1);
      }
    }
    service.destroy();
  });

  it("settles canceled playback and fences already-queued loader and manager callbacks", async () => {
    scriptHarness();
    const harness = imaHarness();
    Object.assign(window, { google: { ima: harness.ima } });
    const { GoogleImaVideoAdService } = await import("./google-ima-video-ad-service");
    const service = new GoogleImaVideoAdService(),
      { container, video } = targets();
    await service.initialize(container, video);
    const listener = callbacks();
    const playback = service.play("PRE_ROLL", "https://ads.invalid/synthetic", listener);
    const loader = harness.loaders[0]!;
    const pendingLoaded = [...loader.listeners.get("ADS_MANAGER_LOADED")!][0]!;
    const manager = loader.loaded();
    const pendingPause = [...manager.listeners.get("CONTENT_PAUSE_REQUESTED")!][0]!;
    const pendingStart = [...manager.listeners.get("STARTED")!][0]!;
    service.destroy();
    pendingLoaded({ getAdsManager: vi.fn(() => manager) });
    pendingPause({});
    pendingStart({});
    expect(manager.start).toHaveBeenCalledTimes(1);
    expect(listener.onEvent).toHaveBeenCalledTimes(1);
    expect(listener.onContentPause).not.toHaveBeenCalled();
    await playback;
  });
});
