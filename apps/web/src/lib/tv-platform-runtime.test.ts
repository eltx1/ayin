import { describe, expect, it } from "vitest";

import {
  canRequestTvExit,
  detectTvWebPlatform,
  normalizeTvRemoteEvent,
  tvBackAction,
} from "./tv-platform-runtime";

describe("TV platform runtime", () => {
  it("normalizes Samsung remote key codes", () => {
    expect(normalizeTvRemoteEvent({ key: "", keyCode: 10009 })).toBe("BACK");
    expect(normalizeTvRemoteEvent({ key: "", keyCode: 10252 })).toBe("PLAY_PAUSE");
  });

  it("normalizes webOS and browser keyboard names", () => {
    expect(normalizeTvRemoteEvent({ key: "ArrowLeft", keyCode: 0 })).toBe("LEFT");
    expect(normalizeTvRemoteEvent({ key: "Enter", keyCode: 0 })).toBe("SELECT");
    expect(normalizeTvRemoteEvent({ key: "Unknown", keyCode: 0 })).toBeNull();
  });

  it("detects hosted Tizen from the canonical platform query when APIs are unavailable", () => {
    const target = {
      location: { href: "https://ayin.stream/?platform=tizen" },
    } as unknown as Window;
    expect(detectTvWebPlatform(target)).toBe("tizen");
  });

  it("ignores hosted platform markers on foreign origins", () => {
    const target = {
      location: { href: "https://example.com/?platform=tizen" },
    } as unknown as Window;
    expect(detectTvWebPlatform(target)).toBeNull();
  });

  it("distinguishes packaged Tizen exit API availability from hosted mode", () => {
    const hosted = {} as Window;
    const packaged = {
      tizen: {
        application: {
          getCurrentApplication: () => ({ exit: () => undefined }),
        },
      },
    } as unknown as Window;
    expect(canRequestTvExit(hosted)).toBe(false);
    expect(canRequestTvExit(packaged)).toBe(true);
  });

  it("keeps Samsung Back hierarchical and requests exit only from app root", () => {
    expect(tvBackAction({ platform: "tizen", fullscreen: true, historyLength: 1 })).toBe(
      "EXIT_FULLSCREEN",
    );
    expect(tvBackAction({ platform: "tizen", fullscreen: false, historyLength: 3 })).toBe(
      "HISTORY_BACK",
    );
    expect(tvBackAction({ platform: "tizen", fullscreen: false, historyLength: 1 })).toBe(
      "REQUEST_EXIT",
    );
    expect(tvBackAction({ platform: "webos", fullscreen: false, historyLength: 1 })).toBe("NONE");
  });
});
