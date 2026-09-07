"use client";

export type AyinPlaybackProtocol = "HLS" | "MP4";

export interface AyinPlaybackRendition {
  id: string;
  label: string;
  width: number | null;
  height: number | null;
  bitrateKbps: number | null;
}

export interface AyinAdaptivePlaybackSession {
  protocol: "HLS";
  native: boolean;
  setQuality(renditionId: string | null): void;
  destroy(): void;
}

export interface AyinAdaptivePlaybackCallbacks {
  onReady?: (() => void) | undefined;
  onQualities?: ((renditions: AyinPlaybackRendition[]) => void) | undefined;
  onQualitySwitch?:
    | ((input: {
        selection: "AUTO" | "MANUAL";
        rendition: AyinPlaybackRendition | null;
        automatic: boolean;
      }) => void)
    | undefined;
  onFatal?:
    | ((reason: "NETWORK" | "MEDIA" | "MANIFEST" | "STARTUP" | "UNSUPPORTED" | "OTHER") => void)
    | undefined;
}

interface HlsLevel {
  width?: number;
  height?: number;
  bitrate?: number;
  name?: string;
}

interface HlsErrorData {
  fatal?: boolean;
  type?: string;
  details?: string;
}

interface HlsInstance {
  levels: HlsLevel[];
  currentLevel: number;
  nextLevel: number;
  autoLevelEnabled?: boolean;
  attachMedia(video: HTMLVideoElement): void;
  loadSource(url: string): void;
  on(event: string, callback: (...args: unknown[]) => void): void;
  startLoad(): void;
  recoverMediaError(): void;
  destroy(): void;
}

interface HlsConstructor {
  new (config?: Record<string, unknown>): HlsInstance;
  isSupported(): boolean;
  Events: {
    MEDIA_ATTACHED: string;
    MANIFEST_PARSED: string;
    LEVEL_SWITCHED: string;
    FRAG_BUFFERED: string;
    ERROR: string;
  };
}

declare global {
  interface Window {
    Hls?: HlsConstructor;
  }
}

const HLS_JS_URL = "https://cdn.jsdelivr.net/npm/hls.js@1.7.2/dist/hls.min.js";
let hlsScriptPromise: Promise<HlsConstructor> | null = null;

function loadHlsRuntime(): Promise<HlsConstructor> {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (hlsScriptPromise) return hlsScriptPromise;

  hlsScriptPromise = new Promise<HlsConstructor>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-ayin-hls-runtime]");
    const script = existing ?? document.createElement("script");
    const timeout = window.setTimeout(() => reject(new Error("HLS runtime load timeout")), 8_000);
    const done = () => {
      window.clearTimeout(timeout);
      if (window.Hls) resolve(window.Hls);
      else reject(new Error("HLS runtime unavailable"));
    };
    const failed = () => {
      window.clearTimeout(timeout);
      reject(new Error("HLS runtime failed to load"));
    };
    script.addEventListener("load", done, { once: true });
    script.addEventListener("error", failed, { once: true });
    if (!existing) {
      script.async = true;
      script.crossOrigin = "anonymous";
      script.referrerPolicy = "no-referrer";
      script.dataset.ayinHlsRuntime = "true";
      script.src = HLS_JS_URL;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    hlsScriptPromise = null;
    throw error;
  });
  return hlsScriptPromise;
}

export function supportsNativeHls(video: HTMLVideoElement): boolean {
  return Boolean(
    video.canPlayType("application/vnd.apple.mpegurl") ||
      video.canPlayType("application/x-mpegURL"),
  );
}

function renditionForLevel(level: HlsLevel, index: number): AyinPlaybackRendition {
  const height = Number.isFinite(level.height) && level.height ? Math.floor(level.height) : null;
  const width = Number.isFinite(level.width) && level.width ? Math.floor(level.width) : null;
  const bitrateKbps =
    Number.isFinite(level.bitrate) && level.bitrate ? Math.round(level.bitrate / 1000) : null;
  return {
    id: `level-${index}`,
    label: level.name || (height ? `${height}p` : bitrateKbps ? `${bitrateKbps} kbps` : `Quality ${index + 1}`),
    width,
    height,
    bitrateKbps,
  };
}

