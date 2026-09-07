import { describe, expect, it, vi } from "vitest";

import { WatchService } from "./watch.service.js";

const video = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "adaptive-film",
  title: "Adaptive Film",
  description: null,
  commentsEnabled: true,
  durationMs: 120_000,
  publishedAt: new Date("2026-09-07T00:00:00.000Z"),
  status: "PUBLISHED",
  visibility: "PUBLIC",
  removedAt: null,
  channel: {
    id: "22222222-2222-4222-8222-222222222222",
    handle: "adaptive",
    name: "Adaptive",
    status: "ACTIVE",
    removedAt: null,
  },
  mediaAssets: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      kind: "SOURCE_VIDEO",
      mimeType: "video/mp4",
      r2ObjectKey: "media/v1/canonical.mp4",
      durationMs: 120_000,
    },
  ],
};

const readyGeneration = {
  fallbackR2ObjectKey: "media/v2/generation-2/fallback.mp4",
  hlsMasterR2ObjectKey: "media/v2/generation-2/master.m3u8",
  renditions: [
    {
      identity: "360p",
      width: 640,
      height: 360,
      videoBitrateKbps: 700,
      audioBitrateKbps: 96,
    },
    {
      identity: "720p",
      width: 1280,
      height: 720,
      videoBitrateKbps: 2800,
      audioBitrateKbps: 128,
    },
  ],
};

function harness(input: { hlsEnabled: boolean; generation?: typeof readyGeneration | null }) {
  const generationLookup = vi.fn().mockResolvedValue(input.generation ?? null);
  const database = {
    client: {
      video: {
        findUnique: vi.fn().mockResolvedValue(video),
        findMany: vi.fn().mockResolvedValue([]),
      },
      mediaPlaybackGeneration: { findFirst: generationLookup },
    },
  };
  const settings = {
    get: vi.fn(async (key: string) => (key === "watchProgressSaveIntervalSeconds" ? 15 : 90)),
  };
  const featureFlags = { isEnabled: vi.fn().mockResolvedValue(input.hlsEnabled) };
  const service = new WatchService(database as never, settings as never, featureFlags as never);
  return { service, generationLookup, featureFlags };
}

describe("WatchService adaptive playback", () => {
  it("keeps the existing canonical MP4 path when the Task 41 playback flag is off", async () => {
    const { service, generationLookup, featureFlags } = harness({
      hlsEnabled: false,
      generation: readyGeneration,
    });

    const response = await service.getPublicPlayback(video.slug);

    expect(featureFlags.isEnabled).toHaveBeenCalledWith("player.hls.enabled");
    expect(generationLookup).not.toHaveBeenCalled();
    expect(response.video.source).toEqual({
      objectKey: "media/v1/canonical.mp4",
      mimeType: "video/mp4",
    });
    expect(response.video.adaptiveSource).toBeNull();
  });

  it("exposes only READY HLS output with its generation-scoped MP4 fallback", async () => {
    const { service, generationLookup } = harness({
      hlsEnabled: true,
      generation: readyGeneration,
    });

    const response = await service.getPublicPlayback(video.slug);

    expect(generationLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          videoId: video.id,
          status: "READY",
          fallbackStatus: "READY",
          hlsMasterStatus: "READY",
        }),
      }),
    );
    expect(response.video.source.objectKey).toBe("media/v2/generation-2/fallback.mp4");
    expect(response.video.adaptiveSource).toEqual({
      objectKey: "media/v2/generation-2/master.m3u8",
      mimeType: "application/vnd.apple.mpegurl",
      renditions: [
        { id: "360p", label: "360p", width: 640, height: 360, bitrateKbps: 796 },
        { id: "720p", label: "720p", width: 1280, height: 720, bitrateKbps: 2928 },
      ],
    });
  });

  it("falls through to MP4 when HLS is enabled but no complete READY generation exists", async () => {
    const { service } = harness({ hlsEnabled: true, generation: null });

    const response = await service.getPublicPlayback(video.slug);

    expect(response.video.adaptiveSource).toBeNull();
    expect(response.video.source.objectKey).toBe("media/v1/canonical.mp4");
  });
});
