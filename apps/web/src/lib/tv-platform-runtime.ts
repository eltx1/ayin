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

type SamsungAppCommon = {
  AppCommonScreenSaverState?: {
    SCREEN_SAVER_ON?: number;
    SCREEN_SAVER_OFF?: number;
  };
  setScreenSaver?: (
    state: number,
    success?: (result?: unknown) => void,
    error?: (error: unknown) => void,
  ) => void;
};

declare global {
  interface Window {
    tizen?: {
      tvinputdevice?: TizenInputDevice;
      application?: TizenApplication;
    };
    webOS?: unknown;
    webapis?: {
      appcommon?: SamsungAppCommon;
    };
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
  try {
    const declared = new URL(target.location.href).searchParams.get("platform");
    if (declared === "tizen" || declared === "webos") return declared;
  } catch {
    // A malformed location must not prevent the shared TV runtime from starting.
  }
  return null;
}

export type TvBackAction = "EXIT_FULLSCREEN" | "HISTORY_BACK" | "REQUEST_EXIT" | "NONE";

export function tvBackAction(input: {
  platform: NativeShellPlatform | null;
  fullscreen: boolean;
  historyLength: number;
}): TvBackAction {
  if (input.fullscreen) return "EXIT_FULLSCREEN";
  if (input.platform !== "tizen") return "NONE";
  return input.historyLength > 1 ? "HISTORY_BACK" : "REQUEST_EXIT";
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
  registerTizenMediaKeys(target);
  const removeScreenSaverGuard = installTizenScreenSaverGuard(target, platform);
  if (platform) target.document.documentElement.dataset.tvPlatform = platform;

  const onKeyDown = (event: KeyboardEvent) => {
    const key = normalizeTvRemoteEvent(event);
    if (!key) return;
    const remoteEvent = new CustomEvent<NativeRemoteEventDetail>("ayin:native-remote", {
      detail: { key, platform },
      cancelable: true,
    });
    target.dispatchEvent(remoteEvent);

    if (key !== "BACK" || remoteEvent.defaultPrevented) return;
    const action = tvBackAction({
      platform,
      fullscreen: Boolean(target.document.fullscreenElement),
      historyLength: target.history.length,
    });
    if (action === "HISTORY_BACK") {
      event.preventDefault();
      target.history.back();
      return;
    }
    if (action === "REQUEST_EXIT") {
      const exitEvent = new CustomEvent("ayin:tv-exit-request", {
        detail: { platform: "tizen" },
        cancelable: true,
      });
      target.dispatchEvent(exitEvent);
      if (exitEvent.defaultPrevented) event.preventDefault();
    }
  };

  const onVisibility = () => {
    if (nativeShell) return;
    target.dispatchEvent(
      new CustomEvent<NativeLifecycleEventDetail>("ayin:native-lifecycle", {
        detail: { state: target.document.hidden ? "pause" : "resume", platform },
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
  target.document.addEventListener("webOSLaunch", onWebOsLaunch as EventListener);
  target.document.addEventListener("webOSRelaunch", onWebOsLaunch as EventListener);

  return () => {
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("ayin:native-remote", onNativeRemote);
    target.removeEventListener("ayin:native-lifecycle", onNativeLifecycle);
    target.removeEventListener("ayin:native-network", onNativeNetwork);
    target.document.removeEventListener("visibilitychange", onVisibility);
    target.document.removeEventListener("webOSLaunch", onWebOsLaunch as EventListener);
    target.document.removeEventListener("webOSRelaunch", onWebOsLaunch as EventListener);
    removeScreenSaverGuard();
    if (platform && target.document.documentElement.dataset.tvPlatform === platform) {
      delete target.document.documentElement.dataset.tvPlatform;
    }
    pausedForLifecycle.clear();
  };
}

export function canRequestTvExit(target: Window = window): boolean {
  return Boolean(target.tizen?.application?.getCurrentApplication);
}

export function requestTvExit(target: Window = window): boolean {
  if (canRequestTvExit(target)) {
    try {
      target.tizen.application.getCurrentApplication()?.exit?.();
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function installTizenScreenSaverGuard(
  target: Window,
  platform: NativeShellPlatform | null,
): () => void {
  if (platform !== "tizen") return () => undefined;
  const appcommon = target.webapis?.appcommon;
  const states = appcommon?.AppCommonScreenSaverState;
  if (!appcommon?.setScreenSaver || !states) return () => undefined;

  const setEnabled = (enabled: boolean) => {
    const state = enabled ? states.SCREEN_SAVER_ON : states.SCREEN_SAVER_OFF;
    if (typeof state !== "number") return;
    try {
      appcommon.setScreenSaver?.(state, () => undefined, () => undefined);
    } catch {
      // Product API support differs by Samsung model; media playback must continue.
    }
  };

  const anyPlayingMedia = () =>
    [...target.document.querySelectorAll<HTMLMediaElement>("video,audio")].some(
      (media) => !media.paused && !media.ended,
    );

  const onPlay = () => setEnabled(false);
  const onStopped = () => {
    if (!anyPlayingMedia()) setEnabled(true);
  };

  target.document.addEventListener("play", onPlay, true);
  target.document.addEventListener("playing", onPlay, true);
  target.document.addEventListener("pause", onStopped, true);
  target.document.addEventListener("ended", onStopped, true);
  target.document.addEventListener("emptied", onStopped, true);

  return () => {
    target.document.removeEventListener("play", onPlay, true);
    target.document.removeEventListener("playing", onPlay, true);
    target.document.removeEventListener("pause", onStopped, true);
    target.document.removeEventListener("ended", onStopped, true);
    target.document.removeEventListener("emptied", onStopped, true);
    setEnabled(true);
  };
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
