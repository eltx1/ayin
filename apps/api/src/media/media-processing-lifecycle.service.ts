import type { MediaProcessingJobStatus, Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { ADAPTIVE_BACKFILL_MARKER } from "./media-adaptive-rollout.js";
import {
  hasActiveMediaJob,
  hasNewerMediaGeneration,
  lockMediaGeneration,
} from "./media-generation-safety.js";

const OWNED_ACTIVE_STATUSES: MediaProcessingJobStatus[] = ["PROCESSING", "UPLOADING", "VERIFYING"];

export interface CanonicalMediaMetadata {
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
}

@Injectable()
export class MediaProcessingLifecycleService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async enqueueUploadedAsset(assetId: string) {
    return this.database.client.$transaction((tx) =>
      this.enqueueUploadedAssetInTransaction(tx, assetId),
    );
  }

  async enqueueUploadedAssetInTransaction(tx: Prisma.TransactionClient, assetId: string) {
    const asset = await tx.mediaAsset.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        videoId: true,
        channelId: true,
        kind: true,
        status: true,
        mimeType: true,
        sizeBytes: true,
        r2ObjectKey: true,
        removedAt: true,
        video: { select: { id: true, channelId: true, status: true } },
      },
    });
    if (
      !asset ||
      !asset.videoId ||
      !asset.video ||
      asset.kind !== "SOURCE_VIDEO" ||
      asset.status !== "UPLOADED" ||
      asset.removedAt
    ) {
      return null;
    }

    await lockMediaGeneration(tx, asset.videoId);
    const existing = await tx.mediaProcessingJob.findFirst({
      where: { videoId: asset.videoId },
      orderBy: { generation: "desc" },
    });
    if (existing) return existing;

    const latestPlayback = await tx.mediaPlaybackGeneration.findFirst({
      where: { videoId: asset.videoId },
      orderBy: { generation: "desc" },
      select: { generation: true },
    });
    const generation = (latestPlayback?.generation ?? 0) + 1;
    const channelId = asset.video.channelId;
    const job = await tx.mediaProcessingJob.create({
      data: {
        videoId: asset.videoId,
        generation,
        status: "QUEUED",
        sourceMimeType: asset.mimeType,
        sourceSizeBytes: asset.sizeBytes,
        stagingKey: asset.r2ObjectKey,
        inputR2ObjectKey: asset.r2ObjectKey,
        outputR2ObjectKey: `channels/${channelId}/videos/${asset.videoId}/playback/g${generation}.mp4`,
        queuedAt: new Date(),
        stage: "QUEUED",
      },
    });
    await tx.video.updateMany({
      where: { id: asset.videoId, status: { in: ["UPLOADING", "DRAFT"] } },
      data: { status: "VALIDATING" },
    });
    return job;
  }

  async setOwnedStage(input: {
    jobId: string;
    workerId: string;
    status: "PROCESSING" | "UPLOADING" | "VERIFYING";
    stage: string;
    progressPercent?: number;
  }): Promise<boolean> {
    const now = new Date();
    const job = await this.database.client.mediaProcessingJob.findFirst({
      where: {
        id: input.jobId,
        leaseOwner: input.workerId,
        status: { in: OWNED_ACTIVE_STATUSES },
        leaseExpiresAt: { gt: now },
      },
      select: { videoId: true, generation: true },
    });
    if (!job || (await hasNewerMediaGeneration(this.database.client, job))) return false;
    const changed = await this.database.client.mediaProcessingJob.updateMany({
      where: {
        id: input.jobId,
        leaseOwner: input.workerId,
        status: { in: OWNED_ACTIVE_STATUSES },
        leaseExpiresAt: { gt: new Date() },
      },
      data: {
        status: input.status,
        stage: input.stage.slice(0, 64),
        ...(input.progressPercent === undefined
          ? {}
          : { progressPercent: Math.max(0, Math.min(99, Math.floor(input.progressPercent))) }),
      },
    });
    return changed.count === 1;
  }

  async finalizeReady(input: {
    jobId: string;
    workerId: string;
    metadata: CanonicalMediaMetadata;
  }) {
    try {
      return await this.database.client.$transaction(async (tx) => {
        const now = new Date();
        const job = await tx.mediaProcessingJob.findFirst({
          where: {
            id: input.jobId,
            leaseOwner: input.workerId,
            status: { in: OWNED_ACTIVE_STATUSES },
            leaseExpiresAt: { gt: now },
          },
          include: {
            video: { select: { id: true, channelId: true, status: true } },
          },
        });
        if (!job || (await hasNewerMediaGeneration(tx, job))) return null;

        const canonicalAsset = await tx.mediaAsset.upsert({
          where: { r2ObjectKey: job.outputR2ObjectKey },
          create: {
            videoId: job.videoId,
            channelId: job.video.channelId,
            kind: "SOURCE_VIDEO",
            status: "VALIDATED",
            r2ObjectKey: job.outputR2ObjectKey,
            mimeType: "video/mp4",
            sizeBytes: BigInt(input.metadata.sizeBytes),
            durationMs: input.metadata.durationMs,
            width: input.metadata.width,
            height: input.metadata.height,
          },
          update: {
            videoId: job.videoId,
            channelId: job.video.channelId,
            kind: "SOURCE_VIDEO",
            status: "VALIDATED",
            mimeType: "video/mp4",
            sizeBytes: BigInt(input.metadata.sizeBytes),
            durationMs: input.metadata.durationMs,
            width: input.metadata.width,
            height: input.metadata.height,
            removedAt: null,
          },
        });

        if (job.inputR2ObjectKey && job.inputR2ObjectKey !== job.outputR2ObjectKey) {
          await tx.mediaAsset.updateMany({
            where: {
              r2ObjectKey: job.inputR2ObjectKey,
              id: { not: canonicalAsset.id },
            },
            data: { status: "REMOVED", removedAt: new Date() },
          });
        }

        const completedAt = new Date();
        const readyChanged = await tx.mediaProcessingJob.updateMany({
          where: {
            id: job.id,
            leaseOwner: input.workerId,
            status: { in: OWNED_ACTIVE_STATUSES },
            leaseExpiresAt: { gt: new Date() },
          },
          data: {
            finalAssetId: canonicalAsset.id,
            status: "READY",
            stage: "READY",
            progressPercent: 100,
            outputSizeBytes: BigInt(input.metadata.sizeBytes),
            completedAt,
            leaseOwner: null,
            leaseWorkerId: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
            errorCode: null,
            errorMessage: null,
          },
        });
        if (readyChanged.count !== 1) throw new MediaProcessingLeaseLostError();
        const ready = await tx.mediaProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
        await tx.video.update({
          where: { id: job.videoId },
          data: {
            durationMs: input.metadata.durationMs,
            ...(job.video.status === "VALIDATING" ? { status: "DRAFT" as const } : {}),
          },
        });
        await tx.contentSeedItem.updateMany({
          where: { videoId: job.videoId, status: "UPLOADING" },
          data: { status: "READY", error: null },
        });
        return { job: ready, asset: canonicalAsset };
      });
    } catch (error) {
      if (error instanceof MediaProcessingLeaseLostError) return null;
      throw error;
    }
  }

  async getOwnedJob(jobId: string, workerId: string) {
    return this.database.client.mediaProcessingJob.findFirst({
      where: {
        id: jobId,
        leaseOwner: workerId,
        status: { in: OWNED_ACTIVE_STATUSES },
        leaseExpiresAt: { gt: new Date() },
      },
    });
  }

  async createAdaptiveBackfillJob(tx: Prisma.TransactionClient, videoId: string) {
    await lockMediaGeneration(tx, videoId);
    const video = await tx.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        channelId: true,
        status: true,
        visibility: true,
        removedAt: true,
        channel: { select: { status: true, removedAt: true } },
        mediaAssets: {
          where: {
            kind: "SOURCE_VIDEO",
            status: "VALIDATED",
            mimeType: "video/mp4",
            removedAt: null,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        mediaProcessingJobs: { orderBy: { generation: "desc" }, take: 1 },
      },
    });
    const source = video?.mediaAssets[0];
    if (
      !video ||
      !source ||
      video.status !== "PUBLISHED" ||
      video.visibility === "PRIVATE" ||
      video.removedAt ||
      video.channel.status !== "ACTIVE" ||
      video.channel.removedAt
    ) {
      return null;
    }

    const [readyAdaptive, activeJob, latestAdaptive] = await Promise.all([
      tx.mediaPlaybackGeneration.findFirst({
        where: {
          videoId,
          status: "READY",
          fallbackStatus: "READY",
          hlsMasterStatus: "READY",
          renditions: { some: { status: "READY", protocol: "HLS" } },
        },
        select: { id: true },
      }),
      tx.mediaProcessingJob.findFirst({
        where: {
          videoId,
          status: { in: ["INGESTING", "QUEUED", "PROCESSING", "UPLOADING", "VERIFYING"] },
        },
        select: { id: true },
      }),
      tx.mediaPlaybackGeneration.findFirst({
        where: { videoId },
        orderBy: { generation: "desc" },
        select: { generation: true },
      }),
    ]);
    if (readyAdaptive || activeJob) return null;

    const generation =
      Math.max(video.mediaProcessingJobs[0]?.generation ?? 0, latestAdaptive?.generation ?? 0) + 1;
    return tx.mediaProcessingJob.create({
      data: {
        videoId,
        generation,
        status: "QUEUED",
        sourceMimeType: source.mimeType,
        sourceSizeBytes: source.sizeBytes,
        stagingKey: `${source.r2ObjectKey}${ADAPTIVE_BACKFILL_MARKER}${generation}`,
        inputR2ObjectKey: source.r2ObjectKey,
        outputR2ObjectKey: `channels/${video.channelId}/videos/${video.id}/playback/g${generation}.mp4`,
        queuedAt: new Date(),
        stage: "ADAPTIVE_BACKFILL_QUEUED",
        priority: -10,
      },
    });
  }

  async createReprocessJob(tx: Prisma.TransactionClient, videoId: string) {
    await lockMediaGeneration(tx, videoId);
    if (await hasActiveMediaJob(tx, videoId)) return null;
    const video = await tx.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        channelId: true,
        mediaAssets: {
          where: { kind: "SOURCE_VIDEO", status: "VALIDATED", removedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        mediaProcessingJobs: { orderBy: { generation: "desc" }, take: 1 },
      },
    });
    const source = video?.mediaAssets[0];
    if (!video || !source) return null;
    const latestPlayback = await tx.mediaPlaybackGeneration.findFirst({
      where: { videoId },
      orderBy: { generation: "desc" },
      select: { generation: true },
    });
    const generation =
      Math.max(video.mediaProcessingJobs[0]?.generation ?? 0, latestPlayback?.generation ?? 0) + 1;
    return tx.mediaProcessingJob.create({
      data: {
        videoId,
        generation,
        status: "QUEUED",
        sourceMimeType: source.mimeType,
        sourceSizeBytes: source.sizeBytes,
        stagingKey: `${source.r2ObjectKey}#reprocess-g${generation}`,
        inputR2ObjectKey: source.r2ObjectKey,
        outputR2ObjectKey: `channels/${video.channelId}/videos/${video.id}/playback/g${generation}.mp4`,
        queuedAt: new Date(),
        stage: "REPROCESS_QUEUED",
      },
    });
  }
}

class MediaProcessingLeaseLostError extends Error {
  constructor() {
    super("The media processing lease was lost before finalization.");
    this.name = "MediaProcessingLeaseLostError";
  }
}
