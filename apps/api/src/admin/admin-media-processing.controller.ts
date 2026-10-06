import {
  publicMediaProcessingJob,
  publicMediaProcessingStatus,
} from "../media/media-processing-status.js";
import type { MediaProcessingJob } from "@ayin/db";
import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../auth/auth.guard.js";
import { DatabaseService } from "../database/database.service.js";
import { MediaAdaptiveRolloutService } from "../media/media-adaptive-rollout.service.js";
import { ADAPTIVE_RECOVERY_MODES, isAdaptiveBackfillJob } from "../media/media-adaptive-rollout.js";
import { MediaProcessingLifecycleService } from "../media/media-processing-lifecycle.service.js";
import { MediaProcessingQueueService } from "../media/media-processing-queue.service.js";
import {
  hasActiveMediaJob,
  hasNewerMediaGeneration,
  lockMediaGeneration,
} from "../media/media-generation-safety.js";
import { AdminAuditLogService } from "./admin-audit-log.service.js";
import { adminBadRequest } from "./admin.errors.js";
import {
  AdminGuard,
  type AdminAuthenticatedRequest,
  RequireAdminRoles,
  RequireAdminStepUp,
} from "./admin.guard.js";

const uuidSchema = z.string().uuid();
const batchSchema = z.object({ batchSize: z.number().int().min(1).max(20).optional() }).strict();
const recoverySchema = z
  .object({
    mode: z.enum(ADAPTIVE_RECOVERY_MODES),
    batchSize: z.number().int().min(1).max(20).optional(),
    cursor: uuidSchema.optional(),
  })
  .strict();

