import { stripLocalePrefix } from "./i18n/routing";
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
import {
  detectWebOsRuntime,
  isSupportedLgWebOsRuntime,
  parseLgWebOsChromiumMajor,
  requestWebOsExit,
} from "./webos-tv-bridge";

type TizenInputDevice = {
  getSupportedKeys?: () => Array<{ name?: string | null }>;
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

export interface TvExitRequestDetail {
  platform: "tizen" | "webos";
}

declare global {
  interface Window {
    tizen?: {
      tvinputdevice?: TizenInputDevice;
      application?: TizenApplication;
    };
  }

  interface WindowEventMap {
    "ayin:tv-exit-request": CustomEvent<TvExitRequestDetail>;
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
    parseSamsungTizenVersion(target.navigator.userAgent) !== null ||
    isCanonicalHostedTizen(target)
  ) {
    return "tizen";
  }
  if (detectWebOsRuntime(target)) return "webos";
  return null;
}

const TIZEN_HOSTED_SESSION_KEY = "ayin:tizen-hosted";
const TIZEN_EXIT_PENDING_KEY = "ayin:tizen-exit-pending";

function isCanonicalHostedTizen(target: Window): boolean {
  try {
    const url = new URL(target.location.href);
    return (
      url.protocol === "https:" &&
      url.hostname === "ayin.stream" &&
      url.searchParams.get("platform") === "tizen" &&
      url.searchParams.get("hosted") === "1"
    );
  } catch {
    return false;
  }
}

function readSessionFlag(target: Window, key: string): boolean {
  try {
    return target.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeSessionFlag(target: Window, key: string, enabled: boolean): void {
  try {
    if (enabled) target.sessionStorage.setItem(key, "1");
    else target.sessionStorage.removeItem(key);
  } catch {
    // TV storage can be unavailable in restricted/private environments.
  }
}

function rememberHostedTizenSession(target: Window): boolean {
  if (isCanonicalHostedTizen(target)) {
    writeSessionFlag(target, TIZEN_HOSTED_SESSION_KEY, true);
    return true;
  }

  try {
    return (
      new URL(target.location.href).hostname === "ayin.stream" &&
      readSessionFlag(target, TIZEN_HOSTED_SESSION_KEY)
    );
  } catch {
    return false;
  }
}

export function isTvHomePathname(pathname: string): boolean {
  return stripLocalePrefix(pathname || "/") === "/";
}

export function normalizeTvRemoteEvent(
  event: Pick<KeyboardEvent, "key" | "keyCode">,
): NativeRemoteKey | null {
  return KEY_BY_NAME[event.key] ?? KEY_BY_CODE[event.keyCode] ?? null;
}

export function installTvPlatformRuntime(target: Window = window): () => void {
  const nativeShell = detectNativeShell();
  const platform = nativeShell?.platform ?? detectTvWebPlatform(target);
  const packagedTizenSession = platform === "tizen" && rememberHostedTizenSession(target);
  const pausedForLifecycle = new Set<HTMLMediaElement>();
  const tizenMediaKeyRegistration = registerTizenMediaKeys(target);

  if (platform) target.document.documentElement.dataset.tvPlatform = platform;
  if (platform === "tizen") {
    const version = parseSamsungTizenVersion(target.navigator.userAgent);
    target.document.documentElement.dataset.tizenVersion =
      version === null ? "unknown" : String(version);
    target.document.documentElement.dataset.tizenMediaKeys = tizenMediaKeyRegistration;
  }
  if (platform === "webos") {
    const chromiumMajor = parseLgWebOsChromiumMajor(target.navigator.userAgent);
    target.document.documentElement.dataset.webosChromium =
      chromiumMajor === null ? "unknown" : String(chromiumMajor);
    target.document.documentElement.dataset.webosSupported = String(
      isSupportedLgWebOsRuntime(target.navigator.userAgent),
    );
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
    if (!hidden && (platform === "tizen" || platform === "webos")) {
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

  const continueTizenExit = () => {
    if (!packagedTizenSession || !readSessionFlag(target, TIZEN_EXIT_PENDING_KEY)) return;
    if (target.history.length <= 1) {
      writeSessionFlag(target, TIZEN_EXIT_PENDING_KEY, false);
      return;
    }
    target.history.back();
  };

  const onPopState = () => continueTizenExit();

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

    if (event.detail.key === "BACK" && platform === "tizen" && packagedTizenSession) {
      event.preventDefault();
      if (!isTvHomePathname(target.location.pathname)) {
        target.history.back();
      } else {
        target.dispatchEvent(
          new CustomEvent<TvExitRequestDetail>("ayin:tv-exit-request", {
            detail: { platform: "tizen" },
          }),
        );
      }
      return;
    }

    if (event.detail.key === "BACK" && platform === "webos") {
      event.preventDefault();
      if (!isTvHomePathname(target.location.pathname)) {
        target.history.back();
      } else {
        target.dispatchEvent(
          new CustomEvent<TvExitRequestDetail>("ayin:tv-exit-request", {
            detail: { platform: "webos" },
          }),
        );
      }
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
  target.addEventListener("popstate", onPopState);
  target.document.addEventListener("webOSLaunch", onWebOsLaunch as EventListener);
  target.document.addEventListener("webOSRelaunch", onWebOsLaunch as EventListener);

  return () => {
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("ayin:native-remote", onNativeRemote);
    target.removeEventListener("ayin:native-lifecycle", onNativeLifecycle);
    target.removeEventListener("ayin:native-network", onNativeNetwork);
    target.document.removeEventListener("visibilitychange", onVisibility);
    target.removeEventListener("pagehide", onPageHide);
    target.removeEventListener("popstate", onPopState);
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

  if (detectTvWebPlatform(target) === "tizen" && rememberHostedTizenSession(target)) {
    try {
      if (target.history.length > 1) {
        writeSessionFlag(target, TIZEN_EXIT_PENDING_KEY, true);
        target.history.back();
        return true;
      }
      writeSessionFlag(target, TIZEN_EXIT_PENDING_KEY, false);
    } catch {
      return false;
    }
  }

  if (detectWebOsRuntime(target)) return requestWebOsExit(target);

  return false;
}

export type TizenMediaKeyRegistration = "registered" | "unavailable" | "failed";

export function registerTizenMediaKeys(target: Window): TizenMediaKeyRegistration {
  const input = target.tizen?.tvinputdevice;
  if (!input) return "unavailable";
  try {
    const supported = input.getSupportedKeys?.() ?? [];
    const supportedNames = new Set(supported.flatMap((key) => (key.name ? [key.name] : [])));
    const keys =
      supported.length === 0
        ? TIZEN_MEDIA_KEYS
        : TIZEN_MEDIA_KEYS.filter((key) => supportedNames.has(key));

    if (keys.length === 0) return "unavailable";
    if (input.registerKeyBatch) {
      input.registerKeyBatch(keys);
      return "registered";
    }
    for (const key of keys) input.registerKey?.(key);
    return "registered";
  } catch {
    // Hosted Samsung content does not expose Tizen APIs. Registration is best-effort
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
