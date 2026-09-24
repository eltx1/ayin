import { describe, expect, it } from "vitest";

import {
  browserKeyForNativeRemote,
  canRequestTvExit,
  isTizenEmbeddedUrl,
  isTizenHomePath,
  normalizeTvRemoteEvent,
} from "./tv-platform-runtime";

describe("TV platform runtime", () => {
  it("normalizes current Samsung remote key codes without confusing Pause and Stop", () => {
    expect(normalizeTvRemoteEvent({ key: "", keyCode: 10009 })).toBe("BACK");
    expect(normalizeTvRemoteEvent({ key: "", keyCode: 10252 })).toBe("PLAY_PAUSE");
    expect(normalizeTvRemoteEvent({ key: "", keyCode: 19 })).toBe("PAUSE");
    expect(normalizeTvRemoteEvent({ key: "", keyCode: 413 })).toBeNull();
  });

  it("normalizes webOS and browser keyboard names", () => {
    expect(normalizeTvRemoteEvent({ key: "ArrowLeft", keyCode: 0 })).toBe("LEFT");
    expect(normalizeTvRemoteEvent({ key: "Enter", keyCode: 0 })).toBe("SELECT");
    expect(normalizeTvRemoteEvent({ key: "Unknown", keyCode: 0 })).toBeNull();
  });

  it("maps packaged Tizen remote messages into the shared browser input path", () => {
    expect(browserKeyForNativeRemote("UP")).toBe("ArrowUp");
    expect(browserKeyForNativeRemote("SELECT")).toBe("Enter");
    expect(browserKeyForNativeRemote("PLAY_PAUSE")).toBe("MediaPlayPause");
    expect(browserKeyForNativeRemote("MENU")).toBeNull();
  });

  it("detects only the dedicated embedded Tizen marker", () => {
    expect(isTizenEmbeddedUrl("https://ayin.stream/?ayin_tizen_embed=1")).toBe(true);
    expect(isTizenEmbeddedUrl("https://ayin.stream/watch/a?ayin_tizen_embed=0")).toBe(false);
    expect(isTizenEmbeddedUrl("not-a-url")).toBe(false);
  });

  it("treats only root and locale-root routes as Tizen home pages", () => {
    expect(isTizenHomePath("/")).toBe(true);
    expect(isTizenHomePath("/ar")).toBe(true);
    expect(isTizenHomePath("/en-US")).toBe(true);
    expect(isTizenHomePath("/watch/example")).toBe(false);
    expect(isTizenHomePath("/ar/watch/example")).toBe(false);
  });

  it("does not invent the packaged Application API inside remote content", () => {
    expect(canRequestTvExit({} as Window)).toBe(false);
    const packaged = {
      tizen: {
        application: {
          getCurrentApplication: () => ({ exit: () => undefined }),
        },
      },
    } as unknown as Window;
    expect(canRequestTvExit(packaged)).toBe(true);
  });
});
