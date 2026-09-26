import { afterEach, describe, expect, it } from "vitest";

import {
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
