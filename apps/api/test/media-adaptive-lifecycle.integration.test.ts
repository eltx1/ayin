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

    await lifecycle.markFallbackReady(generation.id);
    await lifecycle.setMasterStatus(generation.id, "READY");
    await lifecycle.setRenditionStatus(generation.renditions[0]!.id, "READY");

    await expect(lifecycle.markReadyIfComplete(generation.id)).resolves.toBeNull();
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

    await lifecycle.markFallbackReady(generation.id);
    for (const rendition of generation.renditions) {
      await lifecycle.setRenditionStatus(rendition.id, "READY");
    }
    await lifecycle.setMasterStatus(generation.id, "READY");

    const ready = await lifecycle.markReadyIfComplete(generation.id);
    expect(ready?.status).toBe("READY");
    expect(ready?.renditions).toHaveLength(4);
    expect(ready?.renditions.every((item) => item.status === "READY")).toBe(true);
  });

  it("reopens a failed generation without duplicating its deterministic rendition set", async () => {
    const { job } = await createJob("reopen");
    const planned = planAdaptiveRenditions({ width: 1_280, height: 720 });
    const generation = await lifecycle.loadOrCreate(job, planned);
    await lifecycle.markFailed(generation.id, generation.renditions[1]!.id);

    await lifecycle.reopen(generation.id);
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
