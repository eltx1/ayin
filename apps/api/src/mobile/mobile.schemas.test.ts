import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  defaultMobileRuntimeConfig,
  mobileDeviceSchema,
  mobilePushInputSchema,
  mobileRuntimeConfigSchema,
} from "./mobile.schemas.js";

describe("native mobile runtime boundary", () => {
  it("matches the cross-platform contract with SDKs disabled by default", () => {
    expect(mobileRuntimeConfigSchema.parse(defaultMobileRuntimeConfig)).toEqual(
      JSON.parse(
        readFileSync(
          new URL("../../../../docs/MOBILE_RUNTIME_CONTRACT.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    expect(defaultMobileRuntimeConfig.ads.enabled).toBe(false);
    expect(defaultMobileRuntimeConfig.analytics.enabled).toBe(false);
    expect(defaultMobileRuntimeConfig.notifications.enabled).toBe(false);
  });
  it("accepts mixed GAM/AdMob inventory and rejects malformed or oversized paths", () => {
    for (const unit of [
      "/21775744923/example/adaptive-banner",
      "ca-app-pub-3940256099942544/6300978111",
      "/1/" + "a".repeat(253),
    ]) {
      const config = structuredClone(defaultMobileRuntimeConfig);
      config.ads.platforms.android.bannerUnitId = unit;
      expect(mobileRuntimeConfigSchema.safeParse(config).success).toBe(true);
    }
    for (const unit of [
      "/1/" + "a".repeat(254),
      "/123456789012345678901/a",
      "/1/a\n",
      "ca-app-pub-3940256099942544/6300978111\n",
      "/1//a",
      "/1/a?x=1",
      "https://example.com/ad",
      "/network/unit",
    ]) {
      const config = structuredClone(defaultMobileRuntimeConfig);
      config.ads.platforms.ios.interstitialUnitId = unit;
      expect(mobileRuntimeConfigSchema.safeParse(config).success).toBe(false);
    }
  });
  it("rejects unknown/child audiences before any ads can be enabled", () => {
    for (const audience of ["unknown", "children"] as const)
      expect(
        mobileRuntimeConfigSchema.safeParse({
          ...defaultMobileRuntimeConfig,
          ads: { ...defaultMobileRuntimeConfig.ads, enabled: true, audience },
        }).success,
      ).toBe(false);
  });
  it("rejects server-origin changes, unsigned bundles, unknown fields and incompatible bridge", () => {
    for (const web of [
      { ...defaultMobileRuntimeConfig.web, origin: "https://evil.invalid" },
      { ...defaultMobileRuntimeConfig.web, bundleUpdatesEnabled: true },
      { ...defaultMobileRuntimeConfig.web, minimumBridgeVersion: 2 },
    ])
      expect(
        mobileRuntimeConfigSchema.safeParse({ ...defaultMobileRuntimeConfig, web }).success,
      ).toBe(false);
    expect(
      mobileRuntimeConfigSchema.safeParse({ ...defaultMobileRuntimeConfig, executeNative: "eval" })
        .success,
    ).toBe(false);
  });
  it("bounds retries and requires platform inventory for production", () => {
    expect(
      mobileRuntimeConfigSchema.safeParse({
        ...defaultMobileRuntimeConfig,
        ads: { ...defaultMobileRuntimeConfig.ads, retryCount: 999 },
      }).success,
    ).toBe(false);
    expect(
      mobileRuntimeConfigSchema.safeParse({
        ...defaultMobileRuntimeConfig,
        ads: {
          ...defaultMobileRuntimeConfig.ads,
          enabled: true,
          audience: "general",
          testMode: false,
          banner: { enabled: true },
          platforms: {
            ...defaultMobileRuntimeConfig.ads.platforms,
            android: { ...defaultMobileRuntimeConfig.ads.platforms.android, enabled: true },
          },
        },
      }).success,
    ).toBe(false);
  });
  it("rejects non-canonical and backwards minimum versions", () => {
    for (const value of ["2.0", "2.0.0-beta", "99999.0.0"])
      expect(
        mobileRuntimeConfigSchema.safeParse({
          ...defaultMobileRuntimeConfig,
          minimumAppVersion: { android: value, ios: "1.0.0" },
        }).success,
      ).toBe(false);
    expect(
      mobileRuntimeConfigSchema.safeParse({
        ...defaultMobileRuntimeConfig,
        minimumAppVersion: { android: "2.0.0", ios: "1.0.0" },
      }).success,
    ).toBe(false);
  });
  it("requires explicit preferences and excludes tokens from identity", () => {
    const result = mobileDeviceSchema.parse({
      installationId: "ed76e28e-32a2-4709-a753-ea0bff918ec8",
      token: "non-production-test-token-12345",
      platform: "android",
      appVersion: "1.0.0",
      preferences: {},
    });
    expect(Object.values(result.preferences).every((v) => v === false)).toBe(true);
    expect(mobileDeviceSchema.safeParse({ ...result, accountId: "other-account" }).success).toBe(
      false,
    );
    expect(mobileDeviceSchema.safeParse({ ...result, token: "x" }).success).toBe(false);
  });
  it("does not accept a broadcast or arbitrary URL destination", () => {
    const request = {
      accountId: "ed76e28e-32a2-4709-a753-ea0bff918ec8",
      dedupeKey: "8824844a-4612-4bcf-8053-f853207eb162",
      type: "system",
      title: "Test",
      body: "Test message",
      destination: { kind: "notifications" },
      reason: "Internal release test",
    };
    expect(mobilePushInputSchema.safeParse(request).success).toBe(true);
    expect(
      mobilePushInputSchema.safeParse({ ...request, accountId: undefined, broadcast: true })
        .success,
    ).toBe(false);
    expect(
      mobilePushInputSchema.safeParse({
        ...request,
        destination: { kind: "url", url: "https://evil.invalid" },
      }).success,
    ).toBe(false);
  });
});
