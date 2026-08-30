import { describe, expect, it } from "vitest";

import { normalizeAyinDeepLink, normalizePlatform } from "./native-shell-bridge";

describe("native shell bridge", () => {
  it("accepts only supported shell platform identifiers", () => {
    expect(normalizePlatform(" Android-TV ")).toBe("android-tv");
    expect(normalizePlatform("fire-tv")).toBe("fire-tv");
    expect(normalizePlatform("unknown-tv")).toBeNull();
  });

  it("maps AYIN custom deep links onto internal web routes", () => {
    expect(normalizeAyinDeepLink("ayin://watch/example-video?autoplay=1")).toBe(
      "/watch/example-video?autoplay=1",
    );
  });

  it("accepts only the canonical HTTPS host for app deep links", () => {
    expect(normalizeAyinDeepLink("https://ayin.stream/clips#next")).toBe("/clips#next");
    expect(normalizeAyinDeepLink("https://example.com/clips")).toBeNull();
  });
});
