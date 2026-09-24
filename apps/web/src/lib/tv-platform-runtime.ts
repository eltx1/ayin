import {
  detectNativeShell,
  nativeRemotePlayerCommand,
  syncNativeFullscreen,
  type NativeLifecycleEventDetail,
  type NativeNetworkEventDetail,
  type NativeRemoteEventDetail,
  type NativeRemoteKey,
  type NativeShellPlatform,
} from "./native-shell-bridge";

type TizenInputDevice = {
  registerKey?: (name: string) => void;
  registerKeyBatch?: (
    names: string[],
    success?: () => void,
    error?: (error: unknown) => void,
  ) => void;
};

type TizenApplication = {
  getCurrentApplication?: () => { exit?: () => void };
};

declare global {
  interface Window {
    tizen?: {
      tvinputdevice?: TizenInputDevice;
      application?: TizenApplication;
    };
    webOS?: unknown;
  }
}

export const AYIN_TIZEN_MIN_SUPPORTED_VERSION = 9;

export const TIZEN_MEDIA_KEYS = [
  "MediaPlayPause",
  "MediaPlay",
  "MediaPause",
  "MediaRewind",
  "MediaFastForward",
];

const KEY_BY_CODE: Record<number, NativeRemoteKey> = {
  13: "SELECT",
  37: "LEFT",
  38: "UP",
  39: "RIGHT",
  40: "DOWN",
  10009: "BACK",
  10252: "PLAY_PAUSE",
  412: "REWIND",
  19: "PAUSE",
  415: "PLAY",
  417: "FAST_FORWARD",
  461: "BACK",
};

const KEY_BY_NAME: Record<string, NativeRemoteKey> = {
  ArrowLeft: "LEFT",
  ArrowUp: "UP",
  ArrowRight: "RIGHT",
  ArrowDown: "DOWN",
  Enter: "SELECT",
  Escape: "BACK",
  MediaPlayPause: "PLAY_PAUSE",
  MediaPlay: "PLAY",
  MediaPause: "PAUSE",
  MediaRewind: "REWIND",
  MediaFastForward: "FAST_FORWARD",
};

