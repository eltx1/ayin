import { freezeOutputAttempts } from "./media-output-write-journal.js";
import type { MediaClaimIdentity } from "./media-output-attempt.js";
import type { MediaProcessingJobStatus, Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { UPLOAD_FILE_IDENTITY_ALGORITHM, type UploadFileIdentity } from "@ayin/types";
import { assertJobInputIntegrity } from "./media-processing-integrity.js";
import { lockOwnedMediaJob } from "./media-processing-integrity-fence.js";
import { registerProcessingSourceCleanup } from "./media-upload-cleanup.js";

import { DatabaseService } from "../database/database.service.js";
import { ADAPTIVE_BACKFILL_MARKER } from "./media-adaptive-rollout.js";
import { hasActiveMediaJob, lockMediaGeneration } from "./media-generation-safety.js";

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
        uploadIntegrityRequired: true,
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
    if (existing) {
      if (
        asset.uploadIntegrityRequired &&
        (existing.inputIntegrityVersion !== 1 ||
          existing.inputIntegritySourceAssetId !== asset.id ||
          existing.inputR2ObjectKey !== asset.r2ObjectKey)
      )
        throw new Error("The required source cannot reuse a different processing identity.");
      return existing;
    }

    const session = await tx.mediaUploadSession.findUnique({ where: { sourceAssetId: asset.id } });
    if (asset.uploadIntegrityRequired && !session)
      throw new Error("The required upload integrity session is missing or detached.");
    if (
      session &&
      (session.state !== "COMPLETED" ||
        session.videoId !== asset.videoId ||
        session.channelId !== asset.video.channelId ||
        session.objectKey !== asset.r2ObjectKey ||
        session.sizeBytes !== asset.sizeBytes ||
        session.mimeType !== asset.mimeType ||
        !session.initiatingAccountId ||
        session.contentIdentityAlgorithm !== UPLOAD_FILE_IDENTITY_ALGORITHM ||
        !session.contentIdentityDigest)
    ) {
      throw new Error(
        "The source session has no valid immutable processing integrity declaration.",
      );
    }
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
        status: session ? "INTEGRITY_QUEUED" : "QUEUED",
        sourceMimeType: asset.mimeType,
        sourceSizeBytes: asset.sizeBytes,
        ...(session
          ? {
              inputIntegrityVersion: 1,
              outputProtocolVersion: session.sourceProtocolVersion,
              inputIntegritySessionId: session.id,
              inputIntegritySourceAssetId: asset.id,
              inputIntegrityAccountId: session.initiatingAccountId!,
              inputIntegrityAlgorithm: session.contentIdentityAlgorithm,
              inputIntegrityDigest: session.contentIdentityDigest!,
            }
          : {}),
        stagingKey: asset.r2ObjectKey,
        inputR2ObjectKey: asset.r2ObjectKey,
        outputR2ObjectKey: `channels/${channelId}/videos/${asset.videoId}/playback/g${generation}.mp4`,
        queuedAt: new Date(),
        stage: session ? "INTEGRITY_QUEUED" : "QUEUED",
      },
    });
    await tx.video.updateMany({
      where: { id: asset.videoId, status: { in: ["UPLOADING", "DRAFT"] } },
      data: { status: "VALIDATING" },
    });
    return job;
  }

  async setOwnedStage(
    input: MediaClaimIdentity & {
      jobId: string;
      workerId: string;
      status: "PROCESSING" | "UPLOADING" | "VERIFYING";
      stage: string;
      progressPercent?: number;
    },
  ): Promise<boolean> {
    return this.database.client.$transaction(async (tx) => {
      const job = await lockOwnedMediaJob(tx, input.jobId, input.workerId, input);
      if (!job) return false;
      const changed = await tx.mediaProcessingJob.updateMany({
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
    });
  }

  async recordInputVerification(
    input: MediaClaimIdentity & {
      jobId: string;
      workerId: string;
      identity: UploadFileIdentity;
    },
  ): Promise<boolean> {
    return this.database.client.$transaction(async (tx) => {
      const job = await lockOwnedMediaJob(tx, input.jobId, input.workerId, input);
      if (!job) return false;
      const expected = assertJobInputIntegrity(job);
      if (
        !expected ||
        input.identity.version !== expected.version ||
        input.identity.algorithm !== expected.algorithm ||
        input.identity.sizeBytes !== expected.sizeBytes ||
        input.identity.rootSha256 !== expected.rootSha256
      )
        return false;
      const updated = await tx.mediaProcessingJob.updateMany({
        where: { id: job.id, leaseOwner: input.workerId, leaseExpiresAt: { gt: new Date() } },
        data: {
          inputVerifiedAt: new Date(),
          inputVerifiedLeaseOwner: input.workerId,
          inputVerifiedAttempt: job.attempt,
          outputIntegrityDigest: null,
          outputIntegritySizeBytes: null,
          outputVerifiedAt: null,
        },
      });
      return updated.count === 1;
    });
  }

  async recordCanonicalVerification(
    input: MediaClaimIdentity & {
      jobId: string;
      workerId: string;
      identity: UploadFileIdentity;
    },
  ): Promise<boolean> {
    return this.database.client.$transaction(async (tx) => {
      const job = await lockOwnedMediaJob(tx, input.jobId, input.workerId, {
        ...input,
        requireInput: true,
      });
      if (
        !job ||
        !assertJobInputIntegrity(job) ||
        input.identity.version !== 1 ||
        input.identity.algorithm !== UPLOAD_FILE_IDENTITY_ALGORITHM ||
        !/^[0-9a-f]{64}$/.test(input.identity.rootSha256) ||
        !Number.isSafeInteger(input.identity.sizeBytes) ||
        input.identity.sizeBytes < 1
      )
        return false;
      const updated = await tx.mediaProcessingJob.updateMany({
        where: { id: job.id, leaseOwner: input.workerId, leaseExpiresAt: { gt: new Date() } },
        data: {
          outputIntegrityDigest: input.identity.rootSha256,
          outputIntegritySizeBytes: BigInt(input.identity.sizeBytes),
          outputVerifiedAt: new Date(),
        },
      });
      return updated.count === 1;
    });
  }

  async finalizeReady(
    input: MediaClaimIdentity & {
      jobId: string;
      workerId: string;
      metadata: CanonicalMediaMetadata;
    },
  ) {
    try {
      return await this.database.client.$transaction(async (tx) => {
        const job = await lockOwnedMediaJob(tx, input.jobId, input.workerId, {
          ...input,
          requireInput: true,
          requireOutput: true,
        });
        if (
          !job ||
          (job.inputIntegrityVersion === 1 &&
            job.outputIntegritySizeBytes !== BigInt(input.metadata.sizeBytes))
        )
          return null;

        const canonicalAsset = await tx.mediaAsset.upsert({
          where: { r2ObjectKey: job.outputR2ObjectKey },
          create: {
            videoId: job.videoId,
            channelId: job.video.channelId,
            kind: "SOURCE_VIDEO",
            ...(job.inputIntegrityVersion === 1 ? { uploadIntegrityRequired: true } : {}),
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
            ...(job.inputIntegrityVersion === 1 ? { uploadIntegrityRequired: true } : {}),
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
        if (job.inputIntegrityVersion === 1) {
          // No further object writes belong to an accepted winning attempt.
          // Keep it live; only retired losing namespaces enter cleanup here.
          await freezeOutputAttempts(tx, [job.id], completedAt, [job.currentOutputAttemptId!]);
          if (job.inputIntegrityParentJobId)
            await freezeOutputAttempts(tx, [job.inputIntegrityParentJobId], completedAt);
        }
        const ready = await tx.mediaProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
        if (
          job.inputIntegrityVersion === 1 &&
          job.inputR2ObjectKey === job.stagingKey &&
          job.inputR2ObjectKey !== job.outputR2ObjectKey
        ) {
          await registerProcessingSourceCleanup(tx, {
            jobId: job.id,
            accountId: job.inputIntegrityAccountId!,
            sessionId: job.inputIntegritySessionId!,
            sourceAssetId: job.inputIntegritySourceAssetId!,
            stagingKey: job.inputR2ObjectKey!,
            now: completedAt,
          });
        }
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
          status: {
            in: ["INGESTING", "QUEUED", "INTEGRITY_QUEUED", "PROCESSING", "UPLOADING", "VERIFYING"],
          },
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
    const integrity = await this.transformedInputIntegrity(tx, source);
    return tx.mediaProcessingJob.create({
      data: {
        ...integrity,
        videoId,
        generation,
        status: integrity.inputIntegrityVersion ? "INTEGRITY_QUEUED" : "QUEUED",
        sourceMimeType: source.mimeType,
        sourceSizeBytes: source.sizeBytes,
        stagingKey: `${source.r2ObjectKey}${ADAPTIVE_BACKFILL_MARKER}${generation}`,
        inputR2ObjectKey: source.r2ObjectKey,
        outputR2ObjectKey: `channels/${video.channelId}/videos/${video.id}/playback/g${generation}.mp4`,
        queuedAt: new Date(),
        stage: integrity.inputIntegrityVersion ? "INTEGRITY_QUEUED" : "ADAPTIVE_BACKFILL_QUEUED",
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
    const integrity = await this.transformedInputIntegrity(tx, source);
    return tx.mediaProcessingJob.create({
      data: {
        ...integrity,
        videoId,
        generation,
        status: integrity.inputIntegrityVersion ? "INTEGRITY_QUEUED" : "QUEUED",
        sourceMimeType: source.mimeType,
        sourceSizeBytes: source.sizeBytes,
        stagingKey: `${source.r2ObjectKey}#reprocess-g${generation}`,
        inputR2ObjectKey: source.r2ObjectKey,
        outputR2ObjectKey: `channels/${video.channelId}/videos/${video.id}/playback/g${generation}.mp4`,
        queuedAt: new Date(),
        stage: integrity.inputIntegrityVersion ? "INTEGRITY_QUEUED" : "REPROCESS_QUEUED",
      },
    });
  }
  private async transformedInputIntegrity(
    tx: Prisma.TransactionClient,
    source: {
      id: string;
      videoId: string | null;
      r2ObjectKey: string;
      sizeBytes: bigint;
      uploadIntegrityRequired: boolean;
    },
  ) {
    const producer = await tx.mediaProcessingJob.findFirst({
      where: { videoId: source.videoId!, outputR2ObjectKey: source.r2ObjectKey },
    });
    if (!producer || producer.inputIntegrityVersion === 0) {
      // A durable video may never fall back to a different, unproven legacy asset.
      if (
        source.uploadIntegrityRequired ||
        (await tx.mediaProcessingJob.findFirst({
          where: { videoId: source.videoId!, inputIntegrityVersion: { not: 0 } },
          select: { id: true },
        }))
      )
        throw new Error("Trusted canonical input lineage is unavailable.");
      return {};
    }
    assertJobInputIntegrity(producer);
    if (
      producer.status !== "READY" ||
      producer.finalAssetId !== source.id ||
      !producer.outputVerifiedAt ||
      !producer.outputIntegrityDigest ||
      producer.outputIntegritySizeBytes !== source.sizeBytes
    )
      throw new Error("Trusted canonical input lineage is unavailable.");
    return {
      inputIntegrityVersion: 1,
      outputProtocolVersion: producer.outputProtocolVersion,
      inputIntegritySessionId: producer.inputIntegritySessionId,
      inputIntegrityAccountId: producer.inputIntegrityAccountId,
      inputIntegritySourceAssetId: source.id,
      inputIntegrityParentJobId: producer.id,
      inputIntegrityAlgorithm: UPLOAD_FILE_IDENTITY_ALGORITHM,
      inputIntegrityDigest: producer.outputIntegrityDigest,
    };
  }
}

class MediaProcessingLeaseLostError extends Error {
  constructor() {
    super("The media processing lease was lost before finalization.");
    this.name = "MediaProcessingLeaseLostError";
  }
}
