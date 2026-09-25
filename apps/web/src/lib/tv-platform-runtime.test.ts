import { describe, expect, it, vi } from "vitest";

import {
  AYIN_TIZEN_MIN_SUPPORTED_VERSION,
  detectTvWebPlatform,
  isSupportedSamsungTizenRuntime,
  isTvHomePathname,
  normalizeTvRemoteEvent,
  parseSamsungTizenVersion,
  registerTizenMediaKeys,
  requestTvExit,
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

  it("detects the canonical hosted Tizen query when platform APIs are intentionally absent", () => {
    const target = {
      location: { href: "https://ayin.stream/?platform=tizen&hosted=1" },
      navigator: { userAgent: "Mozilla/5.0" },
      tizen: undefined,
      webOS: undefined,
    } as unknown as Window;

    expect(detectTvWebPlatform(target)).toBe("tizen");
  });

  it("rejects spoofed hosted-platform query strings on foreign origins", () => {
    const target = {
      location: { href: "https://example.com/?platform=tizen" },
      navigator: { userAgent: "Mozilla/5.0" },
      tizen: undefined,
      webOS: undefined,
    } as unknown as Window;

    expect(detectTvWebPlatform(target)).toBeNull();
  });

  it("does not create a packaged Tizen session from platform=tizen without hosted=1", () => {
    const target = {
      location: { href: "https://ayin.stream/?platform=tizen" },
      navigator: { userAgent: "Mozilla/5.0" },
      tizen: undefined,
      webOS: undefined,
    } as unknown as Window;

    expect(detectTvWebPlatform(target)).toBeNull();
  });

  it("treats localized AYIN home routes as home for Samsung Back/Exit policy", () => {
    expect(isTvHomePathname("/")).toBe(true);
    expect(isTvHomePathname("/ar")).toBe(true);
    expect(isTvHomePathname("/ar/")).toBe(true);
    expect(isTvHomePathname("/en")).toBe(true);
    expect(isTvHomePathname("/ar/watch/example")).toBe(false);
    expect(isTvHomePathname("/watch/example")).toBe(false);
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

  it("batch-registers only media keys reported by the Samsung TV", () => {
    const registerKeyBatch = vi.fn();
    const target = {
      tizen: {
        tvinputdevice: {
          getSupportedKeys: () => [
            { name: "MediaPlayPause" },
            { name: "MediaPlay" },
            { name: "ColorF0Red" },
          ],
          registerKeyBatch,
        },
      },
    } as unknown as Window;

    expect(registerTizenMediaKeys(target)).toBe("registered");
    expect(registerKeyBatch).toHaveBeenCalledWith(["MediaPlayPause", "MediaPlay"]);
  });

  it("keeps the packaged Tizen session across SPA routes before confirmed exit", () => {
    const storage = new Map<string, string>();
    const back = vi.fn();
    const target = {
      history: { back, length: 4 },
      location: { href: "https://ayin.stream/watch/example" },
      navigator: { userAgent: "SMART-TV; LINUX; Tizen 10.0" },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      tizen: undefined,
      webOS: undefined,
    } as unknown as Window;
    storage.set("ayin:tizen-hosted", "1");

    expect(requestTvExit(target)).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    expect(storage.get("ayin:tizen-exit-pending")).toBe("1");
  });

  it("does not treat a Samsung browser visit as a packaged Tizen exit session", () => {
    const back = vi.fn();
    const target = {
      history: { back, length: 3 },
      location: { href: "https://ayin.stream/" },
      navigator: { userAgent: "SMART-TV; LINUX; Tizen 10.0" },
      sessionStorage: {
        getItem: () => null,
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      tizen: undefined,
      webOS: undefined,
    } as unknown as Window;

    expect(requestTvExit(target)).toBe(false);
    expect(back).not.toHaveBeenCalled();
  });

  it("returns to the packaged bootstrap to complete a hosted Tizen exit", () => {
    const back = vi.fn();
    const storage = new Map<string, string>();
    const target = {
      history: { back, length: 2 },
      location: { href: "https://ayin.stream/?platform=tizen&hosted=1" },
      navigator: { userAgent: "Mozilla/5.0" },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      tizen: undefined,
      webOS: undefined,
    } as unknown as Window;

    expect(requestTvExit(target)).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("uses the packaged Tizen Application API directly when it is available", () => {
    const exit = vi.fn();
    const target = {
      tizen: {
        application: {
          getCurrentApplication: () => ({ exit }),
        },
      },
    } as unknown as Window;

    expect(requestTvExit(target)).toBe(true);
    expect(exit).toHaveBeenCalledTimes(1);
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
