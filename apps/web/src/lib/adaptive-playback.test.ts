import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyHlsFailure,
  startAdaptiveHlsPlayback,
  supportsNativeHls,
  type AyinPlaybackRendition,
} from "./adaptive-playback";

class FakeVideo {
  src = "";
  private listeners = new Map<string, Set<() => void>>();

  constructor(private readonly nativeHls = false) {}

  canPlayType(type: string) {
    return this.nativeHls && type.includes("mpegurl") ? "probably" : "";
  }

  addEventListener(type: string, callback: () => void) {
    const callbacks = this.listeners.get(type) ?? new Set<() => void>();
    callbacks.add(callback);
    this.listeners.set(type, callbacks);
  }

  removeEventListener(type: string, callback: () => void) {
    this.listeners.get(type)?.delete(callback);
  }

  load() {}

  emit(type: string) {
    for (const callback of this.listeners.get(type) ?? []) callback();
  }
}

class FakeHls {
  static Events = {
    MEDIA_ATTACHED: "media-attached",
    MANIFEST_PARSED: "manifest-parsed",
    LEVEL_SWITCHED: "level-switched",
    FRAG_BUFFERED: "frag-buffered",
    ERROR: "error",
  };

  static isSupported() {
    return true;
  }

  static last: FakeHls | null = null;

  levels = [
    { width: 640, height: 360, bitrate: 800_000 },
    { width: 1280, height: 720, bitrate: 3_000_000 },
  ];
  currentLevel = -1;
  nextLevel = -1;
  startLoadCalls = 0;
  recoverMediaErrorCalls = 0;
  destroyed = false;
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  constructor() {
    FakeHls.last = this;
  }

  on(event: string, callback: (...args: unknown[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), callback]);
  }

  emit(event: string, data?: unknown) {
    for (const callback of this.listeners.get(event) ?? []) callback(event, data);
  }

  attachMedia() {
    this.emit(FakeHls.Events.MEDIA_ATTACHED);
  }

  loadSource() {
    this.emit(FakeHls.Events.MANIFEST_PARSED);
  }

  startLoad() {
    this.startLoadCalls += 1;
  }

  recoverMediaError() {
    this.recoverMediaErrorCalls += 1;
  }

  destroy() {
    this.destroyed = true;
  }
}

afterEach(() => {
  FakeHls.last = null;
  vi.unstubAllGlobals();
});

describe("AYIN adaptive playback abstraction", () => {
  it("prefers native HLS capability without loading the JavaScript adapter", async () => {
    const video = new FakeVideo(true);
    const ready = vi.fn();

    expect(supportsNativeHls(video as never)).toBe(true);
    const session = await startAdaptiveHlsPlayback({
      video: video as never,
      hlsUrl: "https://media.ayin.test/master.m3u8",
      callbacks: { onReady: ready },
    });

    expect(session?.native).toBe(true);
    expect(video.src).toBe("https://media.ayin.test/master.m3u8");
    video.emit("loadedmetadata");
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("uses engine-owned AUTO ABR and exposes only manifest renditions", async () => {
    vi.stubGlobal("window", {
      Hls: FakeHls,
      setTimeout,
      clearTimeout,
    });
    const video = new FakeVideo(false);
    const qualities: AyinPlaybackRendition[][] = [];
    const switches: Array<{ selection: string; label: string | null }> = [];

    const session = await startAdaptiveHlsPlayback({
      video: video as never,
      hlsUrl: "https://media.ayin.test/master.m3u8",
      callbacks: {
        onQualities: (items) => qualities.push(items),
        onQualitySwitch: ({ selection, rendition }) =>
          switches.push({ selection, label: rendition?.label ?? null }),
      },
    });

    expect(session?.native).toBe(false);
    expect(qualities[0]).toEqual([
      { id: "level-0", label: "360p", width: 640, height: 360, bitrateKbps: 800 },
      { id: "level-1", label: "720p", width: 1280, height: 720, bitrateKbps: 3000 },
    ]);
    expect(FakeHls.last?.currentLevel).toBe(-1);

    session?.setQuality("level-1");
    expect(FakeHls.last?.currentLevel).toBe(1);
    expect(switches.at(-1)).toEqual({ selection: "MANUAL", label: "720p" });

    session?.setQuality(null);
    expect(FakeHls.last?.currentLevel).toBe(-1);
    expect(switches.at(-1)).toEqual({ selection: "AUTO", label: null });
  });

  it("bounds recoverable network/media retries before reporting a fatal failure", async () => {
    vi.stubGlobal("window", {
      Hls: FakeHls,
      setTimeout,
      clearTimeout,
    });
    const fatal = vi.fn();
    await startAdaptiveHlsPlayback({
      video: new FakeVideo(false) as never,
      hlsUrl: "https://media.ayin.test/master.m3u8",
      callbacks: { onFatal: fatal },
    });
    const hls = FakeHls.last!;

    hls.emit(FakeHls.Events.ERROR, { fatal: true, type: "networkError", details: "fragLoadError" });
    hls.emit(FakeHls.Events.ERROR, { fatal: true, type: "networkError", details: "fragLoadError" });
    expect(hls.startLoadCalls).toBe(2);
    expect(fatal).not.toHaveBeenCalled();

    hls.emit(FakeHls.Events.ERROR, { fatal: true, type: "networkError", details: "fragLoadError" });
    expect(fatal).toHaveBeenCalledOnce();
    expect(fatal).toHaveBeenCalledWith("NETWORK");
  });

  it("treats a malformed/unloadable manifest as fatal instead of retry-looping", async () => {
    vi.stubGlobal("window", {
      Hls: FakeHls,
      setTimeout,
      clearTimeout,
    });
    const fatal = vi.fn();
    await startAdaptiveHlsPlayback({
      video: new FakeVideo(false) as never,
      hlsUrl: "https://media.ayin.test/broken.m3u8",
      callbacks: { onFatal: fatal },
    });

    FakeHls.last!.emit(FakeHls.Events.ERROR, {
      fatal: true,
      type: "networkError",
      details: "manifestLoadError",
    });

    expect(fatal).toHaveBeenCalledWith("MANIFEST");
    expect(FakeHls.last!.startLoadCalls).toBe(0);
  });

  it("classifies failure metadata without exposing hls.js types to callers", () => {
    expect(classifyHlsFailure({ type: "mediaError", details: "bufferAppendError" })).toBe("MEDIA");
    expect(classifyHlsFailure({ type: "networkError", details: "manifestLoadError" })).toBe(
      "MANIFEST",
    );
  });
});
