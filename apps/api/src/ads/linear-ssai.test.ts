import { afterEach, describe, expect, it } from "vitest";

import { loadLinearSsaiConfig } from "./linear-ssai.config.js";
import { googleDaiSsbUrl, LinearSsaiService, opportunityIdentity } from "./linear-ssai.service.js";

const originalGamEnvironment = {
  GAM_NETWORK_CODE: process.env.GAM_NETWORK_CODE,
  GAM_PUBLISHER_ID: process.env.GAM_PUBLISHER_ID,
  GAM_VIDEO_AD_UNIT_PATH: process.env.GAM_VIDEO_AD_UNIT_PATH,
  GAM_DISPLAY_AD_UNIT_PREFIX: process.env.GAM_DISPLAY_AD_UNIT_PREFIX,
  GAM_ADS_TXT_RELATIONSHIP: process.env.GAM_ADS_TXT_RELATIONSHIP,
  GAM_TEST_MODE: process.env.GAM_TEST_MODE,
  GAM_PRODUCTION_ENABLED: process.env.GAM_PRODUCTION_ENABLED,
  GAM_KILL_SWITCH: process.env.GAM_KILL_SWITCH,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalGamEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Task 76 linear SSAI/DAI", () => {
  it("defaults off without inventing a Google DAI asset key", () => {
    const config = loadLinearSsaiConfig({});
    expect(config.enabled).toBe(false);
    expect(config.gamDaiEnabled).toBe(false);
    expect(config.gamDaiAssetKey).toBeNull();
    expect(config.breakDurationSeconds).toBeNull();
  });

  it("requires explicit break duration and real DAI asset key before enablement", () => {
    expect(() => loadLinearSsaiConfig({ LINEAR_SSAI_ENABLED: "1" })).toThrow(/BREAK_DURATION/);
    expect(() =>
      loadLinearSsaiConfig({
        LINEAR_SSAI_ENABLED: "1",
        LINEAR_SSAI_BREAK_DURATION_SECONDS: "30",
        GAM_DAI_ENABLED: "1",
      }),
    ).toThrow(/GAM_DAI_ASSET_KEY/);
  });

  it("creates stable opportunity identity and official SSB playback shape", () => {
    expect(opportunityIdentity("tv-1", "occurrence-1", 60_000, 30_000)).toBe(
      opportunityIdentity("tv-1", "occurrence-1", 60_000, 30_000),
    );
    expect(opportunityIdentity("tv-1", "occurrence-1", 60_000, 30_000)).not.toBe(
      opportunityIdentity("tv-1", "occurrence-1", 120_000, 30_000),
    );
    expect(googleDaiSsbUrl("real.asset-key")).toBe(
      "https://pubads.g.doubleclick.net/ssai/event/real.asset-key/master.m3u8",
    );
  });

  it("deduplicates custom breaks and prevents overlap", async () => {
    const service = makeService({
      LINEAR_SSAI_ENABLED: "1",
      LINEAR_SSAI_BREAK_DURATION_SECONDS: "30",
    });
    const startsAt = new Date("2026-09-22T00:00:00.000Z");
    const breaks = await service.getBreaks({
      tvChannelId: "tv-1",
      channelId: "channel-1",
      generatedAt: startsAt,
      programs: [
        {
          occurrenceKey: "occurrence-1",
          videoId: "video-1",
          startsAt,
          endsAt: new Date(startsAt.getTime() + 10 * 60_000),
          creatorPreference: {
            mode: "CUSTOM",
            offsetsSeconds: [60, 60, 70, 120],
          },
        },
      ],
    });

    expect(breaks).toHaveLength(2);
    expect(breaks.map((item) => item.offsetMs)).toEqual([60_000, 120_000]);
    expect(new Set(breaks.map((item) => item.opportunityId)).size).toBe(2);
    expect(breaks.every((item) => item.durationMs === 30_000)).toBe(true);
  });

  it("kills signaling without affecting the content fallback", async () => {
    const service = makeService({
      LINEAR_SSAI_ENABLED: "1",
      LINEAR_SSAI_BREAK_DURATION_SECONDS: "30",
      LINEAR_SSAI_KILL_SWITCH: "1",
    });
    expect(await service.signalingState()).toMatchObject({
      enabled: false,
      taskKillSwitch: true,
      scte35Binary: false,
      reason: "KILL_SWITCH",
    });
  });

  it("does not expose Google DAI for unsupported direct/house breaks", async () => {
    enableExampleGamProduction();
    const service = makeService({
      LINEAR_SSAI_ENABLED: "1",
      LINEAR_SSAI_BREAK_DURATION_SECONDS: "30",
      GAM_DAI_ENABLED: "1",
      GAM_DAI_ASSET_KEY: "real-asset-key",
    });
    const capability = await service.publicCapability(
      {
        tvChannelId: "tv-1",
        channelId: "channel-1",
        channelHandle: "channel",
        generatedAt: "2026-09-22T00:00:00.000Z",
        windowEndsAt: "2026-09-22T01:00:00.000Z",
        programs: [],
        adMarkers: [
          {
            id: "direct-1",
            opportunityId: "direct-1",
            occurrenceKey: "occurrence-1",
            offsetMs: 60_000,
            durationMs: 30_000,
            source: "DIRECT",
            signaling: "SCTE35_INTENT",
          },
        ],
        epg: { format: "XMLTV", xml: "" },
        adSignaling: { enabled: true, format: "HLS_CUE_OUT_IN", scte35Binary: false },
        fallback: { strategy: "PROGRESSIVE_MP4", enabled: true },
      },
      {
        providerKey: "owned-ffmpeg",
        configured: true,
        status: "READY",
        hlsUrl: "https://api.ayin.stream/public/linear/resource/index.m3u8",
        hlsMasterUrl: "https://api.ayin.stream/public/linear/resource/master.m3u8",
        providerResourceId: "resource",
        lastPlanGeneratedAt: "2026-09-22T00:00:00.000Z",
        message: null,
      },
    );
    expect(capability.dai.available).toBe(false);
    expect(capability.dai.reason).toBe("UNSUPPORTED_BREAK_SOURCE");
    expect(capability.clientSideImaFallback).toBe(true);
  });
});

