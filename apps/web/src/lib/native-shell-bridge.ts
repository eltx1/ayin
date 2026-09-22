export type NativeShellPlatform =
  "android" | "android-tv" | "google-tv" | "fire-tv" | "tizen" | "webos";

export type NativeRemoteKey =
  | "UP"
  | "DOWN"
  | "LEFT"
  | "RIGHT"
  | "SELECT"
  | "BACK"
  | "PLAY_PAUSE"
  | "PLAY"
  | "PAUSE"
  | "REWIND"
  | "FAST_FORWARD"
  | "MENU";

export type NativeLifecycleState =
  | "pause"
  | "resume"
  | "stop"
  | "configuration-change"
  | "memory-pressure"
  | "renderer-recovered"
  | "relaunch";

export interface NativeShellCapabilities {
  platform: NativeShellPlatform;
  tv: boolean;
  remote: boolean;
  deepLinks: boolean;
  fullscreen: boolean;
  imaRuntimeValidationRequired: boolean;
}

export interface NativeRemoteEventDetail {
  key: NativeRemoteKey;
  platform?: NativeShellPlatform | null;
}

export interface NativeLifecycleEventDetail {
  state: NativeLifecycleState;
  platform?: NativeShellPlatform | null;
  level?: number;
}

export interface NativeNetworkEventDetail {
  online: boolean;
  platform?: NativeShellPlatform | null;
}

declare global {
  interface Window {
    AyinNative?: {
      getPlatform?: () => string;
      openExternal?: (url: string) => void;
      setFullscreen?: (enabled: boolean) => void;
      notifyPlaybackState?: (state: string) => void;
    };
  }

  interface WindowEventMap {
    "ayin:native-remote": CustomEvent<NativeRemoteEventDetail>;
    "ayin:native-lifecycle": CustomEvent<NativeLifecycleEventDetail>;
    "ayin:native-network": CustomEvent<NativeNetworkEventDetail>;
  }
}

export function detectNativeShell(): NativeShellCapabilities | null {
  if (typeof window === "undefined" || !window.AyinNative?.getPlatform) return null;
  const platform = normalizePlatform(window.AyinNative.getPlatform());
  if (!platform) return null;
  const tv = platform !== "android";
  return {
    platform,
    tv,
    remote: tv,
    deepLinks: true,
    fullscreen: true,
    imaRuntimeValidationRequired: true,
  };
}

export function normalizePlatform(value: string): NativeShellPlatform | null {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "android" ||
    normalized === "android-tv" ||
    normalized === "google-tv" ||
    normalized === "fire-tv" ||
    normalized === "tizen" ||
    normalized === "webos"
  ) {
    return normalized;
  }
  return null;
}

export function normalizeAyinDeepLink(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      url.protocol === "https:" &&
      url.hostname === "ayin.stream" &&
      (!url.port || url.port === "443")
    ) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
    if (url.protocol !== "ayin:") return null;
    const route = `/${url.hostname}${url.pathname}`.replace(/\/{2,}/g, "/");
    return `${route}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function dispatchNativeRemoteKey(key: NativeRemoteKey) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<NativeRemoteEventDetail>("ayin:native-remote", {
      detail: { key },
      cancelable: true,
    }),
  );
}

export function notifyNativePlaybackState(state: "playing" | "paused" | "ended"): void {
  if (typeof window === "undefined") return;
  window.AyinNative?.notifyPlaybackState?.(state);
}

export function syncNativeFullscreen(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.AyinNative?.setFullscreen?.(enabled);
}

export async function toggleShellAwareFullscreen(element: HTMLElement): Promise<void> {
  if (typeof document === "undefined") return;

  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } finally {
      syncNativeFullscreen(false);
    }
    return;
  }

  try {
    await element.requestFullscreen();
    syncNativeFullscreen(true);
  } catch {
    // Android/TV WebViews can expose native immersive mode even when the DOM fullscreen
    // promise is unavailable. Native shells remain an enhancement; ordinary web must not fail.
    syncNativeFullscreen(true);
  }
}

export function nativeRemotePlayerCommand(
  key: NativeRemoteKey,
): "TOGGLE_PLAY" | "PLAY" | "PAUSE" | "SEEK_BACK" | "SEEK_FORWARD" | null {
  switch (key) {
    case "PLAY_PAUSE":
      return "TOGGLE_PLAY";
    case "PLAY":
      return "PLAY";
    case "PAUSE":
      return "PAUSE";
    case "REWIND":
      return "SEEK_BACK";
    case "FAST_FORWARD":
      return "SEEK_FORWARD";
    default:
      return null;
  }
}