function classifyFatal(data: HlsErrorData): Parameters<NonNullable<AyinAdaptivePlaybackCallbacks["onFatal"]>>[0] {
  const detail = `${data.type ?? ""} ${data.details ?? ""}`.toLowerCase();
  if (detail.includes("manifest")) return "MANIFEST";
  if (detail.includes("network")) return "NETWORK";
  if (detail.includes("media")) return "MEDIA";
  return "OTHER";
}

export async function startAdaptiveHlsPlayback(input: {
  video: HTMLVideoElement;
  hlsUrl: string;
  callbacks?: AyinAdaptivePlaybackCallbacks | undefined;
}): Promise<AyinAdaptivePlaybackSession | null> {
  const { video, hlsUrl, callbacks = {} } = input;

  if (supportsNativeHls(video)) {
    let destroyed = false;
    const ready = () => {
      if (!destroyed) callbacks.onReady?.();
    };
    video.addEventListener("loadedmetadata", ready, { once: true });
    video.src = hlsUrl;
    video.load();
    return {
      protocol: "HLS",
      native: true,
      setQuality: () => undefined,
      destroy() {
        destroyed = true;
        video.removeEventListener("loadedmetadata", ready);
      },
    };
  }

  let Hls: HlsConstructor;
  try {
    Hls = await loadHlsRuntime();
  } catch {
    callbacks.onFatal?.("UNSUPPORTED");
    return null;
  }
  if (!Hls.isSupported()) {
    callbacks.onFatal?.("UNSUPPORTED");
    return null;
  }

  const hls = new Hls({
    startLevel: -1,
    autoStartLoad: true,
    enableWorker: true,
    capLevelToPlayerSize: true,
    maxBufferLength: 30,
    backBufferLength: 30,
  });
  let destroyed = false;
  let networkRecoveries = 0;
  let mediaRecoveries = 0;
  let renditions: AyinPlaybackRendition[] = [];
  let manualSelection = false;

  hls.on(Hls.Events.MEDIA_ATTACHED, () => {
    if (!destroyed) hls.loadSource(hlsUrl);
  });
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    if (destroyed) return;
    renditions = hls.levels.map(renditionForLevel);
    callbacks.onQualities?.(renditions);
    callbacks.onReady?.();
  });
  hls.on(Hls.Events.FRAG_BUFFERED, () => {
    networkRecoveries = 0;
  });
  hls.on(Hls.Events.LEVEL_SWITCHED, (...args: unknown[]) => {
    if (destroyed) return;
    const data = args.at(-1) as { level?: number } | undefined;
    const index = typeof data?.level === "number" ? data.level : hls.currentLevel;
    callbacks.onQualitySwitch?.({
      selection: manualSelection ? "MANUAL" : "AUTO",
      rendition: index >= 0 ? (renditions[index] ?? null) : null,
      automatic: !manualSelection,
    });
  });
  hls.on(Hls.Events.ERROR, (...args: unknown[]) => {
    if (destroyed) return;
    const data = (args.at(-1) ?? {}) as HlsErrorData;
    if (!data.fatal) return;
    const reason = classifyFatal(data);
    if (reason === "NETWORK" && networkRecoveries < 2) {
      networkRecoveries += 1;
      hls.startLoad();
      return;
    }
    if (reason === "MEDIA" && mediaRecoveries < 2) {
      mediaRecoveries += 1;
      hls.recoverMediaError();
      return;
    }
    callbacks.onFatal?.(reason);
  });
  hls.attachMedia(video);

  return {
    protocol: "HLS",
    native: false,
    setQuality(renditionId: string | null) {
      if (renditionId === null) {
        manualSelection = false;
        hls.currentLevel = -1;
        hls.nextLevel = -1;
        callbacks.onQualitySwitch?.({ selection: "AUTO", rendition: null, automatic: true });
        return;
      }
      const index = renditions.findIndex((item) => item.id === renditionId);
      if (index < 0) return;
      manualSelection = true;
      hls.currentLevel = index;
      hls.nextLevel = index;
      callbacks.onQualitySwitch?.({
        selection: "MANUAL",
        rendition: renditions[index] ?? null,
        automatic: false,
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      hls.destroy();
    },
  };
}
