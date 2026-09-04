import type { MediaProcessingJobStatus, Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";

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
    return this.database.client.$transaction(async (tx) => {
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

      const existing = await tx.mediaProcessingJob.findFirst({
        where: { videoId: asset.videoId },
        orderBy: { generation: "desc" },
      });
      if (existing) return existing;

      const generation = 1;
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
    });
  }

  async setOwnedStage(input: {
    jobId: string;
    workerId: string;
    status: "PROCESSING" | "UPLOADING" | "VERIFYING";
    stage: string;
    progressPercent?: number;
  }): Promise<boolean> {
    const changed = await this.database.client.mediaProcessingJob.updateMany({
      where: {
        id: input.jobId,
        leaseOwner: input.workerId,
        status: { in: OWNED_ACTIVE_STATUSES },
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
    return this.database.client.$transaction(async (tx) => {
      const job = await tx.mediaProcessingJob.findFirst({
        where: {
          id: input.jobId,
          leaseOwner: input.workerId,
          status: { in: OWNED_ACTIVE_STATUSES },
        },
        include: {
          video: { select: { id: true, channelId: true, status: true } },
        },
      });
      if (!job) return null;

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
      const ready = await tx.mediaProcessingJob.update({
        where: { id: job.id },
        data: {
          finalAssetId: canonicalAsset.id,
          status: "READY",
          stage: "READY",
          progressPercent: 100,
          outputSizeBytes: BigInt(input.metadata.sizeBytes),
          completedAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });
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
  }

  async getOwnedJob(jobId: string, workerId: string) {
    return this.database.client.mediaProcessingJob.findFirst({
      where: {
        id: jobId,
        leaseOwner: workerId,
        status: { in: OWNED_ACTIVE_STATUSES },
      },
    });
  }

  async createReprocessJob(tx: Prisma.TransactionClient, videoId: string) {
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
    const generation = (video.mediaProcessingJobs[0]?.generation ?? 0) + 1;
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
