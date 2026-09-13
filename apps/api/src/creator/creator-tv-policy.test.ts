import { describe, expect, it, vi } from "vitest";

import { CreatorTvService } from "./creator-tv.service.js";

describe("Creator TV policy eligibility", () => {
  it("goes off air when the only base-eligible video is unavailable in the viewer region", async () => {
    const video = {
      id: "11111111-1111-4111-8111-111111111111",
      slug: "regional",
      title: "Regional",
      description: null,
      durationMs: 60_000,
      publishedAt: new Date("2026-09-01T00:00:00.000Z"),
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      mediaAssets: [
        {
          kind: "SOURCE_VIDEO",
          r2ObjectKey: "source.mp4",
          mimeType: "video/mp4",
          durationMs: 60_000,
        },
      ],
      tvPreferences: [],
    };
    const database = {
      client: {
        creatorTvChannel: {
          findUnique: vi.fn().mockResolvedValue({
            id: "tv",
            channelId: "channel",
            slug: "tv",
            name: "TV",
            status: "ACTIVE",
            createdAt: new Date("2026-09-01T00:00:00.000Z"),
            channel: { settings: { autoAddPublishedToTv: true, tvAutoScheduleEnabled: true } },
          }),
        },
        video: { findMany: vi.fn().mockResolvedValue([video]) },
        tvScheduleItem: { findMany: vi.fn().mockResolvedValue([]) },
        videoCreatorMetadata: { findMany: vi.fn().mockResolvedValue([]) },
      },
    };
    const settings = {
      get: vi.fn(
        async (key: string) =>
          (
            ({
              autoAddPublishedUploadsToCreatorTv: true,
              creatorTvFallbackProgramDurationMs: 60_000,
              creatorTvGuideWindowMinutes: 60,
              creatorTvRotationMode: "CHRONOLOGICAL",
            }) as Record<string, unknown>
          )[key],
      ),
    };
    const channels = {
      getPublicChannel: vi.fn().mockResolvedValue({
        canonicalHandle: "creator",
        redirectedFrom: null,
        channel: { id: "channel", handle: "creator", name: "Creator" },
        appearance: {},
        creatorTv: { id: "tv" },
      }),
    };
    const adHook = { getBreaks: vi.fn().mockResolvedValue([]) };
    const policy = { filterAvailableVideoIds: vi.fn().mockResolvedValue(new Set<string>()) };
    const service = new CreatorTvService(
      database as never,
      settings as never,
      channels as never,
      adHook as never,
      policy as never,
    );
    const response = await service.getPublicTv("creator", new Date("2026-09-13T00:00:00.000Z"), {
      countryCode: "DE",
    });
    expect(response.tv).toMatchObject({ state: "OFF_AIR", offAirReason: "NO_ELIGIBLE_VIDEOS" });
    expect(policy.filterAvailableVideoIds).toHaveBeenCalledWith([video.id], { countryCode: "DE" });
  });
});