export function parseSamsungTizenVersion(userAgent: string): number | null {
  const match = /\bTizen\s+(\d+(?:\.\d+)?)/iu.exec(userAgent);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isSupportedSamsungTizenRuntime(userAgent: string): boolean {
  const version = parseSamsungTizenVersion(userAgent);
  return version !== null && version >= AYIN_TIZEN_MIN_SUPPORTED_VERSION;
}

export function detectTvWebPlatform(target: Window = window): NativeShellPlatform | null {
  if (
    target.tizen?.tvinputdevice ||
    parseSamsungTizenVersion(target.navigator.userAgent) !== null
  ) {
    return "tizen";
  }
  if (target.webOS) return "webos";
  return null;
}

export function normalizeTvRemoteEvent(
  event: Pick<KeyboardEvent, "key" | "keyCode">,
): NativeRemoteKey | null {
  return KEY_BY_NAME[event.key] ?? KEY_BY_CODE[event.keyCode] ?? null;
}

export function installTvPlatformRuntime(target: Window = window): () => void {
  const nativeShell = detectNativeShell();
  const platform = nativeShell?.platform ?? detectTvWebPlatform(target);
  const pausedForLifecycle = new Set<HTMLMediaElement>();
  const tizenMediaKeyRegistration = registerTizenMediaKeys(target);

  if (platform) target.document.documentElement.dataset.tvPlatform = platform;
  if (platform === "tizen") {
    const version = parseSamsungTizenVersion(target.navigator.userAgent);
    target.document.documentElement.dataset.tizenVersion =
      version === null ? "unknown" : String(version);
    target.document.documentElement.dataset.tizenMediaKeys = tizenMediaKeyRegistration;
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const key = normalizeTvRemoteEvent(event);
    if (!key) return;
    const remoteEvent = new CustomEvent<NativeRemoteEventDetail>("ayin:native-remote", {
      detail: { key, platform },
      cancelable: true,
    });
    const notConsumed = target.dispatchEvent(remoteEvent);
    if (!notConsumed) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const onVisibility = () => {
    if (nativeShell) return;
    const hidden = target.document.hidden;
    if (!hidden && platform === "tizen") {
      target.dispatchEvent(
        new CustomEvent<NativeNetworkEventDetail>("ayin:native-network", {
          detail: { online: target.navigator.onLine, platform },
        }),
      );
    }
    target.dispatchEvent(
      new CustomEvent<NativeLifecycleEventDetail>("ayin:native-lifecycle", {
        detail: { state: hidden ? "pause" : "resume", platform },
      }),
    );
  };

  const onPageHide = () => {
    target.dispatchEvent(
      new CustomEvent<NativeLifecycleEventDetail>("ayin:native-lifecycle", {
        detail: { state: "stop", platform },
      }),
    );
  };

  const onWebOsLaunch = () => {
    target.dispatchEvent(
      new CustomEvent<NativeLifecycleEventDetail>("ayin:native-lifecycle", {
        detail: { state: "relaunch", platform: "webos" },
      }),
    );
  };

  const onNativeRemote = (event: CustomEvent<NativeRemoteEventDetail>) => {
    if (event.detail.key === "BACK" && target.document.fullscreenElement) {
      event.preventDefault();
      void target.document
        .exitFullscreen()
        .catch(() => undefined)
        .finally(() => syncNativeFullscreen(false));
      return;
    }

    const command = nativeRemotePlayerCommand(event.detail.key);
    if (!command) return;
    const video = activeVideo(target.document);
    if (!video) return;

    event.preventDefault();
    if (command === "PLAY") {
      void video.play().catch(() => undefined);
      return;
    }
    if (command === "PAUSE") {
      video.pause();
      return;
    }
    if (command === "TOGGLE_PLAY") {
      if (video.paused) void video.play().catch(() => undefined);
      else video.pause();
      return;
    }

    const stage = video.closest<HTMLElement>("[data-player-stage='true']");
    if (!stage) return;
    stage.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: command === "SEEK_BACK" ? "j" : "l",
        bubbles: true,
        cancelable: true,
      }),
    );
  };

  const onNativeLifecycle = (event: CustomEvent<NativeLifecycleEventDetail>) => {
    const state = event.detail.state;
    if (state === "pause" || state === "stop") {
      for (const media of target.document.querySelectorAll<HTMLMediaElement>("video,audio")) {
        if (media.paused || media.ended) continue;
        pausedForLifecycle.add(media);
        media.pause();
      }
      return;
    }
    if (state === "resume" || state === "relaunch" || state === "renderer-recovered") {
      const candidates = [...pausedForLifecycle];
      pausedForLifecycle.clear();
      for (const media of candidates) {
        if (!media.isConnected || media.ended) continue;
        void media.play().catch(() => undefined);
      }
    }
  };

  const onNativeNetwork = (event: CustomEvent<NativeNetworkEventDetail>) => {
    target.document.documentElement.dataset.nativeNetwork = event.detail.online
      ? "online"
      : "offline";
    target.dispatchEvent(new Event(event.detail.online ? "online" : "offline"));
  };

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("ayin:native-remote", onNativeRemote);
  target.addEventListener("ayin:native-lifecycle", onNativeLifecycle);
  target.addEventListener("ayin:native-network", onNativeNetwork);
  target.document.addEventListener("visibilitychange", onVisibility);
  target.addEventListener("pagehide", onPageHide);
  target.document.addEventListener("webOSLaunch", onWebOsLaunch as EventListener);
  target.document.addEventListener("webOSRelaunch", onWebOsLaunch as EventListener);

  return () => {
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("ayin:native-remote", onNativeRemote);
    target.removeEventListener("ayin:native-lifecycle", onNativeLifecycle);
    target.removeEventListener("ayin:native-network", onNativeNetwork);
    target.document.removeEventListener("visibilitychange", onVisibility);
    target.removeEventListener("pagehide", onPageHide);
    target.document.removeEventListener("webOSLaunch", onWebOsLaunch as EventListener);
    target.document.removeEventListener("webOSRelaunch", onWebOsLaunch as EventListener);
    pausedForLifecycle.clear();
  };
}

export function requestTvExit(target: Window = window): boolean {
  if (target.tizen?.application?.getCurrentApplication) {
    try {
      target.tizen.application.getCurrentApplication()?.exit?.();
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export type TizenMediaKeyRegistration = "registered" | "unavailable" | "failed";

export function registerTizenMediaKeys(target: Window): TizenMediaKeyRegistration {
  const input = target.tizen?.tvinputdevice;
  if (!input) return "unavailable";
  try {
    if (input.registerKeyBatch) {
      input.registerKeyBatch(TIZEN_MEDIA_KEYS);
      return "registered";
    }
    for (const key of TIZEN_MEDIA_KEYS) input.registerKey?.(key);
    return "registered";
  } catch {
    // Hosted Samsung apps do not expose Tizen APIs. Media-key registration is capability-driven
    // and must never prevent standard DPAD/Enter/Back or the shared AYIN UI from starting.
    return "failed";
  }
}

function activeVideo(document: Document): HTMLVideoElement | null {
  const active = document.activeElement;
  const activeStage =
    active instanceof HTMLElement
      ? active.closest<HTMLElement>("[data-player-stage='true']")
      : null;
  const activeVideo = activeStage?.querySelector<HTMLVideoElement>("video");
  if (activeVideo) return activeVideo;

  for (const video of document.querySelectorAll<HTMLVideoElement>("video")) {
    const rect = video.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return video;
  }
  return null;
}
