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

type TizenShellRemoteMessage = {
  source: "ayin-tizen-shell";
  type: "remote";
  key: NativeRemoteKey;
};

type TizenShellLifecycleMessage = {
  source: "ayin-tizen-shell";
  type: "lifecycle";
  state: "pause" | "resume";
};

type TizenShellNetworkMessage = {
  source: "ayin-tizen-shell";
  type: "network";
  online: boolean;
};

type TizenShellMessage =
  | TizenShellRemoteMessage
  | TizenShellLifecycleMessage
  | TizenShellNetworkMessage;

declare global {
  interface Window {
    tizen?: {
      tvinputdevice?: TizenInputDevice;
      application?: TizenApplication;
    };
    webOS?: unknown;
  }
}

export const TIZEN_EMBED_QUERY = "ayin_tizen_embed";
export const TIZEN_EMBED_COOKIE = "ayin_tizen_embed";
const TIZEN_SHELL_SOURCE = "ayin-tizen-shell";
const TIZEN_APP_SOURCE = "ayin-tizen-app";

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

const BROWSER_KEY_BY_REMOTE: Partial<Record<NativeRemoteKey, string>> = {
  UP: "ArrowUp",
  DOWN: "ArrowDown",
  LEFT: "ArrowLeft",
  RIGHT: "ArrowRight",
  SELECT: "Enter",
  BACK: "Escape",
  PLAY_PAUSE: "MediaPlayPause",
  PLAY: "MediaPlay",
  PAUSE: "MediaPause",
  REWIND: "MediaRewind",
  FAST_FORWARD: "MediaFastForward",
};

export function isTizenEmbeddedUrl(value: string): boolean {
  try {
    return new URL(value).searchParams.get(TIZEN_EMBED_QUERY) === "1";
  } catch {
    return false;
  }
}

export function isTizenEmbeddedRuntime(target: Window = window): boolean {
  return target.parent !== target && isTizenEmbeddedUrl(target.location.href);
}

export function browserKeyForNativeRemote(key: NativeRemoteKey): string | null {
  return BROWSER_KEY_BY_REMOTE[key] ?? null;
}

export function isTizenHomePath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return true;
  return segments.length === 1 && /^[a-z]{2}(?:-[A-Z]{2})?$/u.test(segments[0]!);
}

