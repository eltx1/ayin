import { describe, expect, it, vi } from "vitest";

import { MediaAdaptiveRolloutService } from "./media-adaptive-rollout.service.js";

function createService() {
  const jobs = { count: vi.fn() };
  const tx = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    mediaProcessingJob: jobs,
    adminAuditLog: { create: vi.fn() },
  };
  const database = {
    client: {
      $queryRaw: vi.fn().mockResolvedValue([]),
      mediaProcessingJob: jobs,
      mediaPlaybackGeneration: { findMany: vi.fn().mockResolvedValue([]) },
      video: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    },
  };
  const service = new MediaAdaptiveRolloutService(
    database as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, jobs };
}

const baseControls = {
  generationEnabled: true,
  playbackEnabled: false,
  newUploadsEnabled: false,
  backfillEnabled: true,
  backfillPaused: false,
  batchSize: 2,
  maxInFlight: 1,
};

describe("MediaAdaptiveRolloutService backfill safety", () => {
  it("does not enqueue while the durable backfill pause is active", async () => {
    const { service, jobs } = createService();
    vi.spyOn(service, "controls").mockResolvedValue({ ...baseControls, backfillPaused: true });

    const result = await service.enqueueBatch(20);

    expect(result).toEqual({ enqueued: 0, reason: "BACKFILL_DISABLED_OR_PAUSED", jobs: [] });
    expect(jobs.count).not.toHaveBeenCalled();
  });

  it("refuses another batch when the configured in-flight ceiling is already reached", async () => {
    const { service, jobs } = createService();
    vi.spyOn(service, "controls").mockResolvedValue(baseControls);
    jobs.count.mockResolvedValue(1);

    const result = await service.enqueueBatch(20);

    expect(result).toEqual({ enqueued: 0, reason: "IN_FLIGHT_LIMIT", jobs: [] });
  });

  it("does not enqueue when the generation kill switch is off", async () => {
    const { service } = createService();
    vi.spyOn(service, "controls").mockResolvedValue({ ...baseControls, generationEnabled: false });

    const result = await service.enqueueBatch(2);

    expect(result.enqueued).toBe(0);
    expect(result.reason).toBe("BACKFILL_DISABLED_OR_PAUSED");
  });

  it("does not requeue failed backfill recovery while rollout is paused", async () => {
    const { service } = createService();
    vi.spyOn(service, "controls").mockResolvedValue({ ...baseControls, backfillPaused: true });

    const result = await service.recover("FAILED_BACKFILL", 2);

    expect(result).toEqual({
      mode: "FAILED_BACKFILL",
      recovered: 0,
      reason: "BACKFILL_DISABLED_OR_PAUSED",
    });
  });

  it("serializes backfill capacity checks before creating jobs", async () => {
    const jobs = { count: vi.fn().mockResolvedValue(1) };
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      mediaProcessingJob: jobs,
      adminAuditLog: { create: vi.fn() },
    };
    const database = {
      client: {
        $queryRaw: vi.fn().mockResolvedValue([]),
        mediaProcessingJob: jobs,
        mediaPlaybackGeneration: { findMany: vi.fn().mockResolvedValue([]) },
        video: { findMany: vi.fn().mockResolvedValue([]) },
        $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
      },
    };
    const service = new MediaAdaptiveRolloutService(
      database as never,
      {} as never,
      {} as never,
      { createAdaptiveBackfillJob: vi.fn() } as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service, "controls").mockResolvedValue({ ...baseControls, maxInFlight: 1 });

    const result = await service.enqueueBatch(2);

    expect(result.reason).toBe("IN_FLIGHT_LIMIT");
    expect(tx.$executeRawUnsafe).toHaveBeenCalled();
  });

  it.each([
    "FAILED_BACKFILL",
    "DB_MANIFEST_MISSING",
    "INCOMPLETE_HLS",
    "VERIFIED_HLS_MISSING_DB",
  ] as const)("rechecks a pause at the %s mutation boundary", async (mode) => {
    const { service, jobs } = createService();
    vi.spyOn(service, "controls")
      .mockResolvedValueOnce(baseControls)
      .mockResolvedValue({ ...baseControls, backfillPaused: true });
    expect(await service.recover(mode, 1)).toMatchObject({ reason: "BACKFILL_DISABLED_OR_PAUSED" });
    expect(jobs.count).not.toHaveBeenCalled();
  });

  it("caps failed backfill recovery by the remaining in-flight slots", async () => {
    const failed = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        videoId: "22222222-2222-4222-8222-222222222222",
        generation: 1,
        updatedAt: new Date(),
      },
    ];
    const tx = {
      $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue(failed),
      mediaPlaybackGeneration: { findFirst: vi.fn().mockResolvedValue(null) },
      mediaProcessingJob: {
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      adminAuditLog: { create: vi.fn() },
    };
    const database = {
      client: {
        $queryRaw: vi.fn().mockResolvedValue([]),
        $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
      },
    };
    const service = new MediaAdaptiveRolloutService(
      database as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service, "controls").mockResolvedValue({ ...baseControls, maxInFlight: 1 });

    const result = await service.recover("FAILED_BACKFILL", 20);

    expect(result).toEqual({ mode: "FAILED_BACKFILL", recovered: 1 });
    expect(tx.$queryRaw.mock.calls[0]?.at(-1)).toBe(1);
    expect(tx.mediaProcessingJob.updateMany).toHaveBeenCalledTimes(1);
  });
});

it.each(["channels/c/videos/v/playback/g1/attempts/a/hls/master.m3u8", null])(
  "required recovery inspection uses its recorded attempt manifest (%s), never a reconstructed legacy key",
  async (attemptMasterKey) => {
    const candidate = {
      id: "11111111-1111-4111-8111-111111111111",
      channelId: "22222222-2222-4222-8222-222222222222",
    };
    const database = {
      client: {
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([candidate])
          .mockResolvedValueOnce([
            { videoId: candidate.id, generation: 1, inputIntegrityVersion: 1, attemptMasterKey },
          ]),
        mediaPlaybackGeneration: { findMany: vi.fn().mockResolvedValue([]) },
      },
    };
    const storage = { headObject: vi.fn().mockResolvedValue({ sizeBytes: 1 }) };
    const service = new MediaAdaptiveRolloutService(
      database as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      storage as never,
    );
    const result = await (
      service as unknown as {
        findVerifiedHlsMissingDb(limit: number): Promise<{ videos: unknown[] }>;
      }
    ).findVerifiedHlsMissingDb(1);
    if (attemptMasterKey) {
      expect(storage.headObject).toHaveBeenCalledExactlyOnceWith(attemptMasterKey);
      expect(result.videos).toEqual([candidate]);
    } else {
      expect(storage.headObject).not.toHaveBeenCalled();
      expect(result.videos).toEqual([]);
    }
  },
);
