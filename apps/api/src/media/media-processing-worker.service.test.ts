import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MediaProcessingWorkerService,
  configuredMediaWorkerConcurrency,
  configuredMediaWorkerShutdownGraceMs,
} from "./media-processing-worker.service.js";

describe("media worker scaling configuration", () => {
  afterEach(() => {
    delete process.env.MEDIA_WORKER_CONCURRENCY;
    delete process.env.MEDIA_WORKER_SHUTDOWN_GRACE_SECONDS;
  });

  it("bounds per-worker concurrency independently from the global database cap", () => {
    process.env.MEDIA_WORKER_CONCURRENCY = "0";
    expect(configuredMediaWorkerConcurrency()).toBe(1);

    process.env.MEDIA_WORKER_CONCURRENCY = "6";
    expect(configuredMediaWorkerConcurrency()).toBe(6);

    process.env.MEDIA_WORKER_CONCURRENCY = "999";
    expect(configuredMediaWorkerConcurrency()).toBe(128);
  });

  it("bounds graceful shutdown drain time", () => {
    process.env.MEDIA_WORKER_SHUTDOWN_GRACE_SECONDS = "1";
    expect(configuredMediaWorkerShutdownGraceMs()).toBe(5_000);

    process.env.MEDIA_WORKER_SHUTDOWN_GRACE_SECONDS = "45";
    expect(configuredMediaWorkerShutdownGraceMs()).toBe(45_000);

    process.env.MEDIA_WORKER_SHUTDOWN_GRACE_SECONDS = "999";
    expect(configuredMediaWorkerShutdownGraceMs()).toBe(300_000);
  });
});

it("automatically sweeps at startup and periodically, then stops scheduling on shutdown", async () => {
  vi.useFakeTimers();
  const queue = {
    registerWorker: vi.fn(),
    capacity: vi.fn().mockResolvedValue({ concurrentJobs: 1 }),
    claimNext: vi.fn().mockResolvedValue(null),
    markWorkerStopped: vi.fn().mockResolvedValue(undefined),
    heartbeatWorker: vi.fn().mockResolvedValue(true),
    scratchJobState: vi
      .fn()
      .mockResolvedValue({ status: "READY", leaseOwner: null, leaseExpiresAt: null }),
  };
  const scratch = {
    sweep: vi.fn(async (lookup: (id: string) => Promise<unknown>) => {
      await lookup("known-job");
    }),
  };
  const worker = new MediaProcessingWorkerService(
    queue as never,
    { process: vi.fn() } as never,
    { event: vi.fn() } as never,
    { captureError: vi.fn() } as never,
    scratch as never,
  );
  vi.spyOn(
    worker as unknown as { writeHeartbeat(): Promise<void> },
    "writeHeartbeat",
  ).mockResolvedValue();
  const running = worker.run();
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(scratch.sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(scratch.sweep).toHaveBeenCalledTimes(2);
    expect(queue.scratchJobState).toHaveBeenCalledWith("known-job");
    worker.stop();
    await vi.advanceTimersByTimeAsync(1000);
    await running;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(scratch.sweep).toHaveBeenCalledTimes(2);
  } finally {
    worker.stop();
    await vi.advanceTimersByTimeAsync(1000);
    await running;
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});
