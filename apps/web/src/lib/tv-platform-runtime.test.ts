import { describe, expect, it, vi } from "vitest";

import {
  AYIN_TIZEN_MIN_SUPPORTED_VERSION,
  detectTvWebPlatform,
  isSupportedSamsungTizenRuntime,
  normalizeTvRemoteEvent,
  parseSamsungTizenVersion,
  registerTizenMediaKeys,
  TIZEN_MEDIA_KEYS,
} from "./tv-platform-runtime";

describe("TV platform runtime", () => {
  it("normalizes Samsung remote key codes without treating MediaStop as Pause", () => {
    expect(normalizeTvRemoteEvent({ key: "", keyCode: 10009 })).toBe("BACK");
    expect(normalizeTvRemoteEvent({ key: "", keyCode: 10252 })).toBe("PLAY_PAUSE");
    expect(normalizeTvRemoteEvent({ key: "", keyCode: 19 })).toBe("PAUSE");
    expect(normalizeTvRemoteEvent({ key: "", keyCode: 413 })).toBeNull();
    expect(normalizeTvRemoteEvent({ key: "", keyCode: 10182 })).toBeNull();
  });

  it("normalizes webOS and browser keyboard names", () => {
    expect(normalizeTvRemoteEvent({ key: "ArrowLeft", keyCode: 0 })).toBe("LEFT");
    expect(normalizeTvRemoteEvent({ key: "Enter", keyCode: 0 })).toBe("SELECT");
    expect(normalizeTvRemoteEvent({ key: "Unknown", keyCode: 0 })).toBeNull();
  });

  it("detects hosted Samsung Tizen from the official user-agent shape without Tizen APIs", () => {
    const target = {
      navigator: {
        userAgent:
          "Mozilla/5.0 (SMART-TV; LINUX; Tizen 10.0) AppleWebKit/537.36 (KHTML, like Gecko) 130.0.6723.116/10.0 TV Safari/537.36",
      },
      tizen: undefined,
      webOS: undefined,
    } as unknown as Window;

    expect(detectTvWebPlatform(target)).toBe("tizen");
  });

  it("sets the current AYIN Samsung baseline to Tizen 9.0 and newer", () => {
    expect(AYIN_TIZEN_MIN_SUPPORTED_VERSION).toBe(9);
    expect(parseSamsungTizenVersion("SMART-TV; LINUX; Tizen 10.0")).toBe(10);
    expect(parseSamsungTizenVersion("SMART-TV; LINUX; Tizen 9.0")).toBe(9);
    expect(parseSamsungTizenVersion("SMART-TV; LINUX; Tizen 8.0")).toBe(8);
    expect(parseSamsungTizenVersion("Chrome/130")).toBeNull();
    expect(isSupportedSamsungTizenRuntime("SMART-TV; LINUX; Tizen 10.0")).toBe(true);
    expect(isSupportedSamsungTizenRuntime("SMART-TV; LINUX; Tizen 9.0")).toBe(true);
    expect(isSupportedSamsungTizenRuntime("SMART-TV; LINUX; Tizen 8.0")).toBe(false);
  });

  it("batch-registers Samsung media keys when the packaged Tizen API is actually available", () => {
    const registerKeyBatch = vi.fn();
    const target = {
      tizen: { tvinputdevice: { registerKeyBatch } },
    } as unknown as Window;

    expect(registerTizenMediaKeys(target)).toBe("registered");
    expect(registerKeyBatch).toHaveBeenCalledWith(TIZEN_MEDIA_KEYS);
  });

  it("treats hosted Tizen media-key registration as unavailable instead of failing the app", () => {
    expect(registerTizenMediaKeys({ tizen: undefined } as unknown as Window)).toBe("unavailable");

    const target = {
      tizen: {
        tvinputdevice: {
          registerKeyBatch: () => {
            throw new Error("not supported");
          },
        },
      },
    } as unknown as Window;
    expect(registerTizenMediaKeys(target)).toBe("failed");
  });
});
