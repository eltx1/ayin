import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { FeatureFlagService } from "../platform-config/feature-flag.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
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

const ACTIVE_PROCESSING = ["PROCESSING", "UPLOADING", "VERIFYING"] as const;
const ACTIVE_OR_QUEUED = ["QUEUED", ...ACTIVE_PROCESSING] as const;
const RECOVERY_STALE_MS = 10 * 60 * 1000;
const METRICS_WINDOW_DAYS = 30;

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

  async controls() {
    const [
      generationEnabled,
      newUploadsEnabled,
      backfillEnabled,
      backfillPaused,
      batchSizeRaw,
      maxInFlightRaw,
      playbackEnabled,
    ] = await Promise.all([
      this.settings.get("mediaHlsEnabled"),
      this.settings.get("mediaHlsNewUploadsEnabled"),
      this.settings.get("mediaHlsBackfillEnabled"),
      this.settings.get("mediaHlsBackfillPaused"),
      this.settings.get("mediaHlsBackfillBatchSize"),
      this.settings.get("mediaHlsBackfillMaxInFlight"),
      this.featureFlags.isEnabled(ADAPTIVE_PLAYBACK_FEATURE_FLAG),
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

  async enqueueBatch(requestedBatchSize?: number) {
    const controls = await this.controls();
    if (!controls.generationEnabled || !controls.backfillEnabled || controls.backfillPaused) {
      return { enqueued: 0, reason: "BACKFILL_DISABLED_OR_PAUSED", jobs: [] };
    }
    const requested = Number.isFinite(requestedBatchSize)
      ? Math.max(1, Math.floor(requestedBatchSize as number))
      : controls.batchSize;
    const batchSize = Math.min(requested, controls.batchSize, ADAPTIVE_BACKFILL_HARD_BATCH_MAX);
    const inFlight = await this.database.client.mediaProcessingJob.count({
      where: {
        stagingKey: { contains: ADAPTIVE_BACKFILL_MARKER },
        status: { in: [...ACTIVE_OR_QUEUED] },
      },
    });
    const availableSlots = Math.max(0, controls.maxInFlight - inFlight);
    const take = Math.min(batchSize, availableSlots);
    if (take === 0) return { enqueued: 0, reason: "IN_FLIGHT_LIMIT", jobs: [] };

    const candidates = await this.pendingCandidates(take * 4);
    const jobs = [];
    for (const candidate of candidates) {
      if (jobs.length >= take) break;
      const job = await this.database.client.$transaction((tx) =>
        this.lifecycle.createAdaptiveBackfillJob(tx, candidate.id),
      );
      if (job) jobs.push(job);
    }
    return { enqueued: jobs.length, reason: jobs.length ? "ENQUEUED" : "NO_ELIGIBLE_VIDEO", jobs };
  }

  async setPaused(paused: boolean) {
    await this.database.client.$transaction((tx) =>
      this.settings.setInTransaction(tx, "mediaHlsBackfillPaused", paused),
    );
    return this.controls();
  }

  async recover(mode: AdaptiveRecoveryMode, requestedBatchSize?: number) {
    const controls = await this.controls();
    const batchSize = Math.min(
      Math.max(1, Math.floor(requestedBatchSize ?? controls.batchSize)),
      ADAPTIVE_BACKFILL_HARD_BATCH_MAX,
    );
    if (mode === "STALE_PROCESSING") {
      return { mode, ...(await this.queue.recoverStale()) };
    }
    if (mode === "FAILED_BACKFILL") {
      const failed = await this.database.client.mediaProcessingJob.findMany({
        where: { stagingKey: { contains: ADAPTIVE_BACKFILL_MARKER }, status: "FAILED" },
        orderBy: { updatedAt: "asc" },
        take: batchSize,
        select: { id: true },
      });
      let recovered = 0;
      for (const job of failed) {
        const changed = await this.database.client.mediaProcessingJob.updateMany({
          where: { id: job.id, status: "FAILED" },
          data: {
            status: "QUEUED",
            stage: "ADAPTIVE_BACKFILL_RETRY_QUEUED",
            progressPercent: 0,
            attempt: 0,
            queuedAt: new Date(),
            startedAt: null,
            completedAt: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
            errorCode: null,
            errorMessage: null,
          },
        });
        recovered += changed.count;
      }
      return { mode, recovered };
    }
    if (mode === "DB_MANIFEST_MISSING") {
      const rows = await this.database.client.mediaPlaybackGeneration.findMany({
        where: { status: "READY", hlsMasterStatus: "READY" },
        orderBy: { readyAt: "asc" },
        take: batchSize,
        select: { id: true, videoId: true, hlsMasterR2ObjectKey: true },
      });
      let detected = 0;
      let requeued = 0;
      for (const row of rows) {
        if (await this.objectExists(row.hlsMasterR2ObjectKey)) continue;
        detected += 1;
        await this.database.client.mediaPlaybackGeneration.updateMany({
          where: { id: row.id, status: "READY", hlsMasterStatus: "READY" },
          data: {
            status: "FAILED",
            hlsMasterStatus: "FAILED",
            failedAt: new Date(),
            readyAt: null,
          },
        });
        const job = await this.database.client.$transaction((tx) =>
          this.lifecycle.createAdaptiveBackfillJob(tx, row.videoId),
        );
        if (job) requeued += 1;
      }
      return { mode, detected, requeued };
    }
    if (mode === "INCOMPLETE_HLS") {
      const rows = await this.database.client.mediaPlaybackGeneration.findMany({
        where: {
          status: { in: ["BUILDING", "FAILED"] },
          updatedAt: { lt: new Date(Date.now() - RECOVERY_STALE_MS) },
        },
        orderBy: { updatedAt: "asc" },
        take: batchSize,
        select: { videoId: true },
      });
      let requeued = 0;
      for (const row of rows) {
        const job = await this.database.client.$transaction((tx) =>
          this.lifecycle.createAdaptiveBackfillJob(tx, row.videoId),
        );
        if (job) requeued += 1;
      }
      return { mode, detected: rows.length, requeued };
    }

    const candidates = await this.pendingCandidates(batchSize * 3);
    let detected = 0;
    let requeued = 0;
    for (const video of candidates) {
      if (detected >= batchSize) break;
      const latestJob = await this.database.client.mediaProcessingJob.findFirst({
        where: { videoId: video.id },
        orderBy: { generation: "desc" },
        select: { generation: true },
      });
      if (!latestJob) continue;
      const generationRow = await this.database.client.mediaPlaybackGeneration.findUnique({
        where: { videoId_generation: { videoId: video.id, generation: latestJob.generation } },
        select: { id: true },
      });
      if (generationRow) continue;
      const manifestKey = hlsMasterObjectKey({
        channelId: video.channelId,
        videoId: video.id,
        generation: latestJob.generation,
      });
      if (!(await this.objectExists(manifestKey))) continue;
      detected += 1;
      const job = await this.database.client.$transaction((tx) =>
        this.lifecycle.createAdaptiveBackfillJob(tx, video.id),
      );
      if (job) requeued += 1;
    }
    return { mode, detected, requeued, policy: "REPROCESS_VERIFIED_ORPHAN_IN_NEW_GENERATION" };
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
    let outputStorageBytes = 0n;
    for (const generation of readyGenerations) {
      outputStorageBytes += generation.hlsOutputSizeBytes ?? 0n;
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
      outputStorageBytes: outputStorageBytes.toString(),
      sampledReadyGenerations: readyGenerations.length,
    };
  }

  private async pendingCandidates(limit: number): Promise<CatalogVideo[]> {
    const videos = await this.catalogVideos();
    if (!videos.length) return [];
    const ready = await this.database.client.mediaPlaybackGeneration.findMany({
      where: {
        videoId: { in: videos.map((video) => video.id) },
        status: "READY",
        fallbackStatus: "READY",
        hlsMasterStatus: "READY",
        renditions: { some: { status: "READY", protocol: "HLS" } },
      },
      distinct: ["videoId"],
      select: { videoId: true },
    });
    const active = await this.database.client.mediaProcessingJob.findMany({
      where: {
        videoId: { in: videos.map((video) => video.id) },
        status: { in: [...ACTIVE_OR_QUEUED] },
      },
      distinct: ["videoId"],
      select: { videoId: true },
    });
    const blocked = new Set([
      ...ready.map((row) => row.videoId),
      ...active.map((row) => row.videoId),
    ]);
    return videos.filter((video) => !blocked.has(video.id)).slice(0, limit);
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
      return object.sizeBytes > 0;
    } catch {
      return false;
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
