import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import Fastify from "fastify";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminAuditLogService } from "../src/admin/admin-audit-log.service.js";
import { AdminMediaProcessingController } from "../src/admin/admin-media-processing.controller.js";
import type { AdminAuthenticatedRequest } from "../src/admin/admin.guard.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { MediaAdaptiveLifecycleService } from "../src/media/media-adaptive-lifecycle.service.js";
import { MediaAdaptiveRolloutService } from "../src/media/media-adaptive-rollout.service.js";
import { ADAPTIVE_BACKFILL_MARKER } from "../src/media/media-adaptive-rollout.js";
import { MediaProcessingQueueService } from "../src/media/media-processing-queue.service.js";
import { MediaProcessingLifecycleService } from "../src/media/media-processing-lifecycle.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;

databaseDescribe("media generation consistency across operator paths", () => {
  const prisma = createPrismaClient(testDatabaseUrl);
  const database = { client: prisma } as unknown as DatabaseService;
  const lifecycle = new MediaProcessingLifecycleService(database);
  const adaptive = new MediaAdaptiveLifecycleService(database);
  const rollout = new MediaAdaptiveRolloutService(
    database,
    {} as never,
    {} as never,
    lifecycle,
    {} as never,
    {} as never,
  );
  const controller = new AdminMediaProcessingController(
    database,
    {} as never,
    lifecycle,
    rollout,
    new AdminAuditLogService(database),
  );

  beforeEach(async () => {
    vi.restoreAllMocks();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Account", "Channel", "MediaPlaybackGeneration" CASCADE',
    );
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function fixture(status: "FAILED" | "READY" | "PROCESSING" = "FAILED") {
    const suffix = randomUUID();
    const actor = await prisma.account.create({
      data: { email: `${suffix}@test.invalid`, displayName: "Operator" },
    });
    const channel = await prisma.channel.create({
      data: { handle: suffix, name: "Generation test", status: "ACTIVE" },
    });
    const video = await prisma.video.create({
      data: {
        channelId: channel.id,
        slug: suffix,
        title: "Generation test",
        status: "PUBLISHED",
        visibility: "PUBLIC",
      },
    });
    const key = `channels/${channel.id}/videos/${video.id}/playback/g1.mp4`;
    const source = await prisma.mediaAsset.create({
      data: {
        channelId: channel.id,
        videoId: video.id,
        kind: "SOURCE_VIDEO",
        status: "VALIDATED",
        r2ObjectKey: key,
        mimeType: "video/mp4",
        sizeBytes: 1024n,
      },
    });
    const job = await prisma.mediaProcessingJob.create({
      data: {
        videoId: video.id,
        generation: 1,
        status,
        sourceMimeType: "video/mp4",
        sourceSizeBytes: 1024n,
        stagingKey: `staging/${video.id}`,
        inputR2ObjectKey: key,
        outputR2ObjectKey: key,
        ...(status === "READY" ? { finalAssetId: source.id } : {}),
        ...(status === "PROCESSING"
          ? { leaseOwner: "generation-worker", leaseExpiresAt: new Date(Date.now() + 60_000) }
          : {}),
      },
    });
    const request = { ayinAuth: { accountId: actor.id } } as AdminAuthenticatedRequest;
    return { job, video, source, request };
  }

  async function newerJob(
    videoId: string,
    generation: number,
    status: "READY" | "PROCESSING" = "READY",
  ) {
    return prisma.mediaProcessingJob.create({
      data: {
        videoId,
        generation,
        status,
        sourceMimeType: "video/mp4",
        sourceSizeBytes: 1024n,
        stagingKey: `${videoId}/input-${generation}`,
        outputR2ObjectKey: `${videoId}/output-${generation}.mp4`,
      },
    });
  }

  it("serializes two reprocess requests into one generation and one audit", async () => {
    const { video, request } = await fixture("READY");
    const results = await Promise.allSettled([
      controller.reprocess(request, video.id.toUpperCase()),
      controller.reprocess(request, video.id),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((result) => result.status === "rejected");
    expect(failure?.status === "rejected" && failure.reason.getResponse()).toMatchObject({
      error: { code: "MEDIA_PROCESSING_ALREADY_ACTIVE" },
    });
    expect(
      await prisma.mediaProcessingJob.count({ where: { videoId: video.id, status: "QUEUED" } }),
    ).toBe(1);
    expect(
      await prisma.adminAuditLog.count({
        where: { action: "media_processing.reprocess", entityId: video.id },
      }),
    ).toBe(1);
  });

  it("allows either retry or reprocess to win, never both", async () => {
    const { job, video, request } = await fixture();
    const results = await Promise.allSettled([
      controller.retryFailed(request, job.id),
      controller.reprocess(request, video.id),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.mediaProcessingJob.count({ where: { videoId: video.id, status: "QUEUED" } }),
    ).toBe(1);
    expect(
      await prisma.adminAuditLog.count({ where: { actorAccountId: request.ayinAuth.accountId } }),
    ).toBe(1);
  });

  it("serializes adaptive backfill and ordinary reprocessing with distinct output keys", async () => {
    const { job, video } = await fixture("READY");
    const results = await Promise.all([
      prisma.$transaction((tx) => lifecycle.createAdaptiveBackfillJob(tx, video.id)),
      prisma.$transaction((tx) => lifecycle.createReprocessJob(tx, video.id)),
    ]);
    const created = results.filter((result) => result !== null);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ generation: 2, status: "QUEUED" });
    expect(created[0]!.outputR2ObjectKey).not.toBe(job.outputR2ObjectKey);
    expect(await prisma.mediaProcessingJob.count({ where: { videoId: video.id } })).toBe(2);
  });

  it("gives backfill an independent fallback asset even when the old job owns the source", async () => {
    const { video, source } = await fixture("READY");
    const job = await prisma.$transaction((tx) =>
      lifecycle.createAdaptiveBackfillJob(tx, video.id),
    );
    expect(job).not.toBeNull();
    expect(job!.outputR2ObjectKey).not.toBe(source.r2ObjectKey);
    await prisma.mediaProcessingJob.update({
      where: { id: job!.id },
      data: {
        status: "VERIFYING",
        leaseOwner: "backfill-worker",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    const result = await lifecycle.finalizeReady({
      jobId: job!.id,
      workerId: "backfill-worker",
      metadata: { sizeBytes: 1024, durationMs: 1000, width: 640, height: 360 },
    });
    expect(result?.asset.r2ObjectKey).toBe(job!.outputR2ObjectKey);
    expect(result?.asset.id).not.toBe(source.id);
  });

  it("deduplicates simultaneous initial upload completion", async () => {
    const { job, source } = await fixture();
    await prisma.mediaProcessingJob.delete({ where: { id: job.id } });
    await prisma.mediaAsset.update({ where: { id: source.id }, data: { status: "UPLOADED" } });
    const [first, second] = await Promise.all([
      lifecycle.enqueueUploadedAsset(source.id),
      lifecycle.enqueueUploadedAsset(source.id),
    ]);
    expect(first?.id).toBe(second?.id);
    expect(await prisma.mediaProcessingJob.count()).toBe(1);
  });

  it("never retries an older processing or playback generation", async () => {
    const { job, video, request } = await fixture();
    const newer = await newerJob(video.id, 2);
    await expect(controller.retryFailed(request, job.id)).rejects.toMatchObject({
      response: { error: { code: "MEDIA_JOB_SUPERSEDED" } },
    });
    await prisma.mediaProcessingJob.delete({ where: { id: newer.id } });
    await prisma.mediaPlaybackGeneration.create({
      data: {
        videoId: video.id,
        generation: 9,
        fallbackR2ObjectKey: `${video.id}/g9.mp4`,
        hlsMasterR2ObjectKey: `${video.id}/g9.m3u8`,
      },
    });
    await expect(controller.retryFailed(request, job.id)).rejects.toMatchObject({
      response: { error: { code: "MEDIA_JOB_SUPERSEDED" } },
    });
    const reprocessed = await controller.reprocess(request, video.id);
    expect(reprocessed.generation).toBe(10);
    expect(await prisma.adminAuditLog.count({ where: { action: "media_processing.retry" } })).toBe(
      0,
    );
  });

  it("refuses creation and revival when legacy older work is still active", async () => {
    const { job, video, request } = await fixture("PROCESSING");
    const newer = await newerJob(video.id, 2);
    await prisma.mediaProcessingJob.update({ where: { id: newer.id }, data: { status: "FAILED" } });
    await expect(controller.reprocess(request, video.id)).rejects.toMatchObject({
      response: { error: { code: "MEDIA_PROCESSING_ALREADY_ACTIVE" } },
    });
    await expect(controller.retryFailed(request, newer.id)).rejects.toMatchObject({
      response: { error: { code: "MEDIA_PROCESSING_ALREADY_ACTIVE" } },
    });
    expect(await prisma.mediaProcessingJob.findUnique({ where: { id: job.id } })).toMatchObject({
      status: "PROCESSING",
    });
  });

  it("does not publish canonical or adaptive outputs from an obsolete leased job", async () => {
    const { job, video, source } = await fixture("PROCESSING");
    const generation = await adaptive.loadOrCreate(job, []);
    await newerJob(video.id, 2);
    expect(
      await lifecycle.finalizeReady({
        jobId: job.id,
        workerId: "generation-worker",
        metadata: { sizeBytes: 9999, durationMs: 9999, width: 640, height: 360 },
      }),
    ).toBeNull();
    expect(
      await adaptive.markFallbackReadyIfOwned({
        jobId: job.id,
        generationId: generation.id,
        workerId: "generation-worker",
      }),
    ).toBe(false);
    expect(
      await lifecycle.setOwnedStage({
        jobId: job.id,
        workerId: "generation-worker",
        status: "UPLOADING",
        stage: "UPLOADING_CANONICAL",
      }),
    ).toBe(false);
    const queue = new MediaProcessingQueueService(database, {
      getManyResolvedInTransaction: async () => new Map([["mediaProcessingRetryLimit", 3]]),
    } as never);
    expect(
      await queue.requeueAfterFailure({
        jobId: job.id,
        leaseToken: "generation-worker",
        errorCode: "LEASE_LOST",
        errorMessage: "obsolete work",
      }),
    ).toMatchObject({ status: "FAILED", stage: "SUPERSEDED", leaseOwner: null });
    await expect(adaptive.loadOrCreate(job, [])).rejects.toThrow("superseded");
    expect(await prisma.mediaAsset.findUnique({ where: { id: source.id } })).toMatchObject({
      sizeBytes: 1024n,
    });
    expect(
      await prisma.mediaPlaybackGeneration.findUnique({ where: { id: generation.id } }),
    ).toMatchObject({ fallbackStatus: "PLANNED" });
  });

  it("skips obsolete failures before applying the bounded recovery limit", async () => {
    for (let index = 0; index < 4; index += 1) {
      const { job, video } = await fixture();
      await prisma.mediaProcessingJob.update({
        where: { id: job.id },
        data: {
          stagingKey: `${job.stagingKey}${ADAPTIVE_BACKFILL_MARKER}1`,
          updatedAt: new Date(0),
        },
      });
      if (index === 0) {
        await prisma.mediaPlaybackGeneration.create({
          data: {
            videoId: video.id,
            generation: 2,
            fallbackR2ObjectKey: `${video.id}/g2.mp4`,
            hlsMasterR2ObjectKey: `${video.id}/g2.m3u8`,
          },
        });
      } else {
        await newerJob(video.id, 2);
      }
    }
    const { job } = await fixture();
    await prisma.mediaProcessingJob.update({
      where: { id: job.id },
      data: {
        stagingKey: `${job.stagingKey}${ADAPTIVE_BACKFILL_MARKER}1`,
        leaseWorkerId: "old-worker",
      },
    });
    vi.spyOn(rollout, "controls").mockResolvedValue({
      generationEnabled: true,
      playbackEnabled: false,
      newUploadsEnabled: false,
      backfillEnabled: true,
      backfillPaused: false,
      batchSize: 1,
      maxInFlight: 1,
    });
    expect(await rollout.recover("FAILED_BACKFILL", 20)).toMatchObject({ recovered: 1 });
    expect(await prisma.mediaProcessingJob.findUnique({ where: { id: job.id } })).toMatchObject({
      status: "QUEUED",
      leaseWorkerId: null,
    });
    expect(await prisma.mediaProcessingJob.count({ where: { status: "QUEUED" } })).toBe(1);
    expect(await rollout.recover("FAILED_BACKFILL", 20)).toMatchObject({
      recovered: 0,
      reason: "IN_FLIGHT_LIMIT",
    });
  });

  it("shares backfill capacity between manual retry and batch recovery and honors pause", async () => {
    const first = await fixture();
    const second = await fixture();
    for (const { job } of [first, second]) {
      await prisma.mediaProcessingJob.update({
        where: { id: job.id },
        data: { stagingKey: `${job.stagingKey}${ADAPTIVE_BACKFILL_MARKER}1` },
      });
    }
    const controls = {
      generationEnabled: true,
      playbackEnabled: false,
      newUploadsEnabled: false,
      backfillEnabled: true,
      backfillPaused: true,
      batchSize: 1,
      maxInFlight: 1,
    };
    const controlSpy = vi.spyOn(rollout, "controls").mockResolvedValue(controls);
    await expect(controller.retryFailed(first.request, first.job.id)).rejects.toMatchObject({
      response: { error: { code: "ADAPTIVE_RETRY_BLOCKED" } },
    });
    expect(await prisma.mediaProcessingJob.count({ where: { status: "QUEUED" } })).toBe(0);
    controlSpy.mockResolvedValue({ ...controls, backfillPaused: false });
    const results = await Promise.allSettled([
      controller.retryFailed(first.request, first.job.id),
      rollout.recover("FAILED_BACKFILL", 20),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect(await prisma.mediaProcessingJob.count({ where: { status: "QUEUED" } })).toBe(1);
  });

  it("does not requeue a job finalized after the failure handler read its lease", async () => {
    const { job } = await fixture("PROCESSING");
    const client = prisma.$extends({
      query: {
        mediaProcessingJob: {
          async findFirst({ args, query }) {
            const snapshot = await query(args);
            if (args.where?.id === job.id && args.where?.leaseOwner === "generation-worker") {
              await prisma.mediaProcessingJob.update({
                where: { id: job.id },
                data: { status: "READY", leaseOwner: null, leaseExpiresAt: null },
              });
            }
            return snapshot;
          },
        },
      },
    });
    const queue = new MediaProcessingQueueService(
      { client } as unknown as DatabaseService,
      {
        getManyResolvedInTransaction: async () => new Map([["mediaProcessingRetryLimit", 3]]),
      } as never,
    );
    expect(
      await queue.requeueAfterFailure({
        jobId: job.id,
        leaseToken: "generation-worker",
        errorCode: "LATE_FAILURE",
        errorMessage: "late callback",
      }),
    ).toBeNull();
    expect(await prisma.mediaProcessingJob.findUnique({ where: { id: job.id } })).toMatchObject({
      status: "READY",
      leaseOwner: null,
    });
  });

  it("serializes committed retry and reprocess results through Fastify", async () => {
    const { job, video, request } = await fixture();
    // Test the actual controller result with Fastify serialization, using the
    // fixture's authorized actor; HTTP guard coverage remains in the app suites.
    const app = Fastify();
    app.post("/retry", () => controller.retryFailed(request, job.id));
    app.post("/reprocess", () => controller.reprocess(request, video.id));
    try {
      const retry = await app.inject({ method: "POST", url: "/retry" });
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toMatchObject({
        id: job.id,
        videoId: video.id,
        status: "QUEUED",
        generation: 1,
      });
      expect(retry.json()).not.toHaveProperty("stagingKey");
      expect(retry.json()).not.toHaveProperty("sourceSizeBytes");
      await prisma.mediaProcessingJob.update({ where: { id: job.id }, data: { status: "READY" } });
      const reprocess = await app.inject({ method: "POST", url: "/reprocess" });
      expect(reprocess.statusCode).toBe(200);
      expect(reprocess.json()).toMatchObject({
        videoId: video.id,
        status: "QUEUED",
        generation: 2,
      });
      expect(reprocess.json()).not.toHaveProperty("outputR2ObjectKey");
      expect(
        await prisma.adminAuditLog.count({ where: { actorAccountId: request.ayinAuth.accountId } }),
      ).toBe(2);
    } finally {
      await app.close();
    }
  });
});
