import { describe, expect, it, vi } from "vitest";
import { defaultVideoAdSettings, VideoAdService } from "./video-ad.service.js";

describe("video advertising availability", () => {
  it("does not disclose a configured tag when playback policy denies the video", async () => {
    const decide = vi.fn().mockResolvedValue({ allowed: false });
    const settings = {
      ...defaultVideoAdSettings,
      masterEnabled: true,
      externalVastTagUrl: "https://ads.example.test/vast",
    };
    const database = {
      client: {
        platformSetting: {
          findUnique: vi.fn(({ where }: { where: { namespace_key: { key: string } } }) =>
            Promise.resolve({
              value: where.namespace_key.key === "emergencyKillSwitch" ? false : settings,
            }),
          ),
        },
        video: {
          findFirst: vi.fn().mockResolvedValue({
            id: "video",
            channelId: "channel",
            slug: "video",
            durationMs: 120000,
          }),
        },
        videoAdOverride: { findUnique: vi.fn().mockResolvedValue(null) },
      },
    };
    const service = new VideoAdService(
      database as unknown as ConstructorParameters<typeof VideoAdService>[0],
      {} as ConstructorParameters<typeof VideoAdService>[1],
      {} as ConstructorParameters<typeof VideoAdService>[2],
      { decide } as unknown as ConstructorParameters<typeof VideoAdService>[3],
    );
    const context = { countryCode: "EG" };
    const result = await service.getDecision("video", "https://ayin.stream", context);
    expect(result).toEqual({ enabled: false, reason: "VIDEO_NOT_ELIGIBLE" });
    expect(decide).toHaveBeenCalledWith("video", context);
    expect(database.client.videoAdOverride.findUnique).not.toHaveBeenCalled();
  });
});