export function detectTvWebPlatform(target: Window = window): NativeShellPlatform | null {
  if (isTizenEmbeddedRuntime(target)) return "tizen";
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
  const nativeShell = detectNativeShell();
  const embeddedTizen = isTizenEmbeddedRuntime(target);
  const platform = nativeShell?.platform ?? detectTvWebPlatform(target);
  const pausedForLifecycle = new Set<HTMLMediaElement>();
  registerTizenMediaKeys(target);

  if (embeddedTizen) {
    persistTizenEmbedCookie(target);
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const key = normalizeTvRemoteEvent(event);
    if (!key) return;

    const remoteEvent = new CustomEvent<NativeRemoteEventDetail>("ayin:native-remote", {
      detail: { key, platform },
      cancelable: true,
    });
    const consumed = !target.dispatchEvent(remoteEvent);

    if (embeddedTizen && key === "BACK") {
      event.preventDefault();
      if (!consumed) handleEmbeddedTizenBack(target);
    }
  };

  const onVisibility = () => {
    if (nativeShell || embeddedTizen) return;
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

  const onTizenShellMessage = (event: MessageEvent<unknown>) => {
    if (!embeddedTizen || event.source !== target.parent || !isTizenShellMessage(event.data)) {
      return;
    }
    if (event.data.type === "remote") {
      dispatchEmbeddedRemoteKey(target, event.data.key);
      return;
    }
    if (event.data.type === "lifecycle") {
      target.dispatchEvent(
        new CustomEvent<NativeLifecycleEventDetail>("ayin:native-lifecycle", {
          detail: { state: event.data.state, platform: "tizen" },
        }),
      );
      return;
    }
    target.dispatchEvent(
      new CustomEvent<NativeNetworkEventDetail>("ayin:native-network", {
        detail: { online: event.data.online, platform: "tizen" },
      }),
    );
  };

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("ayin:native-remote", onNativeRemote);
  target.addEventListener("ayin:native-lifecycle", onNativeLifecycle);
  target.addEventListener("ayin:native-network", onNativeNetwork);
  target.addEventListener("message", onTizenShellMessage);
  target.document.addEventListener("visibilitychange", onVisibility);
  target.document.addEventListener("webOSLaunch", onWebOsLaunch as EventListener);
  target.document.addEventListener("webOSRelaunch", onWebOsLaunch as EventListener);

  if (embeddedTizen) {
    postToTizenShell(target, { source: TIZEN_APP_SOURCE, type: "ready" });
  }

  return () => {
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("ayin:native-remote", onNativeRemote);
    target.removeEventListener("ayin:native-lifecycle", onNativeLifecycle);
    target.removeEventListener("ayin:native-network", onNativeNetwork);
    target.removeEventListener("message", onTizenShellMessage);
    target.document.removeEventListener("visibilitychange", onVisibility);
    target.document.removeEventListener("webOSLaunch", onWebOsLaunch as EventListener);
    target.document.removeEventListener("webOSRelaunch", onWebOsLaunch as EventListener);
    pausedForLifecycle.clear();
  };
}

export function canRequestTvExit(target: Window = window): boolean {
  return Boolean(target.tizen?.application?.getCurrentApplication);
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

function persistTizenEmbedCookie(target: Window): void {
  try {
    target.document.cookie = `${TIZEN_EMBED_COOKIE}=1; Path=/; Max-Age=86400; SameSite=None; Secure`;
  } catch {
    // A cookie is only a resilience aid for full document navigations; SPA navigation still works.
  }
}

function isTizenShellMessage(value: unknown): value is TizenShellMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TizenShellMessage> & { source?: unknown; type?: unknown };
  if (candidate.source !== TIZEN_SHELL_SOURCE) return false;
  if (candidate.type === "remote") {
    return typeof (candidate as Partial<TizenShellRemoteMessage>).key === "string";
  }
  if (candidate.type === "lifecycle") {
    const state = (candidate as Partial<TizenShellLifecycleMessage>).state;
    return state === "pause" || state === "resume";
  }
  if (candidate.type === "network") {
    return typeof (candidate as Partial<TizenShellNetworkMessage>).online === "boolean";
  }
  return false;
}

function dispatchEmbeddedRemoteKey(target: Window, key: NativeRemoteKey): void {
  const browserKey = browserKeyForNativeRemote(key);
  if (!browserKey) return;
  const active = target.document.activeElement;
  const recipient = active instanceof HTMLElement ? active : target.document.body;
  if (!recipient) return;

  const keyboardEvent = new KeyboardEvent("keydown", {
    key: browserKey,
    bubbles: true,
    cancelable: true,
  });
  const notPrevented = recipient.dispatchEvent(keyboardEvent);
  if (key === "SELECT" && notPrevented && active instanceof HTMLElement) {
    active.click();
  }
}

function handleEmbeddedTizenBack(target: Window): void {
  if (isTizenHomePath(target.location.pathname)) {
    postToTizenShell(target, { source: TIZEN_APP_SOURCE, type: "exit-request" });
    return;
  }

  if (target.history.length > 1) {
    target.history.back();
    return;
  }

  const home = new URL(target.location.href);
  home.pathname = "/";
  home.search = "";
  home.searchParams.set("platform", "tizen");
  home.searchParams.set(TIZEN_EMBED_QUERY, "1");
  target.location.assign(home.toString());
}

function postToTizenShell(target: Window, message: object): void {
  try {
    target.parent.postMessage(message, "*");
  } catch {
    // Tizen shell communication is an enhancement; content must remain usable without it.
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