function makeService(environment: NodeJS.ProcessEnv) {
  return new LinearSsaiService(loadLinearSsaiConfig(environment), {
    client: {
      platformSetting: {
        findUnique: async (query: {
          where: { namespace_key: { namespace: string; key: string } };
        }) => {
          if (query.where.namespace_key.key === "emergencyKillSwitch") {
            return { value: false };
          }
          if (query.where.namespace_key.key === "videoAdsV1") {
            return {
              value: {
                masterEnabled: true,
                provider: "GOOGLE_IMA",
                preRollEnabled: true,
                midRollEnabled: true,
                postRollEnabled: false,
                midRollEverySec: 60,
                frequencyCapPerSession: 3,
                externalVastTagUrl: "https://ads.example/vast",
                houseCreativeUrl: null,
                houseClickUrl: null,
              },
            };
          }
          return null;
        },
      },
      videoAdOverride: {
        findUnique: async () => null,
        findMany: async () => [],
      },
    },
  } as never);
}

function enableExampleGamProduction() {
  process.env.GAM_NETWORK_CODE = "1234";
  process.env.GAM_PUBLISHER_ID = "pub-0000000000000000";
  process.env.GAM_VIDEO_AD_UNIT_PATH = "/1234/example/video";
  process.env.GAM_DISPLAY_AD_UNIT_PREFIX = "/1234/example";
  process.env.GAM_ADS_TXT_RELATIONSHIP = "DIRECT";
  process.env.GAM_TEST_MODE = "0";
  process.env.GAM_PRODUCTION_ENABLED = "1";
  process.env.GAM_KILL_SWITCH = "0";
}
