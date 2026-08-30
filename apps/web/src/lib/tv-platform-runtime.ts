import type { NativeRemoteKey, NativeShellPlatform } from "./native-shell-bridge";

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

const TIZEN_MEDIA_KEYS = [
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
  413: "PAUSE",
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

export function detectTvWebPlatform(target: Window = window): NativeShellPlatform | null {
  if (target.tizen?.tvinputdevice) return "tizen";
  if (target.webOS) return "webos";
  return null;
}

export function normalizeTvRemoteEvent(
  event: Pick<KeyboardEvent, "key" | "keyCode">,
): NativeRemoteKey | null {
  return KEY_BY_NAME[event.key] ?? KEY_BY_CODE[event.keyCode] ?? null;
}

export function installTvPlatformRuntime(target: Window = window): () => void {
  const platform = detectTvWebPlatform(target);
  registerTizenMediaKeys(target);

  const onKeyDown = (event: KeyboardEvent) => {
    const key = normalizeTvRemoteEvent(event);
    if (!key) return;
    target.dispatchEvent(new CustomEvent("ayin:native-remote", { detail: { key, platform } }));
  };
  const onVisibility = () => {
    target.dispatchEvent(
      new CustomEvent("ayin:native-lifecycle", {
        detail: { state: target.document.hidden ? "pause" : "resume", platform },
      }),
    );
  };
  const onWebOsLaunch = () => {
    target.dispatchEvent(
      new CustomEvent("ayin:native-lifecycle", {
        detail: { state: "relaunch", platform: "webos" },
      }),
    );
  };

  target.addEventListener("keydown", onKeyDown);
  target.document.addEventListener("visibilitychange", onVisibility);
  target.document.addEventListener("webOSLaunch", onWebOsLaunch as EventListener);
  target.document.addEventListener("webOSRelaunch", onWebOsLaunch as EventListener);

  return () => {
    target.removeEventListener("keydown", onKeyDown);
    target.document.removeEventListener("visibilitychange", onVisibility);
    target.document.removeEventListener("webOSLaunch", onWebOsLaunch as EventListener);
    target.document.removeEventListener("webOSRelaunch", onWebOsLaunch as EventListener);
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

function registerTizenMediaKeys(target: Window) {
  const input = target.tizen?.tvinputdevice;
  if (!input) return;
  try {
    if (input.registerKeyBatch) {
      input.registerKeyBatch(TIZEN_MEDIA_KEYS);
      return;
    }
    for (const key of TIZEN_MEDIA_KEYS) input.registerKey?.(key);
  } catch {
    // Unsupported remote keys must not prevent the TV app from starting.
  }
}
