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
      videoCaptionTrack: { findMany: vi.fn().mockResolvedValue([]) },
      videoCreatorMetadata: { findUnique: vi.fn().mockResolvedValue(null) },
    },
  };
  const settings = {
    get: vi.fn(async (key: string) => (key === "watchProgressSaveIntervalSeconds" ? 15 : 90)),
  };
  const featureFlags = { isEnabled: vi.fn().mockResolvedValue(input.hlsEnabled) };
  const policy = {
    decide: vi
      .fn()
      .mockResolvedValue({ allowed: true, maturityLevel: null, ageRestriction: "NONE" }),
    filterAvailableVideoIds: vi.fn(async (ids: string[]) => new Set(ids)),
  };
  const service = new WatchService(
    database as never,
    settings as never,
    featureFlags as never,
    { getPublicContextForVideo: vi.fn().mockResolvedValue(null) } as never,
    policy as never,
  );
  return { service, database, generationLookup, featureFlags };
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

  it("keeps PRIVATE as a hard boundary before any policy/admin override can expose it", async () => {
    const { service, database } = harness({ hlsEnabled: false });
    database.client.video.findUnique.mockResolvedValue({
      ...video,
      visibility: "PRIVATE",
    });
    await expect(service.getPublicPlayback(video.slug, "US")).rejects.toMatchObject({
      code: "VIDEO_NOT_FOUND",
      statusCode: 404,
    });
  });

  it("allows direct UNLISTED playback when policy allows it", async () => {
    const { service, database } = harness({ hlsEnabled: false });
    database.client.video.findUnique.mockResolvedValue({
      ...video,
      visibility: "UNLISTED",
    });
    await expect(service.getPublicPlayback(video.slug, "US")).resolves.toHaveProperty(
      "video.id",
      video.id,
    );
  });

  it("falls through to MP4 when HLS is enabled but no complete READY generation exists", async () => {
    const { service } = harness({ hlsEnabled: true, generation: null });

    const response = await service.getPublicPlayback(video.slug);

    expect(response.video.adaptiveSource).toBeNull();
    expect(response.video.source.objectKey).toBe("media/v1/canonical.mp4");
  });
});

function progressHarness(
  rows: Array<{ positionMs: number; completedAt: Date | null; lastWatchedAt: Date }>,
) {
  const query = vi.fn().mockResolvedValue(rows);
  const history = vi.fn().mockResolvedValue({});
  const tx = { $queryRaw: query, watchHistory: { upsert: history } };
  const service = new WatchService(
    {
      client: {
        viewerProfile: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: "44444444-4444-4444-8444-444444444444", isKids: false }),
        },
        video: { findFirst: vi.fn().mockResolvedValue(video) },
        $transaction: (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
      },
    } as never,
    {
      get: vi.fn(async (key: string) => (key === "watchProgressSaveIntervalSeconds" ? 15 : 90)),
    } as never,
    {} as never,
    {} as never,
    { decide: vi.fn().mockResolvedValue({ allowed: true }) } as never,
  );
  return { service, query, history };
}

describe("WatchService freshness statement boundary", () => {
  const revision = "2026-10-05T00:00:00.000Z";
  const saved = {
    positionMs: 37_000,
    completedAt: null,
    lastWatchedAt: new Date("2026-10-05T00:00:00.001Z"),
  };

  for (const expectedRevision of [null, revision]) {
    it(`does not touch history when atomic ${expectedRevision === null ? "create" : "update"} has no winner`, async () => {
      const { service, query, history } = progressHarness([]);
      await expect(
        service.saveProgress("account", video.id, { positionMs: 37_000, expectedRevision }),
      ).rejects.toMatchObject({ code: "WATCH_PROGRESS_CONFLICT", statusCode: 409 });
      expect(query).toHaveBeenCalledTimes(1);
      expect(history).not.toHaveBeenCalled();
      const sql = (query.mock.calls[0]![0] as string[]).join("?");
      expect(sql).toContain(
        expectedRevision === null
          ? 'ON CONFLICT ("profileId", "videoId") DO NOTHING'
          : 'AND "lastWatchedAt" =',
      );
    });
  }

  it("keeps revision comparison in the UPDATE and returns the saved DB revision", async () => {
    const { service, query, history } = progressHarness([saved]);
    const result = await service.saveProgress("account", video.id, {
      positionMs: 37_000,
      expectedRevision: revision,
    });
    expect(result.revision).toBe(saved.lastWatchedAt.toISOString());
    const sql = (query.mock.calls[0]![0] as string[]).join("?");
    expect(sql).toContain("AT TIME ZONE 'UTC'");
    expect(sql).toContain("INTERVAL '1 millisecond'");
    expect(query.mock.calls[0]!.slice(1)).toContain(revision);
    expect(history).toHaveBeenCalledWith(
      expect.objectContaining({ update: { lastWatchedAt: saved.lastWatchedAt } }),
    );
  });

  it("keeps legacy saves unconditional while advancing the same revision", async () => {
    const { service, query } = progressHarness([saved]);
    await service.saveProgress("account", video.id, { positionMs: 37_000 });
    const sql = (query.mock.calls[0]![0] as string[]).join("?");
    expect(sql).toContain('ON CONFLICT ("profileId", "videoId") DO UPDATE');
    expect(sql).toContain('"WatchProgress"."lastWatchedAt" + INTERVAL');
  });
});
