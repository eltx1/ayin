import { describe, expect, it } from "vitest";

import { loadGamProductionConfig } from "./gam-production.config.js";

const examplePublisherId = `pub-${"0".repeat(16)}`;
const completeExample = {
  GAM_NETWORK_CODE: "1234",
  GAM_PUBLISHER_ID: examplePublisherId,
  GAM_VIDEO_AD_UNIT_PATH: "/1234/example/video",
  GAM_DISPLAY_AD_UNIT_PREFIX: "/1234/example",
  GAM_ADS_TXT_RELATIONSHIP: "DIRECT",
};

describe("Google Ad Manager production configuration", () => {
  it("defaults to test mode and production disabled without identifiers", () => {
    const config = loadGamProductionConfig({});
    expect(config.complete).toBe(false);
    expect(config.productionEnabled).toBe(false);
    expect(config.testMode).toBe(true);
    expect(config.networkCode).toBeNull();
    expect(config.publisherId).toBeNull();
  });

  it("accepts a complete example-shaped configuration in test mode", () => {
    const config = loadGamProductionConfig(completeExample);
    expect(config.complete).toBe(true);
    expect(config.testMode).toBe(true);
    expect(config.productionEnabled).toBe(false);
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
});
