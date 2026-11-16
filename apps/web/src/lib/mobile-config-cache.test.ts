import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachedMobileConfig,
  maxConfigAgeMs,
  mobileConfigRevision,
  rememberMobileConfig,
} from "./mobile-config-cache";
import { parseMobileConfig } from "./mobile-config";
const fixture = () =>
  parseMobileConfig(JSON.parse(readFileSync("../../docs/MOBILE_RUNTIME_CONTRACT.json", "utf8")));
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("public mobile configuration recovery cache", () => {
  it("uses stable content revisions, independent of JSON object key order", async () => {
    const config = fixture();
    const reordered = Object.fromEntries(Object.entries(config).reverse()) as typeof config;
    expect(await mobileConfigRevision(config)).toMatch(/^[a-f0-9]{64}$/);
    expect(await mobileConfigRevision(reordered)).toBe(await mobileConfigRevision(config));
    expect(
      await mobileConfigRevision({ ...config, analytics: { enabled: !config.analytics.enabled } }),
    ).not.toBe(await mobileConfigRevision(config));
  });
  it("retains navigation defaults without restoring optional tracking, ads or push offline", () => {
    const config = fixture();
    config.ads.enabled = true;
    config.analytics.enabled = true;
    config.notifications.enabled = true;
    config.webViewAds = {
      android: { pageAdsEnabled: true, videoAdsEnabled: true },
      ios: { pageAdsEnabled: true, videoAdsEnabled: true },
    };
    rememberMobileConfig(config, 1000000);
    const recovered = cachedMobileConfig(1000001)!;
    expect(recovered.web).toEqual(config.web);
    expect(recovered.ads.enabled).toBe(false);
    expect(recovered.analytics.enabled).toBe(false);
    expect(recovered.notifications.enabled).toBe(false);
    expect(recovered.webViewAds?.ios.pageAdsEnabled).toBe(false);
    expect(config.ads.enabled).toBe(true);
  });
  it.each(["expired", "future", "malformed", "schema"])("rejects %s cache data", (kind) => {
    rememberMobileConfig(fixture(), 1000000);
    const key = [...storage.keys()][0]!;
    if (kind === "malformed") storage.set(key, "{");
    if (kind === "schema")
      storage.set(key, JSON.stringify({ fetchedAt: 1000000, config: { schemaVersion: 999 } }));
    expect(
      cachedMobileConfig(
        kind === "expired" ? 1000001 + maxConfigAgeMs : kind === "future" ? 0 : 1000000,
      ),
    ).toBeNull();
  });
  it("does not make blocked browser storage fatal", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    });
    expect(() => rememberMobileConfig(fixture(), Date.now())).not.toThrow();
    expect(cachedMobileConfig()).toBeNull();
  });
});
