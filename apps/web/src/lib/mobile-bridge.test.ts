import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isMobileHost,
  mobileNotificationRoute,
  mobileScreenName,
  requestMobile,
  validMobileAnalytics,
  validMobileRequest,
} from "./mobile-bridge";
import { androidAssetLinks, appleAppLinks } from "./mobile-app-links";
import { parseMobileConfig } from "./mobile-config";
import { readFileSync } from "node:fs";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("mobile bridge trust and schema boundary", () => {
  it("leaves ordinary web and SSR without native behavior", async () => {
    expect(isMobileHost()).toBe(false);
    expect(await requestMobile("privacy.options")).toBeNull();
  });
  it("rejects PII, unknown events, manual SDK revenue and invalid finite values", () => {
    expect(validMobileAnalytics("search", { query_length: 4 })).toBe(true);
    expect(validMobileAnalytics("search", { search_term: "someone@example.com" })).toBe(false);
    expect(
      validMobileAnalytics("video_start", { content_type: "video", title: "private title" }),
    ).toBe(false);
    expect(validMobileAnalytics("ad_impression", {})).toBe(false);
    expect(
      validMobileAnalytics("video_progress", { content_type: "video", position_seconds: Infinity }),
    ).toBe(false);
    expect(validMobileRequest("analytics.user", { id: "test@example.com" })).toBe(false);
    expect(
      validMobileRequest("ads.interstitial", { placement: "watch", naturalTransition: false }),
    ).toBe(false);
    expect(
      validMobileRequest("notifications.token", {
        accountId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBe(true);
  });
  it("requires top frame even when a bridge object is present", () => {
    vi.stubGlobal("window", {
      self: {},
      top: {},
      AyinMobile: { version: 1, capabilities: [], request() {} },
    });
    expect(isMobileHost()).toBe(false);
  });
  it("times out and cleans up a pending native call", async () => {
    vi.useFakeTimers();
    const host = new EventTarget() as EventTarget & {
      self: unknown;
      top: unknown;
      AyinMobile: unknown;
    };
    host.self = host;
    host.top = host;
    host.AyinMobile = { version: 1, capabilities: ["privacy"], request() {} };
    vi.stubGlobal("window", host);
    const promise = requestMobile("privacy.options", {}, 1000);
    const outcome = expect(promise).rejects.toThrow("MOBILE_TIMEOUT");
    await vi.advanceTimersByTimeAsync(1000);
    await outcome;
  });
  it("only routes notification destinations to supported local content", () => {
    expect(mobileNotificationRoute("/watch/video-slug")).toBe("/watch/video-slug");
    expect(mobileNotificationRoute("/c/mr-lord")).toBe("/c/mr-lord");
    for (const route of [
      "https://evil.example",
      "//evil.example",
      "/watch/../account",
      "/watch/%2e%2e",
      "/watch/video?next=evil",
      "/admin",
      "/channel/arbitrary",
    ])
      expect(mobileNotificationRoute(route)).toBeNull();
    expect(mobileScreenName("/ar/watch/private-id")).toBe("watch");
  });
  it("fails closed for unsupported remote update modes and bad ad units", () => {
    const config = JSON.parse(readFileSync("../../docs/MOBILE_RUNTIME_CONTRACT.json", "utf8"));
    expect(parseMobileConfig(config).schemaVersion).toBe(1);
    expect(() => parseMobileConfig({ ...config, schemaVersion: 2 })).toThrow();
    expect(() =>
      parseMobileConfig({ ...config, web: { ...config.web, origin: "https://evil.example" } }),
    ).toThrow();
    expect(() =>
      parseMobileConfig({ ...config, web: { ...config.web, bundleUpdatesEnabled: true } }),
    ).toThrow();
    expect(() =>
      parseMobileConfig({ ...config, ads: { ...config.ads, retryCount: 100 } }),
    ).toThrow();
  });
  it("does not publish fabricated app verification credentials", () => {
    expect(androidAssetLinks(undefined)).toBeNull();
    expect(androidAssetLinks('["not-a-certificate"]')).toBeNull();
    expect(androidAssetLinks(JSON.stringify([Array(32).fill("AB").join(":")]))).toHaveLength(1);
    expect(appleAppLinks(undefined)).toBeNull();
    expect(appleAppLinks("A123456789")).toHaveProperty("applinks");
  });
});
