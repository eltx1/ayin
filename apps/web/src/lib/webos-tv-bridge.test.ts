import { describe, expect, it, vi } from "vitest";

import {
  AYIN_WEBOS_CURRENT_SUPPORTED_RELEASES,
  AYIN_WEBOS_MIN_CHROMIUM_MAJOR,
  AYIN_WEBOS_MIN_SUPPORTED_RELEASE,
  detectWebOsRuntime,
  isCanonicalHostedWebOs,
  isSupportedLgWebOsRuntime,
  parseLgWebOsChromiumMajor,
  requestWebOsExit,
} from "./webos-tv-bridge";

const WEBOS_26_UA =
  "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.6834.83 Safari/537.36 WebAppManager";
const WEBOS_25_UA =
  "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.270 Safari/537.36 WebAppManager";
const WEBOS_24_UA =
  "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.211 Safari/537.36 WebAppManager";

describe("webOS TV bridge", () => {
  it("declares the current AYIN zero-config baseline as webOS TV 25 and 26", () => {
    expect(AYIN_WEBOS_MIN_SUPPORTED_RELEASE).toBe(25);
    expect(AYIN_WEBOS_MIN_CHROMIUM_MAJOR).toBe(120);
    expect(AYIN_WEBOS_CURRENT_SUPPORTED_RELEASES).toEqual(["25", "26"]);
  });

  it("parses official WebAppManager user agents and rejects webOS TV 24 for Next.js 16", () => {
    expect(parseLgWebOsChromiumMajor(WEBOS_26_UA)).toBe(132);
    expect(parseLgWebOsChromiumMajor(WEBOS_25_UA)).toBe(120);
    expect(parseLgWebOsChromiumMajor(WEBOS_24_UA)).toBe(108);
    expect(isSupportedLgWebOsRuntime(WEBOS_26_UA)).toBe(true);
    expect(isSupportedLgWebOsRuntime(WEBOS_25_UA)).toBe(true);
    expect(isSupportedLgWebOsRuntime(WEBOS_24_UA)).toBe(false);
    expect(parseLgWebOsChromiumMajor("Chrome/132.0")).toBeNull();
  });

  it("recognizes only the canonical hosted webOS marker on the AYIN HTTPS origin", () => {
    const canonical = {
      location: { href: "https://ayin.stream/?platform=webos&hosted=1" },
      navigator: { userAgent: "Mozilla/5.0" },
      webOS: undefined,
    } as unknown as Window;
    const spoofed = {
      location: { href: "https://example.com/?platform=webos&hosted=1" },
      navigator: { userAgent: "Mozilla/5.0" },
      webOS: undefined,
    } as unknown as Window;

    expect(isCanonicalHostedWebOs(canonical)).toBe(true);
    expect(detectWebOsRuntime(canonical)).toBe(true);
    expect(isCanonicalHostedWebOs(spoofed)).toBe(false);
    expect(detectWebOsRuntime(spoofed)).toBe(false);
  });

  it("detects the LG runtime from either the official user agent or injected webOS API", () => {
    expect(
      detectWebOsRuntime({
        location: { href: "https://ayin.stream/" },
        navigator: { userAgent: WEBOS_25_UA },
        webOS: undefined,
      } as unknown as Window),
    ).toBe(true);
    expect(
      detectWebOsRuntime({
        location: { href: "https://ayin.stream/" },
        navigator: { userAgent: "Mozilla/5.0" },
        webOS: {},
      } as unknown as Window),
    ).toBe(true);
  });

  it("exits an LG app with window.close only when a webOS runtime is detected", () => {
    const close = vi.fn();
    const target = {
      close,
      location: { href: "https://ayin.stream/?platform=webos&hosted=1" },
      navigator: { userAgent: "Mozilla/5.0" },
      webOS: undefined,
    } as unknown as Window;

    expect(requestWebOsExit(target)).toBe(true);
    expect(close).toHaveBeenCalledOnce();

    const browserClose = vi.fn();
    expect(
      requestWebOsExit({
        close: browserClose,
        location: { href: "https://ayin.stream/" },
        navigator: { userAgent: "Mozilla/5.0" },
        webOS: undefined,
      } as unknown as Window),
    ).toBe(false);
    expect(browserClose).not.toHaveBeenCalled();
  });
});