@Controller("admin/media-processing")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("OPERATIONS")
export class AdminMediaProcessingController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MediaProcessingQueueService) private readonly queue: MediaProcessingQueueService,
    @Inject(MediaProcessingLifecycleService)
    private readonly lifecycle: MediaProcessingLifecycleService,
    @Inject(MediaAdaptiveRolloutService)
    private readonly adaptiveRollout: MediaAdaptiveRolloutService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}

  @Get()
  async overview() {
    const [overview, jobs] = await Promise.all([
      this.queue.overview(),
      this.database.client.mediaProcessingJob.findMany({
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: {
          id: true,
          videoId: true,
          generation: true,
          status: true,
          stage: true,
          progressPercent: true,
          attempt: true,
          priority: true,
          leaseOwner: true,
          leaseWorkerId: true,
          leaseExpiresAt: true,
          errorCode: true,
          errorMessage: true,
          queuedAt: true,
          startedAt: true,
          completedAt: true,
          updatedAt: true,
          video: { select: { title: true, slug: true, channelId: true } },
        },
      }),
    ]);
    return { ...overview, jobs: jobs.map((job) => publicMediaProcessingJob(job)) };
  }

  @Get("adaptive-rollout")
  async adaptiveOverview() {
    return this.adaptiveRollout.overview();
  }

  @Post("adaptive-rollout/backfill/run")
  @RequireAdminStepUp()
  async runAdaptiveBackfill(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    const parsed = batchSchema.safeParse(body ?? {});
    if (!parsed.success)
      throw adminBadRequest("INVALID_BACKFILL_BATCH", "Backfill batch request is invalid.");
    const result = await this.adaptiveRollout.enqueueBatch(
      parsed.data.batchSize,
      request.ayinAuth.accountId,
    );
    return {
      ...result,
      jobs: result.jobs.map((job) => ({
        id: job.id,
        videoId: job.videoId,
        generation: job.generation,
        status: publicMediaProcessingStatus(job.status),
        stage: job.stage,
      })),
    };
  }

  @Post("adaptive-rollout/backfill/pause")
  @RequireAdminStepUp()
  @RequireAdminRoles("SUPERADMIN")
  async pauseAdaptiveBackfill(@Req() request: AdminAuthenticatedRequest) {
    return this.adaptiveRollout.setPaused(true, request.ayinAuth.accountId);
  }

  @Post("adaptive-rollout/backfill/resume")
  @RequireAdminStepUp()
  @RequireAdminRoles("SUPERADMIN")
  async resumeAdaptiveBackfill(@Req() request: AdminAuthenticatedRequest) {
    return this.adaptiveRollout.setPaused(false, request.ayinAuth.accountId);
  }

  @Post("adaptive-rollout/recovery")
  @RequireAdminStepUp()
  async recoverAdaptive(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    const parsed = recoverySchema.safeParse(body);
    if (!parsed.success)
      throw adminBadRequest("INVALID_ADAPTIVE_RECOVERY", "Adaptive recovery request is invalid.");
    return this.adaptiveRollout.recover(
      parsed.data.mode,
      parsed.data.batchSize,
      request.ayinAuth.accountId,
      parsed.data.cursor,
    );
  }

  @Post("jobs/:jobId/retry")
  @RequireAdminStepUp()
  async retryFailed(@Req() request: AdminAuthenticatedRequest, @Param("jobId") jobIdRaw: string) {
    const jobId = this.uuid(jobIdRaw, "INVALID_MEDIA_JOB_ID");
    return this.database.client.$transaction(async (tx) => {
      const job = await tx.mediaProcessingJob.findUnique({ where: { id: jobId } });
      if (!job)
        throw adminBadRequest("MEDIA_JOB_NOT_FOUND", "This media processing job was not found.");
      if (job.status !== "FAILED") {
        throw adminBadRequest(
          "MEDIA_JOB_NOT_FAILED",
          "Only a failed media processing job can be retried.",
        );
      }
      if (isAdaptiveBackfillJob(job)) {
        const blocked = await this.adaptiveRollout.failedRetryBlockReasonInTransaction(tx);
        if (blocked) {
          throw adminBadRequest(
            "ADAPTIVE_RETRY_BLOCKED",
            blocked === "IN_FLIGHT_LIMIT"
              ? "Wait for an active adaptive backfill job to finish before retrying."
              : "Adaptive backfill is disabled or paused.",
          );
        }
      }
      await lockMediaGeneration(tx, job.videoId);
      if (await hasNewerMediaGeneration(tx, job)) {
        throw adminBadRequest(
          "MEDIA_JOB_SUPERSEDED",
          "A newer processing generation exists for this video.",
        );
      }
      if (await hasActiveMediaJob(tx, job.videoId, job.id)) {
        throw adminBadRequest(
          "MEDIA_PROCESSING_ALREADY_ACTIVE",
          "This video already has an active or queued processing generation.",
        );
      }
      // Another retry/recovery may have queued or claimed this job since the read.
      // PostgreSQL rechecks this predicate after waiting for a concurrent writer.
      const changed = await tx.mediaProcessingJob.updateMany({
        where: { id: job.id, status: "FAILED", updatedAt: job.updatedAt },
        data: {
          status: "QUEUED",
          stage: "ADMIN_RETRY_QUEUED",
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
      if (changed.count !== 1) {
        throw adminBadRequest(
          "MEDIA_JOB_RETRY_CONFLICT",
          "This media processing job changed. Refresh its state before retrying.",
        );
      }
      await this.audit.recordInTransaction(tx, {
        actorAccountId: request.ayinAuth.accountId,
        action: "media_processing.retry",
        entityType: "MediaProcessingJob",
        entityId: job.id,
        metadata: { videoId: job.videoId, generation: job.generation },
      });
      return mediaJobMutationResponse(
        await tx.mediaProcessingJob.findUniqueOrThrow({ where: { id: job.id } }),
      );
    });
  }

  @Post("videos/:videoId/reprocess")
  @RequireAdminStepUp()
  async reprocess(@Req() request: AdminAuthenticatedRequest, @Param("videoId") videoIdRaw: string) {
    const videoId = this.uuid(videoIdRaw, "INVALID_VIDEO_ID");
    return this.database.client.$transaction(async (tx) => {
      await lockMediaGeneration(tx, videoId);
      if (await hasActiveMediaJob(tx, videoId)) {
        throw adminBadRequest(
          "MEDIA_PROCESSING_ALREADY_ACTIVE",
          "This video already has an active or queued processing generation.",
        );
      }
      const job = await this.lifecycle.createReprocessJob(tx, videoId);
      if (!job) {
        throw adminBadRequest(
          "REPROCESS_SOURCE_UNAVAILABLE",
          "A validated playback source is required before this video can be reprocessed.",
        );
      }
      await this.audit.recordInTransaction(tx, {
        actorAccountId: request.ayinAuth.accountId,
        action: "media_processing.reprocess",
        entityType: "Video",
        entityId: videoId,
        metadata: { jobId: job.id, generation: job.generation },
      });
      return mediaJobMutationResponse(job);
    });
  }

  private uuid(value: string, code: string): string {
    const parsed = uuidSchema.safeParse(value);
    if (!parsed.success) throw adminBadRequest(code, "This identifier is invalid.");
    return parsed.data.toLowerCase();
  }
}

// Prisma rows contain BigInt sizes and internal storage keys. Return the action
// outcome the operator needs; serialization must not fail after the commit.
function mediaJobMutationResponse(job: MediaProcessingJob) {
  const { id, videoId, generation, status, stage, queuedAt, updatedAt } = job;
  return {
    id,
    videoId,
    generation,
    status: publicMediaProcessingStatus(status),
    stage,
    queuedAt,
    updatedAt,
  };
}
