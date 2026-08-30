export type AyinPlatformFamily =
  "web" | "ios" | "android" | "android-tv" | "fire-tv" | "tizen" | "webos";
export interface PlatformCapabilities {
  family: AyinPlatformFamily;
  tv: boolean;
  touch: boolean;
  installable: boolean;
  nativeBridge: boolean;
  safeArea: boolean;
}
export interface AyinPlatformBridge {
  capabilities(): PlatformCapabilities;
  openExternal?(url: string): Promise<void> | void;
  exitApp?(): Promise<void> | void;
}
declare global {
  interface Window {
    AYIN_PLATFORM_BRIDGE?: AyinPlatformBridge;
  }
}
export function detectPlatformCapabilities(): PlatformCapabilities {
  if (typeof window !== "undefined" && window.AYIN_PLATFORM_BRIDGE)
    return window.AYIN_PLATFORM_BRIDGE.capabilities();
  const touch = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
  return {
    family: "web",
    tv: false,
    touch,
    installable: true,
    nativeBridge: false,
    safeArea: true,
  };
}
