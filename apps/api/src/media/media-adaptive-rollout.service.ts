import { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { FeatureFlagService } from "../platform-config/feature-flag.service.js";
import { lockMediaRollout } from "../platform-config/media-rollout-lock.js";
import type { PlatformSettingKey } from "../platform-config/platform-settings.catalog.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import { R2HttpError } from "./r2-sigv4.js";
import { hlsMasterObjectKey } from "./media-architecture-v2.js";
import {
  ADAPTIVE_BACKFILL_HARD_BATCH_MAX,
  ADAPTIVE_BACKFILL_HARD_IN_FLIGHT_MAX,
  ADAPTIVE_BACKFILL_MARKER,
  ADAPTIVE_PLAYBACK_FEATURE_FLAG,
  type AdaptiveRecoveryMode,
} from "./media-adaptive-rollout.js";
import { MediaProcessingLifecycleService } from "./media-processing-lifecycle.service.js";
import { MediaProcessingQueueService } from "./media-processing-queue.service.js";
import { MediaProcessingStorageService } from "./media-processing-storage.service.js";
import {
  hasActiveMediaJob,
  hasNewerMediaGeneration,
  lockMediaGeneration,
} from "./media-generation-safety.js";

const ACTIVE_PROCESSING = ["PROCESSING", "UPLOADING", "VERIFYING"] as const;
const ACTIVE_OR_QUEUED = ["QUEUED", ...ACTIVE_PROCESSING] as const;
const RECOVERY_STALE_MS = 10 * 60 * 1000;
const METRICS_WINDOW_DAYS = 30;
const RECOVERY_SCAN_PAGE_SIZE = 25;
const RECOVERY_SCAN_MAX_ROWS = 250;

interface CatalogVideo {
  id: string;
  channelId: string;
  publishedAt: Date | null;
  createdAt: Date;
  mediaAssets: Array<{
    id: string;
    r2ObjectKey: string;
    width: number | null;
    height: number | null;
    durationMs: number | null;
  }>;
}

@Injectable()
export class MediaAdaptiveRolloutService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
    @Inject(FeatureFlagService) private readonly featureFlags: FeatureFlagService,
    @Inject(MediaProcessingLifecycleService)
    private readonly lifecycle: MediaProcessingLifecycleService,
    @Inject(MediaProcessingQueueService) private readonly queue: MediaProcessingQueueService,
    @Inject(MediaProcessingStorageService) private readonly storage: MediaProcessingStorageService,
  ) {}

  async controls(tx?: Prisma.TransactionClient) {
    const values = tx
      ? await this.settings.getManyResolvedInTransaction(tx, [
          "mediaHlsEnabled",
          "mediaHlsNewUploadsEnabled",
          "mediaHlsBackfillEnabled",
          "mediaHlsBackfillPaused",
          "mediaHlsBackfillBatchSize",
          "mediaHlsBackfillMaxInFlight",
        ])
      : null;
    const get = (key: PlatformSettingKey) => (values ? values.get(key) : this.settings.get(key));
    const [
      generationEnabled,
      newUploadsEnabled,
      backfillEnabled,
      backfillPaused,
      batchSizeRaw,
      maxInFlightRaw,
      playbackEnabled,
    ] = await Promise.all([
      get("mediaHlsEnabled"),
      get("mediaHlsNewUploadsEnabled"),
      get("mediaHlsBackfillEnabled"),
      get("mediaHlsBackfillPaused"),
      get("mediaHlsBackfillBatchSize"),
      get("mediaHlsBackfillMaxInFlight"),
      this.featureFlags.isEnabled(ADAPTIVE_PLAYBACK_FEATURE_FLAG, tx),
    ]);
    return {
      generationEnabled: generationEnabled as boolean,
      playbackEnabled,
      newUploadsEnabled: newUploadsEnabled as boolean,
      backfillEnabled: backfillEnabled as boolean,
      backfillPaused: backfillPaused as boolean,
      batchSize: Math.min(Number(batchSizeRaw), ADAPTIVE_BACKFILL_HARD_BATCH_MAX),
      maxInFlight: Math.min(Number(maxInFlightRaw), ADAPTIVE_BACKFILL_HARD_IN_FLIGHT_MAX),
    };
  }

  async overview() {
    const controls = await this.controls();
    const videos = await this.catalogVideos();
    const videoIds = videos.map((video) => video.id);
    const [readyRows, queued, processing, failed, metrics] = await Promise.all([
      videoIds.length
        ? this.database.client.mediaPlaybackGeneration.findMany({
            where: {
              videoId: { in: videoIds },
              status: "READY",
              fallbackStatus: "READY",
              hlsMasterStatus: "READY",
              renditions: { some: { status: "READY", protocol: "HLS" } },
            },
            distinct: ["videoId"],
            select: { videoId: true },
          })
        : [],
      this.database.client.mediaProcessingJob.count({
        where: { stagingKey: { contains: ADAPTIVE_BACKFILL_MARKER }, status: "QUEUED" },
      }),
      this.database.client.mediaProcessingJob.count({
        where: {
          stagingKey: { contains: ADAPTIVE_BACKFILL_MARKER },
          status: { in: [...ACTIVE_PROCESSING] },
        },
      }),
      this.database.client.mediaProcessingJob.count({
        where: { stagingKey: { contains: ADAPTIVE_BACKFILL_MARKER }, status: "FAILED" },
      }),
      this.metrics(),
    ]);
    const readyIds = new Set(readyRows.map((row) => row.videoId));
    const pending = videos.filter((video) => !readyIds.has(video.id));
    const oldest = pending[0];
    return {
      controls,
      catalog: {
        eligible: pending.length,
        queued,
        processing,
        adaptiveReady: readyIds.size,
        failed,
        fallbackOnly: pending.length,
        oldestPending: oldest
          ? { videoId: oldest.id, publishedAt: oldest.publishedAt ?? oldest.createdAt }
          : null,
      },
      metrics,
    };
  }

  async failedRetryBlockReasonInTransaction(tx: Prisma.TransactionClient) {
    // Same ordering/capacity boundary as batch recovery, before the video lock.
    await this.lockBackfill(tx);
    const controls = await this.controls(tx);
    if (!controls.generationEnabled || !controls.backfillEnabled || controls.backfillPaused) {
      return "BACKFILL_DISABLED_OR_PAUSED" as const;
    }
    if ((await this.availableBackfillSlots(tx, controls.maxInFlight)) === 0) {
      return "IN_FLIGHT_LIMIT" as const;
    }
    return null;
  }

  async enqueueBatch(requestedBatchSize?: number, actorAccountId?: string) {
    const controls = await this.controls();
    if (!controls.generationEnabled || !controls.backfillEnabled || controls.backfillPaused) {
      return { enqueued: 0, reason: "BACKFILL_DISABLED_OR_PAUSED" as const, jobs: [] };
    }
    const requested = Number.isFinite(requestedBatchSize)
      ? Math.max(1, Math.floor(requestedBatchSize as number))
      : controls.batchSize;
    const batchSize = Math.min(requested, controls.batchSize, ADAPTIVE_BACKFILL_HARD_BATCH_MAX);
    const candidates = await this.pendingCandidates(batchSize * 4);

    return this.database.client.$transaction(async (tx) => {
      await this.lockBackfill(tx);
      const current = await this.controls(tx);
      if (!current.generationEnabled || !current.backfillEnabled || current.backfillPaused) {
        return { enqueued: 0, reason: "BACKFILL_DISABLED_OR_PAUSED" as const, jobs: [] };
      }
      const availableSlots = await this.availableBackfillSlots(tx, current.maxInFlight);
      const take = Math.min(batchSize, current.batchSize, availableSlots);
      if (take === 0) {
        const result = { enqueued: 0, reason: "IN_FLIGHT_LIMIT" as const, jobs: [] };
        await this.auditMutation(tx, actorAccountId, "media_adaptive.backfill_batch", {
          requestedBatchSize: requestedBatchSize ?? null,
          enqueued: 0,
          reason: result.reason,
        });
        return result;
      }

      const jobs = [];
      for (const candidate of candidates) {
        if (jobs.length >= take) break;
        const job = await this.lifecycle.createAdaptiveBackfillJob(tx, candidate.id);
        if (job) jobs.push(job);
      }
      const result = {
        enqueued: jobs.length,
        reason: jobs.length ? ("ENQUEUED" as const) : ("NO_ELIGIBLE_VIDEO" as const),
        jobs,
      };
      await this.auditMutation(tx, actorAccountId, "media_adaptive.backfill_batch", {
        requestedBatchSize: requestedBatchSize ?? null,
        enqueued: result.enqueued,
        reason: result.reason,
      });
      return result;
    });
  }

  async setPaused(paused: boolean, actorAccountId?: string) {
    await this.database.client.$transaction(async (tx) => {
      await this.settings.setInTransaction(tx, "mediaHlsBackfillPaused", paused);
      await this.auditMutation(
        tx,
        actorAccountId,
        paused ? "media_adaptive.backfill_pause" : "media_adaptive.backfill_resume",
        { paused },
      );
    });
    return this.controls();
  }

  async recover(
    mode: AdaptiveRecoveryMode,
    requestedBatchSize?: number,
    actorAccountId?: string,
    cursor?: string,
  ) {
    const controls = await this.controls();
    const batchSize = Math.min(
      Math.max(1, Math.floor(requestedBatchSize ?? controls.batchSize)),
      ADAPTIVE_BACKFILL_HARD_BATCH_MAX,
    );

    if (mode === "STALE_PROCESSING") {
      const stale = await this.queue.recoverStale(async (tx, result) => {
        await this.auditMutation(tx, actorAccountId, "media_adaptive.recovery", {
          mode,
          requestedBatchSize: requestedBatchSize ?? null,
          recovered: result.recovered,
          requeued: result.requeued,
          failed: result.failed,
        });
      }, batchSize);
      return { mode, ...stale };
    }

    if (!controls.generationEnabled || !controls.backfillEnabled || controls.backfillPaused) {
      return { mode, recovered: 0, reason: "BACKFILL_DISABLED_OR_PAUSED" as const };
    }

    if (mode === "FAILED_BACKFILL") {
      return this.database.client.$transaction(async (tx) => {
        await this.lockBackfill(tx);
        const current = await this.controls(tx);
        if (!current.generationEnabled || !current.backfillEnabled || current.backfillPaused) {
          return { mode, recovered: 0, reason: "BACKFILL_DISABLED_OR_PAUSED" as const };
        }
        const availableSlots = await this.availableBackfillSlots(tx, current.maxInFlight);
        if (availableSlots === 0) {
          const result = { mode, recovered: 0, reason: "IN_FLIGHT_LIMIT" as const };
          await this.auditMutation(tx, actorAccountId, "media_adaptive.recovery", {
            mode,
            requestedBatchSize: requestedBatchSize ?? null,
            recovered: 0,
            reason: result.reason,
          });
          return result;
        }
        // Exclude obsolete/blocked jobs BEFORE limiting the batch so old failures
        // cannot indefinitely hide eligible work. Recheck after the per-video lock.
        const failed = await tx.$queryRaw<
          Array<{ id: string; videoId: string; generation: number; updatedAt: Date }>
        >`
          SELECT j."id", j."videoId", j."generation", j."updatedAt"
          FROM "MediaProcessingJob" j
          WHERE j."status" = 'FAILED'
            AND strpos(j."stagingKey", ${ADAPTIVE_BACKFILL_MARKER}) > 0
            AND NOT EXISTS (SELECT 1 FROM "MediaProcessingJob" newer
              WHERE newer."videoId" = j."videoId" AND newer."generation" > j."generation")
            AND NOT EXISTS (SELECT 1 FROM "MediaPlaybackGeneration" newer
              WHERE newer."videoId" = j."videoId" AND newer."generation" > j."generation")
            AND NOT EXISTS (SELECT 1 FROM "MediaProcessingJob" active
              WHERE active."videoId" = j."videoId"
                AND active."status" IN ('INGESTING', 'QUEUED', 'PROCESSING', 'UPLOADING', 'VERIFYING'))
          ORDER BY j."updatedAt", j."id"
          LIMIT ${Math.min(batchSize, availableSlots)}
        `;
        let recovered = 0;
        for (const job of failed) {
          await lockMediaGeneration(tx, job.videoId);
          if (
            (await hasNewerMediaGeneration(tx, job)) ||
            (await hasActiveMediaJob(tx, job.videoId, job.id))
          )
            continue;
          const changed = await tx.mediaProcessingJob.updateMany({
            where: { id: job.id, status: "FAILED", updatedAt: job.updatedAt },
            data: {
              status: "QUEUED",
              stage: "ADAPTIVE_BACKFILL_RETRY_QUEUED",
              progressPercent: 0,
              attempt: 0,
              queuedAt: new Date(),
              startedAt: null,
              completedAt: null,
              leaseOwner: null,
              leaseWorkerId: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
              errorCode: null,
              errorMessage: null,
            },
          });
          recovered += changed.count;
        }
        await this.auditMutation(tx, actorAccountId, "media_adaptive.recovery", {
          mode,
          requestedBatchSize: requestedBatchSize ?? null,
          recovered,
        });
        return { mode, recovered };
      });
    }

    if (mode === "DB_MANIFEST_MISSING") {
      const scan = await this.findMissingManifestRows(batchSize, cursor);
      return this.database.client.$transaction(async (tx) => {
        await this.lockBackfill(tx);
        const current = await this.controls(tx);
        if (!current.generationEnabled || !current.backfillEnabled || current.backfillPaused) {
          return { mode, recovered: 0, reason: "BACKFILL_DISABLED_OR_PAUSED" as const };
        }
        const availableSlots = await this.availableBackfillSlots(tx, current.maxInFlight);
        let detected = 0;
        let requeued = 0;
        for (const row of scan.rows) {
          await lockMediaGeneration(tx, row.videoId);
          const changed = await tx.mediaPlaybackGeneration.updateMany({
            where: {
              id: row.id,
              status: "READY",
              hlsMasterStatus: "READY",
              updatedAt: row.updatedAt,
              hlsMasterR2ObjectKey: row.hlsMasterR2ObjectKey,
            },
            data: {
              status: "FAILED",
              hlsMasterStatus: "FAILED",
              failedAt: new Date(),
              readyAt: null,
            },
          });
          if (changed.count !== 1) continue;
          detected += 1;
          if (requeued >= availableSlots) continue;
          const job = await this.lifecycle.createAdaptiveBackfillJob(tx, row.videoId);
          if (job) requeued += 1;
        }
        await this.auditMutation(tx, actorAccountId, "media_adaptive.recovery", {
          mode,
          requestedBatchSize: requestedBatchSize ?? null,
          detected,
          requeued,
          scanned: scan.scanned,
        });
        return {
          mode,
          detected,
          requeued,
          scanned: scan.scanned,
          nextCursor: scan.nextCursor,
          ...(availableSlots === 0 ? { reason: "IN_FLIGHT_LIMIT" as const } : {}),
        };
      });
    }

    if (mode === "INCOMPLETE_HLS") {
      const rows = await this.database.client.mediaPlaybackGeneration.findMany({
        where: {
          status: { in: ["BUILDING", "FAILED"] },
          updatedAt: { lt: new Date(Date.now() - RECOVERY_STALE_MS) },
        },
        orderBy: { updatedAt: "asc" },
        take: Math.min(batchSize * 4, RECOVERY_SCAN_MAX_ROWS),
        select: { id: true, videoId: true },
      });
      const uniqueRows = rows.filter(
        (row, index, all) =>
          all.findIndex((candidate) => candidate.videoId === row.videoId) === index,
      );
      return this.database.client.$transaction(async (tx) => {
        await this.lockBackfill(tx);
        const current = await this.controls(tx);
        if (!current.generationEnabled || !current.backfillEnabled || current.backfillPaused) {
          return { mode, recovered: 0, reason: "BACKFILL_DISABLED_OR_PAUSED" as const };
        }
        const availableSlots = await this.availableBackfillSlots(tx, current.maxInFlight);
        let requeued = 0;
        for (const row of uniqueRows) {
          if (requeued >= Math.min(batchSize, availableSlots)) break;
          const job = await this.lifecycle.createAdaptiveBackfillJob(tx, row.videoId);
          if (!job) continue;
          requeued += 1;
          await tx.mediaPlaybackGeneration.updateMany({
            where: { id: row.id, status: { in: ["BUILDING", "FAILED"] } },
            data: { status: "SUPERSEDED" },
          });
        }
        await this.auditMutation(tx, actorAccountId, "media_adaptive.recovery", {
          mode,
          requestedBatchSize: requestedBatchSize ?? null,
          detected: uniqueRows.length,
          requeued,
        });
        return {
          mode,
          detected: uniqueRows.length,
          requeued,
          ...(availableSlots === 0 ? { reason: "IN_FLIGHT_LIMIT" as const } : {}),
        };
      });
    }

    const scan = await this.findVerifiedHlsMissingDb(batchSize, cursor);
    return this.database.client.$transaction(async (tx) => {
      await this.lockBackfill(tx);
      const current = await this.controls(tx);
      if (!current.generationEnabled || !current.backfillEnabled || current.backfillPaused) {
        return { mode, recovered: 0, reason: "BACKFILL_DISABLED_OR_PAUSED" as const };
      }
      const availableSlots = await this.availableBackfillSlots(tx, current.maxInFlight);
      let requeued = 0;
      let capacityLimited = false;
      for (const video of scan.videos) {
        if (requeued >= Math.min(batchSize, availableSlots)) {
          capacityLimited = true;
          break;
        }
        const job = await this.lifecycle.createAdaptiveBackfillJob(tx, video.id);
        if (job) requeued += 1;
      }
      await this.auditMutation(tx, actorAccountId, "media_adaptive.recovery", {
        mode,
        requestedBatchSize: requestedBatchSize ?? null,
        detected: scan.videos.length,
        requeued,
        scanned: scan.scanned,
      });
      return {
        mode,
        detected: scan.videos.length,
        requeued,
        scanned: scan.scanned,
        // Revisit this range when capacity returns; queued videos are filtered out.
        // hasMore is authoritative when the initial (null) cursor must be retried.
        nextCursor: capacityLimited ? (cursor ?? null) : scan.nextCursor,
        hasMore: capacityLimited || scan.nextCursor !== null,
        policy: "REPROCESS_VERIFIED_ORPHAN_IN_NEW_GENERATION",
        ...(availableSlots === 0 ? { reason: "IN_FLIGHT_LIMIT" as const } : {}),
      };
    });
  }

  private async findMissingManifestRows(batchSize: number, cursor?: string) {
    const missing: Array<{
      id: string;
      videoId: string;
      hlsMasterR2ObjectKey: string;
      updatedAt: Date;
    }> = [];
    let nextCursor = cursor ?? null;
    let scanned = 0;
    let exhausted = false;

    while (missing.length < batchSize && scanned < RECOVERY_SCAN_MAX_ROWS && !exhausted) {
      const take = Math.min(RECOVERY_SCAN_PAGE_SIZE, RECOVERY_SCAN_MAX_ROWS - scanned);
      const rows = await this.database.client.mediaPlaybackGeneration.findMany({
        where: {
          status: "READY",
          hlsMasterStatus: "READY",
          ...(nextCursor ? { id: { gt: nextCursor } } : {}),
        },
        orderBy: { id: "asc" },
        take,
        select: { id: true, videoId: true, hlsMasterR2ObjectKey: true, updatedAt: true },
      });
      if (rows.length === 0) {
        exhausted = true;
        break;
      }
      for (const row of rows) {
        nextCursor = row.id;
        scanned += 1;
        if (!(await this.objectExists(row.hlsMasterR2ObjectKey))) missing.push(row);
        if (missing.length >= batchSize || scanned >= RECOVERY_SCAN_MAX_ROWS) break;
      }
      if (rows.length < take && nextCursor === rows.at(-1)?.id) exhausted = true;
    }

    return { rows: missing, scanned, nextCursor: exhausted ? null : nextCursor };
  }

  private async findVerifiedHlsMissingDb(batchSize: number, cursor?: string) {
    const candidates = await this.pendingCandidates(RECOVERY_SCAN_MAX_ROWS, cursor);
    const videos: CatalogVideo[] = [];
    let scanned = 0;
    let nextCursor: string | null = cursor ?? null;

    // One bounded query finds the latest job per candidate; no per-video SQL loop.
    const latestJobs = candidates.length
      ? await this.database.client.$queryRaw<Array<{ videoId: string; generation: number }>>`
      SELECT v.id AS "videoId", j.generation
      FROM "Video" v
      CROSS JOIN LATERAL (
        SELECT generation FROM "MediaProcessingJob"
        WHERE "videoId" = v.id ORDER BY generation DESC LIMIT 1
      ) j
      WHERE v.id IN (${Prisma.join(candidates.map((video) => Prisma.sql`${video.id}::uuid`))})
    `
      : [];
    const existing = latestJobs.length
      ? await this.database.client.mediaPlaybackGeneration.findMany({
          where: { OR: latestJobs.map(({ videoId, generation }) => ({ videoId, generation })) },
          select: { videoId: true },
        })
      : [];
    const existingIds = new Set(existing.map((row) => row.videoId));
    const jobsByVideo = new Map(latestJobs.map((job) => [job.videoId, job]));
    for (const video of candidates) {
      nextCursor = video.id;
      scanned += 1;
      const latestJob = jobsByVideo.get(video.id);
      if (!latestJob || existingIds.has(video.id)) continue;
      const manifestKey = hlsMasterObjectKey({
        channelId: video.channelId,
        videoId: video.id,
        generation: latestJob.generation,
      });
      if (!(await this.objectExists(manifestKey))) continue;
      videos.push(video);
      if (videos.length >= batchSize) break;
    }

    const exhausted = candidates.length < RECOVERY_SCAN_MAX_ROWS && scanned === candidates.length;
    return { videos, scanned, nextCursor: exhausted ? null : nextCursor };
  }

  private async lockBackfill(tx: Prisma.TransactionClient): Promise<void> {
    await lockMediaRollout(tx);
  }

  private async availableBackfillSlots(
    tx: Prisma.TransactionClient,
    maxInFlight: number,
  ): Promise<number> {
    const inFlight = await tx.mediaProcessingJob.count({
      where: {
        stagingKey: { contains: ADAPTIVE_BACKFILL_MARKER },
        status: { in: [...ACTIVE_OR_QUEUED] },
      },
    });
    return Math.max(0, maxInFlight - inFlight);
  }

  private async auditMutation(
    tx: Prisma.TransactionClient,
    actorAccountId: string | undefined,
    action: string,
    metadata: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    if (!actorAccountId) return;
    await tx.adminAuditLog.create({
      data: {
        actorAccountId,
        action,
        entityType: "AdaptiveStreamingRollout",
        metadata: metadata as Prisma.InputJsonObject,
      },
    });
  }

  private async metrics() {
    const since = new Date(Date.now() - METRICS_WINDOW_DAYS * 86_400_000);
    const [hlsStarts, fatalFailures, fallbacks, readyGenerations] = await Promise.all([
      this.database.client.analyticsEvent.count({
        where: {
          occurredAt: { gte: since },
          eventName: "VIDEO_START",
          metadata: { path: ["protocol"], equals: "HLS" },
        },
      }),
      this.database.client.analyticsEvent.count({
        where: { occurredAt: { gte: since }, eventName: "VIDEO_HLS_FATAL" },
      }),
      this.database.client.analyticsEvent.count({
        where: { occurredAt: { gte: since }, eventName: "VIDEO_FALLBACK" },
      }),
      this.database.client.mediaPlaybackGeneration.findMany({
        where: { status: "READY", readyAt: { not: null } },
        orderBy: { readyAt: "desc" },
        take: 1000,
        select: {
          sourceMediaAssetId: true,
          createdAt: true,
          readyAt: true,
          hlsOutputSizeBytes: true,
        },
      }),
    ]);
    const [totalStorage, growthStorage] = await Promise.all([
      this.database.client.mediaPlaybackGeneration.aggregate({
        where: { status: "READY" },
        _sum: { hlsOutputSizeBytes: true },
      }),
      this.database.client.mediaPlaybackGeneration.aggregate({
        where: { status: "READY", readyAt: { gte: since } },
        _sum: { hlsOutputSizeBytes: true },
      }),
    ]);
    const sourceIds = readyGenerations.flatMap((generation) =>
      generation.sourceMediaAssetId ? [generation.sourceMediaAssetId] : [],
    );
    const assets = sourceIds.length
      ? await this.database.client.mediaAsset.findMany({
          where: { id: { in: sourceIds } },
          select: { id: true, width: true, height: true },
        })
      : [];
    const dimensions = new Map(assets.map((asset) => [asset.id, asset]));
    const buckets = new Map<string, { totalMs: number; count: number }>();
    for (const generation of readyGenerations) {
      if (!generation.readyAt || !generation.sourceMediaAssetId) continue;
      const asset = dimensions.get(generation.sourceMediaAssetId);
      const label = resolutionBucket(asset?.height ?? null);
      const bucket = buckets.get(label) ?? { totalMs: 0, count: 0 };
      bucket.totalMs += Math.max(0, generation.readyAt.getTime() - generation.createdAt.getTime());
      bucket.count += 1;
      buckets.set(label, bucket);
    }
    const attempts = hlsStarts + fallbacks;
    return {
      windowDays: METRICS_WINDOW_DAYS,
      hlsStartupSuccess: hlsStarts,
      fatalAdaptiveFailure: fatalFailures,
      mp4Fallbacks: fallbacks,
      mp4FallbackRate: attempts > 0 ? fallbacks / attempts : 0,
      averageProcessingDurationMsBySourceResolution: Object.fromEntries(
        [...buckets].map(([key, value]) => [key, Math.round(value.totalMs / value.count)]),
      ),
      outputStorageBytes: (totalStorage._sum.hlsOutputSizeBytes ?? 0n).toString(),
      outputStorageGrowthBytes: (growthStorage._sum.hlsOutputSizeBytes ?? 0n).toString(),
      sampledReadyGenerations: readyGenerations.length,
    };
  }

  private async pendingCandidates(limit: number, afterVideoId?: string): Promise<CatalogVideo[]> {
    const candidates = await this.database.client.$queryRaw<CatalogVideo[]>`
      SELECT v.id, v."channelId", v."publishedAt", v."createdAt",
        jsonb_build_array(jsonb_build_object('id', a.id, 'r2ObjectKey', a."r2ObjectKey",
          'width', a.width, 'height', a.height, 'durationMs', a."durationMs")) AS "mediaAssets"
      FROM "Video" v JOIN "Channel" c ON c.id = v."channelId"
      JOIN LATERAL (SELECT id, "r2ObjectKey", width, height, "durationMs"
        FROM "MediaAsset" WHERE "videoId" = v.id AND kind = 'SOURCE_VIDEO'
          AND status = 'VALIDATED' AND "mimeType" = 'video/mp4' AND "removedAt" IS NULL
        ORDER BY "createdAt" DESC, id DESC LIMIT 1) a ON true
      WHERE v.status = 'PUBLISHED' AND v.visibility <> 'PRIVATE' AND v."removedAt" IS NULL
        AND c.status = 'ACTIVE' AND c."removedAt" IS NULL
        AND (${afterVideoId ?? null}::uuid IS NULL OR v.id > ${afterVideoId ?? null}::uuid)
        AND NOT EXISTS (SELECT 1 FROM "MediaPlaybackGeneration" g WHERE g."videoId" = v.id
          AND g.status = 'READY' AND g."fallbackStatus" = 'READY' AND g."hlsMasterStatus" = 'READY'
          AND EXISTS (SELECT 1 FROM "MediaPlaybackRendition" r WHERE r."playbackGenerationId" = g.id
            AND r.status = 'READY' AND r.protocol = 'HLS'))
        AND NOT EXISTS (SELECT 1 FROM "MediaProcessingJob" j WHERE j."videoId" = v.id
          AND j.status IN ('INGESTING', 'QUEUED', 'PROCESSING', 'UPLOADING', 'VERIFYING'))
      ORDER BY v.id LIMIT ${Math.min(limit, RECOVERY_SCAN_MAX_ROWS)}
    `;
    return candidates;
  }

  private catalogVideos(): Promise<CatalogVideo[]> {
    return this.database.client.video.findMany({
      where: {
        status: "PUBLISHED",
        visibility: { not: "PRIVATE" },
        removedAt: null,
        channel: { status: "ACTIVE", removedAt: null },
        mediaAssets: {
          some: {
            kind: "SOURCE_VIDEO",
            status: "VALIDATED",
            mimeType: "video/mp4",
            removedAt: null,
          },
        },
      },
      orderBy: [{ publishedAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        channelId: true,
        publishedAt: true,
        createdAt: true,
        mediaAssets: {
          where: {
            kind: "SOURCE_VIDEO",
            status: "VALIDATED",
            mimeType: "video/mp4",
            removedAt: null,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, r2ObjectKey: true, width: true, height: true, durationMs: true },
        },
      },
    });
  }

  private async objectExists(key: string): Promise<boolean> {
    try {
      const object = await this.storage.headObject(key);
      if (!Number.isSafeInteger(object.sizeBytes) || object.sizeBytes < 0) {
        throw new Error("Cannot verify storage object size.");
      }
      return object.sizeBytes > 0;
    } catch (error) {
      if (error instanceof R2HttpError && error.method === "HEAD" && error.status === 404)
        return false;
      // Permissions, timeouts, configuration failures and outages are not absence.
      // Propagate before entering the database mutation transaction.
      throw error;
    }
  }
}

function resolutionBucket(height: number | null): string {
  if (!height) return "unknown";
  if (height <= 480) return "<=480p";
  if (height <= 720) return "720p";
  if (height <= 1080) return "1080p";
  return ">1080p";
}
