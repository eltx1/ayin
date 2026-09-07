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
});
