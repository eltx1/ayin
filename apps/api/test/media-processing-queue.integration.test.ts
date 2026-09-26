import "reflect-metadata";

import { createPrismaClient } from "@ayin/db";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { MediaProcessingLifecycleService } from "../src/media/media-processing-lifecycle.service.js";
import { MediaProcessingQueueService } from "../src/media/media-processing-queue.service.js";
import { PlatformSettingsService } from "../src/platform-config/platform-settings.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;

databaseDescribe("media processing queue global concurrency", () => {
  let moduleReference: TestingModule;
  let queue: MediaProcessingQueueService;
  let lifecycle: MediaProcessingLifecycleService;
  let settings: PlatformSettingsService;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "media-queue-test-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET = "media-queue-upload-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    queue = moduleReference.get(MediaProcessingQueueService);
    lifecycle = moduleReference.get(MediaProcessingLifecycleService);
    settings = moduleReference.get(PlatformSettingsService);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "MediaProcessingWorker", "Channel", "PlatformSetting" CASCADE',
    );
  });

  afterAll(async () => {
    await moduleReference.close();
    await prisma.$disconnect();
  });

  async function createQueuedJob(
    suffix: string,
    status: "QUEUED" | "READY" | "PROCESSING" = "QUEUED",
  ) {
    const channel = await prisma.channel.create({
      data: { handle: `queue-${suffix}`, name: `Queue ${suffix}`, status: "ACTIVE" },
    });
    const video = await prisma.video.create({
      data: {
        channelId: channel.id,
        slug: `queue-video-${suffix}`,
        title: `Queue video ${suffix}`,
        status: "VALIDATING",
      },
    });
    const now = new Date();
    return prisma.mediaProcessingJob.create({
      data: {
        videoId: video.id,
        generation: 1,
        status,
        sourceMimeType: "video/quicktime",
        sourceSizeBytes: 1024n,
        stagingKey: `staging/${video.id}/source.mov`,
        outputR2ObjectKey: `channels/${channel.id}/media/${video.id}/processed-v1.mp4`,
        queuedAt: status === "QUEUED" ? now : null,
        completedAt: status === "READY" ? now : null,
        progressPercent: status === "READY" ? 100 : 0,
        ...(status === "PROCESSING"
          ? {
              attempt: 1,
              leaseOwner: "dead-worker:dead-claim",
              leaseWorkerId: "dead-worker",
              leaseExpiresAt: new Date(now.getTime() - 60_000),
              heartbeatAt: new Date(now.getTime() - 120_000),
            }
          : {}),
      },
    });
  }

  async function setSetting(
    key:
      | "mediaProcessingEnabled"
      | "mediaProcessingConcurrentJobs"
      | "mediaProcessingRetryLimit"
      | "mediaProcessingLeaseSeconds",
    value: boolean | number,
  ) {
    await prisma.$transaction((tx) => settings.setInTransaction(tx, key, value));
  }

  it("never gives the same queued job to many parallel claimers", async () => {
    await setSetting("mediaProcessingConcurrentJobs", 8);
    const job = await createQueuedJob("parallel");
    const claims = await Promise.all(
      Array.from({ length: 20 }, (_, index) => queue.claimNext(`worker-${index}`)),
    );
    const claimed = claims.filter((item): item is NonNullable<typeof item> => item !== null);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(job.id);
    expect(claimed[0]?.attempt).toBe(1);
    expect(claimed[0]?.leaseWorkerId).toMatch(/^worker-/);
    expect(claimed[0]?.leaseOwner).toMatch(/^worker-\d+:/);
  });

  it("enforces a database-global concurrency cap and expands immediately when admin raises it", async () => {
    await setSetting("mediaProcessingConcurrentJobs", 1);
    const first = await createQueuedJob("cap-one");
    const second = await createQueuedJob("cap-two");
    expect((await queue.claimNext("worker-a"))?.id).toBe(first.id);
    expect(await queue.claimNext("worker-b")).toBeNull();
    await setSetting("mediaProcessingConcurrentJobs", 2);
    expect((await queue.claimNext("worker-b"))?.id).toBe(second.id);
  });

  it("treats READY as terminal and never automatically claims it again", async () => {
    const ready = await createQueuedJob("ready", "READY");
    expect(await queue.claimNext("worker-a")).toBeNull();
    const stored = await prisma.mediaProcessingJob.findUnique({ where: { id: ready.id } });
    expect(stored?.status).toBe("READY");
    expect(stored?.attempt).toBe(0);
  });

  it("recovers an expired worker lease and safely reclaims the job with a new fenced claim token", async () => {
    await setSetting("mediaProcessingRetryLimit", 3);
    const stale = await createQueuedJob("stale", "PROCESSING");
    const recovered = await queue.claimNext("worker-recovery");
    expect(recovered?.id).toBe(stale.id);
    expect(recovered?.status).toBe("PROCESSING");
    expect(recovered?.attempt).toBe(2);
    expect(recovered?.leaseWorkerId).toBe("worker-recovery");
    expect(recovered?.leaseOwner).toMatch(/^worker-recovery:/);
    expect(recovered?.leaseOwner).not.toBe("dead-worker:dead-claim");
  });

  it("fences an expired claim so its old owner cannot heartbeat, mutate, requeue, or finalize after recovery", async () => {
    await setSetting("mediaProcessingConcurrentJobs", 2);
    await setSetting("mediaProcessingRetryLimit", 3);
    const queued = await createQueuedJob("lease-fence");
    const first = await queue.claimNext("worker-a");
    expect(first?.id).toBe(queued.id);
    const firstToken = first!.leaseOwner!;

    await prisma.mediaProcessingJob.update({
      where: { id: queued.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });

    const second = await queue.claimNext("worker-b");
    expect(second?.id).toBe(queued.id);
    expect(second?.leaseWorkerId).toBe("worker-b");
    expect(second?.leaseOwner).not.toBe(firstToken);

    expect(await queue.heartbeat(queued.id, firstToken)).toBe(false);
    expect(
      await lifecycle.setOwnedStage({
        jobId: queued.id,
        workerId: firstToken,
        status: "VERIFYING",
        stage: "STALE_OWNER_WRITE",
        progressPercent: 99,
      }),
    ).toBe(false);
    expect(
      await queue.requeueAfterFailure({
        jobId: queued.id,
        leaseToken: firstToken,
        errorCode: "STALE_OWNER",
        errorMessage: "old execution must be fenced",
      }),
    ).toBeNull();
    expect(
      await lifecycle.finalizeReady({
        jobId: queued.id,
        workerId: firstToken,
        metadata: { sizeBytes: 100, durationMs: 1_000, width: 640, height: 360 },
      }),
    ).toBeNull();

    const stored = await prisma.mediaProcessingJob.findUniqueOrThrow({ where: { id: queued.id } });
    expect(stored.status).toBe("PROCESSING");
    expect(stored.leaseOwner).toBe(second?.leaseOwner);
    expect(stored.finalAssetId).toBeNull();
  });

  it("allows exactly one READY finalization even when the live owner races itself", async () => {
    const queued = await createQueuedJob("finalize-race");
    const claimed = await queue.claimNext("worker-a");
    const token = claimed!.leaseOwner!;
    const metadata = { sizeBytes: 100, durationMs: 1_000, width: 640, height: 360 };

    const results = await Promise.all([
      lifecycle.finalizeReady({ jobId: queued.id, workerId: token, metadata }),
      lifecycle.finalizeReady({ jobId: queued.id, workerId: token, metadata }),
    ]);
    expect(results.filter((result) => result !== null)).toHaveLength(1);

    const stored = await prisma.mediaProcessingJob.findUniqueOrThrow({ where: { id: queued.id } });
    expect(stored.status).toBe("READY");
    expect(stored.leaseOwner).toBeNull();
    expect(stored.leaseWorkerId).toBeNull();
    expect(stored.finalAssetId).not.toBeNull();
    expect(
      await prisma.mediaAsset.count({ where: { r2ObjectKey: stored.outputR2ObjectKey } }),
    ).toBe(1);
  });

  it("records worker capabilities and active-job heartbeat metadata in PostgreSQL", async () => {
    const startedAt = new Date("2026-09-27T00:00:00.000Z");
    await queue.registerWorker({
      workerId: "host-a:123:fixture",
      hostName: "host-a",
      processId: 123,
      cpuCapacity: 8,
      concurrencyLimit: 3,
      activeJobCount: 0,
      processingVersion: 2,
      releaseSha: "a".repeat(40),
      startedAt,
    });
    expect(await queue.heartbeatWorker("host-a:123:fixture", 2)).toBe(true);

    const worker = await prisma.mediaProcessingWorker.findUniqueOrThrow({
      where: { id: "host-a:123:fixture" },
    });
    expect(worker).toMatchObject({
      hostName: "host-a",
      processId: 123,
      status: "RUNNING",
      cpuCapacity: 8,
      concurrencyLimit: 3,
      activeJobCount: 2,
      processingVersion: 2,
    });

    await queue.heartbeatWorker("host-a:123:fixture", 1, "DRAINING");
    await queue.markWorkerStopped("host-a:123:fixture", 0);
    const stopped = await prisma.mediaProcessingWorker.findUniqueOrThrow({
      where: { id: "host-a:123:fixture" },
    });
    expect(stopped.status).toBe("STOPPED");
    expect(stopped.activeJobCount).toBe(0);
    expect(stopped.stoppedAt).not.toBeNull();
  });

  it("fails stale jobs after the retry limit instead of creating an infinite loop", async () => {
    await setSetting("mediaProcessingRetryLimit", 3);
    const stale = await createQueuedJob("retry-limit", "PROCESSING");
    await prisma.mediaProcessingJob.update({ where: { id: stale.id }, data: { attempt: 3 } });
    expect(await queue.claimNext("worker-recovery")).toBeNull();
    const stored = await prisma.mediaProcessingJob.findUnique({ where: { id: stale.id } });
    expect(stored?.status).toBe("FAILED");
    expect(stored?.errorCode).toBe("STALE_WORKER_LEASE");
    expect(stored?.leaseWorkerId).toBeNull();
  });

  it("pauses new claims dynamically while leaving queued work intact", async () => {
    await setSetting("mediaProcessingEnabled", false);
    const queued = await createQueuedJob("paused");
    expect(await queue.claimNext("worker-a")).toBeNull();
    expect((await prisma.mediaProcessingJob.findUnique({ where: { id: queued.id } }))?.status).toBe(
      "QUEUED",
    );
    await setSetting("mediaProcessingEnabled", true);
    expect((await queue.claimNext("worker-a"))?.id).toBe(queued.id);
  });
});
