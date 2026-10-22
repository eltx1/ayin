import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isMobileAdUnitId,
  mobileAdUnitProvider,
  mobileConfigForCapabilities,
  parseMobileConfig,
} from "./mobile-config";
const fixture = () =>
  parseMobileConfig(JSON.parse(readFileSync("../../docs/MOBILE_RUNTIME_CONTRACT.json", "utf8")));
describe("native inventory validation and legacy projection", () => {
  it.each([
    "",
    "ca-app-pub-3940256099942544/6300978111",
    "/21775744923/example/adaptive-banner",
    "/1/a.b_c-d",
    "/1/" + "a".repeat(253),
  ])("accepts bounded inventory %s", (unit) => {
    expect(isMobileAdUnitId(unit)).toBe(true);
    const config = fixture();
    config.ads.platforms.android.bannerUnitId = unit;
    expect(parseMobileConfig(config).ads.platforms.android.bannerUnitId).toBe(unit);
  });
  it.each([
    "/1/" + "a".repeat(254),
    "/123456789012345678901/a",
    "/1/",
    "/a/banner",
    "/1/a?b=1",
    "/1//a",
    "/1/a\n",
    "ca-app-pub-3940256099942544/6300978111\n",
    "https://example.com/ad",
    123,
    null,
  ])("rejects invalid inventory %s", (unit) => {
    expect(isMobileAdUnitId(unit)).toBe(false);
    const config = fixture();
    Object.assign(config.ads.platforms.android, { bannerUnitId: unit });
    expect(() => parseMobileConfig(config)).toThrow("INVALID_MOBILE_CONFIG");
  });
  it("detects providers without treating malformed IDs as inventory", () => {
    expect(mobileAdUnitProvider("/1/banner")).toBe("gam");
    expect(mobileAdUnitProvider("ca-app-pub-3940256099942544/6300978111")).toBe("admob");
    expect(mobileAdUnitProvider("/invalid")).toBeNull();
  });
  it("strips both platforms and disables only ads for old shells, without mutating server config", () => {
    const config = fixture();
    config.ads.enabled = true;
    config.analytics.enabled = true;
    config.notifications.enabled = true;
    config.ads.platforms.android.bannerUnitId = "/1/banner";
    config.ads.platforms.ios.interstitialUnitId = "/2/interstitial";
    const projected = mobileConfigForCapabilities(config, []);
    expect(projected.ads.enabled).toBe(false);
    expect(projected.ads.platforms.android.bannerUnitId).toBe("");
    expect(projected.ads.platforms.ios.interstitialUnitId).toBe("");
    expect(projected.analytics).toEqual(config.analytics);
    expect(projected.notifications).toEqual(config.notifications);
    expect(config.ads.enabled).toBe(true);
    expect(config.ads.platforms.android.bannerUnitId).toBe("/1/banner");
    expect(mobileConfigForCapabilities(config, ["ads.gam"])).toEqual(config);
  });
});
