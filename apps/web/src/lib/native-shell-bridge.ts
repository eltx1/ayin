export type NativeShellPlatform = "android" | "android-tv" | "google-tv" | "fire-tv" | "tizen" | "webos";

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

export interface NativeShellCapabilities {
  platform: NativeShellPlatform;
  tv: boolean;
  remote: boolean;
  deepLinks: boolean;
  fullscreen: boolean;
  imaRuntimeValidationRequired: boolean;
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
  )
    return normalized;
  return null;
}

export function normalizeAyinDeepLink(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && url.hostname === "ayin.stream") return `${url.pathname}${url.search}${url.hash}`;
    if (url.protocol !== "ayin:") return null;
    const route = `/${url.hostname}${url.pathname}`.replace(/\/{2,}/g, "/");
    return `${route}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function dispatchNativeRemoteKey(key: NativeRemoteKey) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("ayin:native-remote", { detail: { key } }));
}
