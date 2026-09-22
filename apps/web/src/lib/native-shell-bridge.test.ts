import { describe, expect, it } from "vitest";

import {
  nativeRemotePlayerCommand,
  normalizeAyinDeepLink,
  normalizePlatform,
} from "./native-shell-bridge";

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

  it("accepts only the canonical HTTPS origin for app links", () => {
    expect(normalizeAyinDeepLink("https://ayin.stream/clips#next")).toBe("/clips#next");
    expect(normalizeAyinDeepLink("https://ayin.stream:443/live/example")).toBe("/live/example");
    expect(normalizeAyinDeepLink("https://ayin.stream:444/clips")).toBeNull();
    expect(normalizeAyinDeepLink("http://ayin.stream/clips")).toBeNull();
    expect(normalizeAyinDeepLink("https://example.com/clips")).toBeNull();
  });

  it("maps hardware media keys onto shared player commands", () => {
    expect(nativeRemotePlayerCommand("PLAY_PAUSE")).toBe("TOGGLE_PLAY");
    expect(nativeRemotePlayerCommand("PLAY")).toBe("PLAY");
    expect(nativeRemotePlayerCommand("PAUSE")).toBe("PAUSE");
    expect(nativeRemotePlayerCommand("REWIND")).toBe("SEEK_BACK");
    expect(nativeRemotePlayerCommand("FAST_FORWARD")).toBe("SEEK_FORWARD");
    expect(nativeRemotePlayerCommand("RIGHT")).toBeNull();
    expect(nativeRemotePlayerCommand("BACK")).toBeNull();
  });
});
