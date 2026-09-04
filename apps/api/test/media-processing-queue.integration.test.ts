import "reflect-metadata";

import { createPrismaClient } from "@ayin/db";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { MediaProcessingQueueService } from "../src/media/media-processing-queue.service.js";
import { PlatformSettingsService } from "../src/platform-config/platform-settings.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;

databaseDescribe("media processing queue global concurrency", () => {
  let moduleReference: TestingModule;
  let queue: MediaProcessingQueueService;
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
    settings = moduleReference.get(PlatformSettingsService);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Channel", "PlatformSetting" CASCADE');
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
              leaseOwner: "dead-worker",
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

  it("never gives the same queued job to two parallel claimers", async () => {
    await setSetting("mediaProcessingConcurrentJobs", 2);
    const job = await createQueuedJob("parallel");
    const claims = await Promise.all([queue.claimNext("worker-a"), queue.claimNext("worker-b")]);
    const claimed = claims.filter((item): item is NonNullable<typeof item> => item !== null);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(job.id);
    expect(claimed[0]?.attempt).toBe(1);
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

  it("recovers an expired worker lease and safely reclaims the job within the retry budget", async () => {
    await setSetting("mediaProcessingRetryLimit", 3);
    const stale = await createQueuedJob("stale", "PROCESSING");
    const recovered = await queue.claimNext("worker-recovery");
    expect(recovered?.id).toBe(stale.id);
    expect(recovered?.status).toBe("PROCESSING");
    expect(recovered?.attempt).toBe(2);
    expect(recovered?.leaseOwner).toBe("worker-recovery");
  });

  it("fails stale jobs after the retry limit instead of creating an infinite loop", async () => {
    await setSetting("mediaProcessingRetryLimit", 3);
    const stale = await createQueuedJob("retry-limit", "PROCESSING");
    await prisma.mediaProcessingJob.update({ where: { id: stale.id }, data: { attempt: 3 } });
    expect(await queue.claimNext("worker-recovery")).toBeNull();
    const stored = await prisma.mediaProcessingJob.findUnique({ where: { id: stale.id } });
    expect(stored?.status).toBe("FAILED");
    expect(stored?.errorCode).toBe("STALE_WORKER_LEASE");
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
