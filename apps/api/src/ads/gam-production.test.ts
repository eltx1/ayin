import { describe, expect, it } from "vitest";

import { loadGamProductionConfig } from "./gam-production.config.js";
import {
  buildGamVideoTagUrl,
  classifyGamRuntimeEvents,
  configuredGoogleSellerRows,
  isConfiguredDisplayAdUnitPath,
} from "./gam-production.service.js";

const examplePublisherId = `pub-${"0".repeat(16)}`;
const completeExample = {
  GAM_NETWORK_CODE: "1234",
  GAM_PUBLISHER_ID: examplePublisherId,
  GAM_VIDEO_AD_UNIT_PATH: "/1234/example/video",
  GAM_DISPLAY_AD_UNIT_PREFIX: "/1234/example",
  GAM_ADS_TXT_RELATIONSHIP: "DIRECT" as const,
};

describe("Google Ad Manager production configuration", () => {
  it("defaults to test mode, an open adapter kill switch state, and no invented identifiers", () => {
    const config = loadGamProductionConfig({});
    expect(config.complete).toBe(false);
    expect(config.productionEnabled).toBe(false);
    expect(config.testMode).toBe(true);
    expect(config.killSwitch).toBe(false);
    expect(config.networkCode).toBeNull();
    expect(config.publisherId).toBeNull();
  });

  it("treats blank production identifiers as unconfigured while production is disabled", () => {
    const config = loadGamProductionConfig({
      GAM_NETWORK_CODE: "",
      GAM_PUBLISHER_ID: "",
      GAM_VIDEO_AD_UNIT_PATH: "",
      GAM_DISPLAY_AD_UNIT_PREFIX: "",
      GAM_ADS_TXT_RELATIONSHIP: "",
      GAM_TEST_MODE: "1",
      GAM_PRODUCTION_ENABLED: "0",
    });

    expect(config.complete).toBe(false);
    expect(config.productionEnabled).toBe(false);
    expect(config.testMode).toBe(true);
    expect(config.networkCode).toBeNull();
    expect(config.publisherId).toBeNull();
    expect(config.videoAdUnitPath).toBeNull();
    expect(config.displayAdUnitPrefix).toBeNull();
    expect(config.adsTxtRelationship).toBeNull();
  });

  it("accepts a complete example-shaped configuration in test mode", () => {
    const config = loadGamProductionConfig(completeExample);
    expect(config.complete).toBe(true);
    expect(config.testMode).toBe(true);
    expect(config.productionEnabled).toBe(false);
  });

  it("supports an explicit independent adapter kill switch", () => {
    const config = loadGamProductionConfig({ ...completeExample, GAM_KILL_SWITCH: "1" });
    expect(config.killSwitch).toBe(true);
  });

  it("refuses partial account configuration", () => {
    expect(() => loadGamProductionConfig({ GAM_NETWORK_CODE: "1234" })).toThrow(
      /must be configured together/,
    );
  });

  it("refuses malformed Google publisher IDs", () => {
    expect(() =>
      loadGamProductionConfig({ GAM_NETWORK_CODE: "1234", GAM_PUBLISHER_ID: "invalid" }),
    ).toThrow();
  });

  it("requires test mode off before production delivery", () => {
    expect(() =>
      loadGamProductionConfig({
        ...completeExample,
        GAM_PRODUCTION_ENABLED: "1",
        GAM_TEST_MODE: "1",
      }),
    ).toThrow(/Disable GAM_TEST_MODE/);
  });

  it("permits production only when complete configuration is explicit", () => {
    const config = loadGamProductionConfig({
      ...completeExample,
      GAM_PRODUCTION_ENABLED: "1",
      GAM_TEST_MODE: "0",
    });
    expect(config.productionEnabled).toBe(true);
    expect(config.testMode).toBe(false);
    expect(config.complete).toBe(true);
  });

  it("builds a bounded official-style VAST request without session or user identifiers", () => {
    const config = loadGamProductionConfig(completeExample);
    const tag = buildGamVideoTagUrl(config, "https://ayin.stream/watch/example", "PRE_ROLL");
    expect(tag).not.toBeNull();
    const url = new URL(tag as string);
    expect(url.origin + url.pathname).toBe("https://securepubads.g.doubleclick.net/gampad/ads");
    expect(url.searchParams.get("iu")).toBe("/1234/example/video");
    expect(url.searchParams.get("sz")).toBe("640x360");
    expect(url.searchParams.get("env")).toBe("vp");
    expect(url.searchParams.get("gdfp_req")).toBe("1");
    expect(url.searchParams.get("output")).toBe("xml_vast4");
    expect(url.searchParams.get("vpos")).toBe("preroll");
    expect(url.searchParams.get("description_url")).toBe("https://ayin.stream/watch/example");
    expect(url.searchParams.get("adtest")).toBe("on");
    expect(url.searchParams.has("correlator")).toBe(false);
    expect(url.searchParams.has("cust_params")).toBe(false);
  });

  it("accepts page slots only under the explicitly configured display prefix", () => {
    const config = loadGamProductionConfig(completeExample);
    expect(isConfiguredDisplayAdUnitPath(config, "/1234/example/home/top")).toBe(true);
    expect(isConfiguredDisplayAdUnitPath(config, "/9999/other/top")).toBe(false);
  });

  it("generates seller rows only from configured seller data and omits fabricated certification IDs", () => {
    const config = loadGamProductionConfig(completeExample);
    expect(configuredGoogleSellerRows(config)).toEqual([
      `google.com, ${examplePublisherId}, DIRECT`,
    ]);
    expect(configuredGoogleSellerRows(loadGamProductionConfig({}))).toEqual([]);
  });

  it("separates detectable IMA no-fill, technical errors, and ambiguous GPT empty responses", () => {
    const now = new Date("2026-09-17T00:00:00.000Z");
    const runtime = classifyGamRuntimeEvents([
      { eventType: "REQUEST", metadata: { provider: "GOOGLE_IMA" }, occurredAt: now },
      {
        eventType: "ERROR",
        metadata: { provider: "GOOGLE_IMA", errorCode: "IMA_NO_FILL_1009" },
        occurredAt: now,
      },
      { eventType: "REQUEST", metadata: { provider: "GOOGLE_GPT" }, occurredAt: now },
      {
        eventType: "ERROR",
        metadata: { provider: "GOOGLE_GPT", errorCode: "GPT_EMPTY_OR_NETWORK_FAILURE" },
        occurredAt: now,
      },
      {
        eventType: "ERROR",
        metadata: { provider: "GOOGLE_GPT", errorCode: "GPT_SCRIPT_LOAD_FAILED" },
        occurredAt: now,
      },
    ]);
    expect(runtime.ima.noFill).toBe(1);
    expect(runtime.ima.technicalErrors).toBe(0);
    expect(runtime.ima.health).toBe("HEALTHY");
    expect(runtime.gpt.ambiguousEmpty).toBe(1);
    expect(runtime.gpt.technicalErrors).toBe(1);
    expect(runtime.gpt.health).toBe("DEGRADED");
  });
});
