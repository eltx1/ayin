import "reflect-metadata";

import { createPrismaClient } from "@ayin/db";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { planAdaptiveRenditions } from "../src/media/media-architecture-v2.js";
import { MediaAdaptiveLifecycleService } from "../src/media/media-adaptive-lifecycle.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;

databaseDescribe("Task 40 adaptive playback lifecycle", () => {
  let moduleReference: TestingModule;
  let lifecycle: MediaAdaptiveLifecycleService;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "media-adaptive-test-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET = "media-adaptive-upload-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    lifecycle = moduleReference.get(MediaAdaptiveLifecycleService);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "MediaPlaybackRendition", "MediaPlaybackGeneration", "MediaProcessingJob", "MediaAsset", "Video", "Channel", "PlatformSetting" CASCADE',
    );
  });

  afterAll(async () => {
    await moduleReference.close();
    await prisma.$disconnect();
  });

  async function createJob(suffix: string) {
    const channel = await prisma.channel.create({
      data: { handle: `adaptive-${suffix}`, name: `Adaptive ${suffix}`, status: "ACTIVE" },
    });
    const video = await prisma.video.create({
      data: {
        channelId: channel.id,
        slug: `adaptive-video-${suffix}`,
        title: `Adaptive video ${suffix}`,
        status: "VALIDATING",
      },
    });
    const job = await prisma.mediaProcessingJob.create({
      data: {
        videoId: video.id,
        generation: 1,
        status: "PROCESSING",
        sourceMimeType: "video/mp4",
        sourceSizeBytes: 1_024n,
        stagingKey: `channels/${channel.id}/media/source-${suffix}.mp4`,
        outputR2ObjectKey: `channels/${channel.id}/videos/${video.id}/playback/g1.mp4`,
        progressPercent: 90,
        attempt: 1,
        leaseOwner: "integration-worker",
        leaseExpiresAt: new Date(Date.now() + 180_000),
        heartbeatAt: new Date(),
      },
    });
    return { channel, video, job };
  }

  function owned(generationId: string, jobId: string) {
    return {
      generationId,
      jobId,
      workerId: "integration-worker",
    } as const;
  }

  it("reuses the same generation and rendition rows across retries", async () => {
    const { job } = await createJob("idempotent");
    const planned = planAdaptiveRenditions({ width: 1_280, height: 720 });

    const first = await lifecycle.loadOrCreate(job, planned);
    const second = await lifecycle.loadOrCreate(job, planned);

    expect(first.id).toBe(second.id);
    expect(first.renditions.map((item) => item.identity)).toEqual(["360p", "480p", "720p"]);
    expect(second.renditions.map((item) => item.identity)).toEqual(["360p", "480p", "720p"]);
    expect(await prisma.mediaPlaybackGeneration.count()).toBe(1);
    expect(await prisma.mediaPlaybackRendition.count()).toBe(3);
  });

  it("never marks a partially complete generation READY", async () => {
    const { job } = await createJob("partial");
    const generation = await lifecycle.loadOrCreate(
      job,
      planAdaptiveRenditions({ width: 1_280, height: 720 }),
    );
    const owner = owned(generation.id, job.id);

    await expect(lifecycle.markFallbackReadyIfOwned(owner)).resolves.toBe(true);
    await expect(lifecycle.setMasterStatusIfOwned({ ...owner, status: "READY" })).resolves.toBe(
      true,
    );
    await expect(
      lifecycle.setRenditionStatusIfOwned({
        ...owner,
        renditionId: generation.renditions[0]!.id,
        status: "READY",
      }),
    ).resolves.toBe(true);

    await expect(lifecycle.markReadyIfCompleteIfOwned(owner)).resolves.toBeNull();
    const stored = await prisma.mediaPlaybackGeneration.findUniqueOrThrow({
      where: { id: generation.id },
    });
    expect(stored.status).toBe("BUILDING");
  });

  it("marks READY only when fallback, master, and every planned rendition are READY", async () => {
    const { job } = await createJob("ready");
    const generation = await lifecycle.loadOrCreate(
      job,
      planAdaptiveRenditions({ width: 1_920, height: 1_080 }),
    );
    const owner = owned(generation.id, job.id);

    await expect(lifecycle.markFallbackReadyIfOwned(owner)).resolves.toBe(true);
    for (const rendition of generation.renditions) {
      await expect(
        lifecycle.setRenditionStatusIfOwned({
          ...owner,
          renditionId: rendition.id,
          status: "READY",
        }),
      ).resolves.toBe(true);
    }
    await expect(lifecycle.setMasterStatusIfOwned({ ...owner, status: "READY" })).resolves.toBe(
      true,
    );

    const ready = await lifecycle.markReadyIfCompleteIfOwned(owner);
    expect(ready?.status).toBe("READY");
    expect(ready?.renditions).toHaveLength(4);
    expect(ready?.renditions.every((item) => item.status === "READY")).toBe(true);
  });

  it("prevents an expired worker from downgrading rendition or master progress", async () => {
    const { job } = await createJob("stale-progress");
    const generation = await lifecycle.loadOrCreate(
      job,
      planAdaptiveRenditions({ width: 1_280, height: 720 }),
    );
    const owner = owned(generation.id, job.id);
    const renditionId = generation.renditions[0]!.id;

    await expect(
      lifecycle.setRenditionStatusIfOwned({ ...owner, renditionId, status: "READY" }),
    ).resolves.toBe(true);
    await expect(lifecycle.setMasterStatusIfOwned({ ...owner, status: "READY" })).resolves.toBe(
      true,
    );
    await prisma.mediaProcessingJob.update({
      where: { id: job.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(
      lifecycle.setRenditionStatusIfOwned({ ...owner, renditionId, status: "PROCESSING" }),
    ).resolves.toBe(false);
    await expect(
      lifecycle.setMasterStatusIfOwned({ ...owner, status: "UPLOADING" }),
    ).resolves.toBe(false);
    await expect(lifecycle.reopenIfOwned(owner)).resolves.toBe(false);

    const storedGeneration = await prisma.mediaPlaybackGeneration.findUniqueOrThrow({
      where: { id: generation.id },
    });
    const storedRendition = await prisma.mediaPlaybackRendition.findUniqueOrThrow({
      where: { id: renditionId },
    });
    expect(storedGeneration.hlsMasterStatus).toBe("READY");
    expect(storedRendition.status).toBe("READY");
  });

  it("rejects failure transitions from a worker whose lease already expired", async () => {
    const { job } = await createJob("stale-owner");
    const generation = await lifecycle.loadOrCreate(
      job,
      planAdaptiveRenditions({ width: 1_280, height: 720 }),
    );
    await prisma.mediaProcessingJob.update({
      where: { id: job.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(
      lifecycle.markFailedIfOwned({
        ...owned(generation.id, job.id),
        renditionId: generation.renditions[0]!.id,
      }),
    ).resolves.toBe(false);

    const storedGeneration = await prisma.mediaPlaybackGeneration.findUniqueOrThrow({
      where: { id: generation.id },
    });
    const storedRendition = await prisma.mediaPlaybackRendition.findUniqueOrThrow({
      where: { id: generation.renditions[0]!.id },
    });
    expect(storedGeneration.status).toBe("BUILDING");
    expect(storedRendition.status).toBe("PLANNED");
  });

  it("reopens an actively-owned failed generation without duplicating its deterministic rendition set", async () => {
    const { job } = await createJob("reopen");
    const planned = planAdaptiveRenditions({ width: 1_280, height: 720 });
    const generation = await lifecycle.loadOrCreate(job, planned);
    const owner = owned(generation.id, job.id);

    await expect(
      lifecycle.markFailedIfOwned({
        ...owner,
        renditionId: generation.renditions[1]!.id,
      }),
    ).resolves.toBe(true);

    await expect(lifecycle.reopenIfOwned(owner)).resolves.toBe(true);
    const retried = await lifecycle.loadOrCreate(job, planned);

    expect(retried.id).toBe(generation.id);
    expect(await prisma.mediaPlaybackGeneration.count()).toBe(1);
    expect(await prisma.mediaPlaybackRendition.count()).toBe(3);
    const stored = await prisma.mediaPlaybackGeneration.findUniqueOrThrow({
      where: { id: generation.id },
    });
    expect(stored.status).toBe("BUILDING");
    expect(stored.hlsMasterStatus).toBe("PLANNED");
  });
});
