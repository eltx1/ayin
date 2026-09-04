import { Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../auth/auth.guard.js";
import { DatabaseService } from "../database/database.service.js";
import { MediaProcessingLifecycleService } from "../media/media-processing-lifecycle.service.js";
import { MediaProcessingQueueService } from "../media/media-processing-queue.service.js";
import { AdminAuditLogService } from "./admin-audit-log.service.js";
import { adminBadRequest } from "./admin.errors.js";
import { AdminGuard, type AdminAuthenticatedRequest, RequireAdminRoles } from "./admin.guard.js";

const uuidSchema = z.string().uuid();
const terminalStatuses = new Set(["READY", "FAILED", "CANCELLED"]);

@Controller("admin/media-processing")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("OPERATIONS")
export class AdminMediaProcessingController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MediaProcessingQueueService) private readonly queue: MediaProcessingQueueService,
    @Inject(MediaProcessingLifecycleService)
    private readonly lifecycle: MediaProcessingLifecycleService,
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
    return { ...overview, jobs };
  }

  @Post("jobs/:jobId/retry")
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
      const retried = await tx.mediaProcessingJob.update({
        where: { id: job.id },
        data: {
          status: "QUEUED",
          stage: "ADMIN_RETRY_QUEUED",
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
      await this.audit.recordInTransaction(tx, {
        actorAccountId: request.ayinAuth.accountId,
        action: "media_processing.retry",
        entityType: "MediaProcessingJob",
        entityId: job.id,
        metadata: { videoId: job.videoId, generation: job.generation },
      });
      return retried;
    });
  }

  @Post("videos/:videoId/reprocess")
  async reprocess(@Req() request: AdminAuthenticatedRequest, @Param("videoId") videoIdRaw: string) {
    const videoId = this.uuid(videoIdRaw, "INVALID_VIDEO_ID");
    return this.database.client.$transaction(async (tx) => {
      const latest = await tx.mediaProcessingJob.findFirst({
        where: { videoId },
        orderBy: { generation: "desc" },
        select: { status: true },
      });
      if (latest && !terminalStatuses.has(latest.status)) {
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
      return job;
    });
  }

  private uuid(value: string, code: string): string {
    const parsed = uuidSchema.safeParse(value);
    if (!parsed.success) throw adminBadRequest(code, "This identifier is invalid.");
    return parsed.data;
  }
}
