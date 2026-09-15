import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { VideoPolicyService } from "../video-policy/video-policy.service.js";
import { AdminAuditLogService } from "./admin-audit-log.service.js";

export interface AdminPolicyOverrideInput {
  disposition: "FORCE_ALLOW" | "FORCE_BLOCK";
  reason: string;
  expiresAt: Date | null;
}

export interface AdminVideoClassificationInput {
  maturityLevel: "GENERAL" | "TEEN" | "MATURE";
  ageRestriction: "NONE" | "AGE_13_PLUS" | "AGE_18_PLUS";
  kidsEligible: boolean;
  reason: string;
}

@Injectable()
export class AdminVideoPolicyService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(VideoPolicyService) private readonly policy: VideoPolicyService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}

  async get(videoId: string) {
    await this.assertVideo(videoId);
    return { videoId, ...(await this.policy.readPolicy(videoId)) };
  }

  async setClassification(
    actorAccountId: string,
    videoId: string,
    input: AdminVideoClassificationInput,
  ) {
    await this.assertVideo(videoId);
    if (
      input.kidsEligible &&
      (input.maturityLevel !== "GENERAL" || input.ageRestriction !== "NONE")
    ) {
      throw new BadRequestException(
        "Kids-eligible content must be GENERAL and have no age restriction.",
      );
    }
    const previous = await this.database.client.videoPolicy.findUnique({ where: { videoId } });
    const policy = await this.database.client.$transaction(async (tx) => {
      const saved = await tx.videoPolicy.upsert({
        where: { videoId },
        create: {
          videoId,
          maturityLevel: input.maturityLevel,
          ageRestriction: input.ageRestriction,
          kidsEligible: input.kidsEligible,
        },
        update: {
          maturityLevel: input.maturityLevel,
          ageRestriction: input.ageRestriction,
          kidsEligible: input.kidsEligible,
        },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "video_policy.classification_set",
        entityType: "Video",
        entityId: videoId,
        reason: input.reason,
        metadata: {
          maturityLevel: input.maturityLevel,
          ageRestriction: input.ageRestriction,
          kidsEligible: input.kidsEligible,
          previousMaturityLevel: previous?.maturityLevel ?? null,
          previousAgeRestriction: previous?.ageRestriction ?? null,
          previousKidsEligible: previous?.kidsEligible ?? false,
        },
      });
      return saved;
    });
    return { videoId, policy };
  }

  async setOverride(actorAccountId: string, videoId: string, input: AdminPolicyOverrideInput) {
    await this.assertVideo(videoId);
    const previous = await this.database.client.videoPolicyOverride.findUnique({
      where: { videoId },
    });
    const override = await this.database.client.$transaction(async (tx) => {
      const saved = await tx.videoPolicyOverride.upsert({
        where: { videoId },
        create: { videoId, actorAccountId, ...input },
        update: { actorAccountId, ...input },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "video_policy.override_set",
        entityType: "Video",
        entityId: videoId,
        reason: input.reason,
        metadata: {
          disposition: input.disposition,
          expiresAt: input.expiresAt?.toISOString() ?? null,
          previousDisposition: previous?.disposition ?? null,
          previousExpiresAt: previous?.expiresAt?.toISOString() ?? null,
        },
      });
      return saved;
    });
    return { videoId, override };
  }

  async clearOverride(actorAccountId: string, videoId: string, reason: string) {
    await this.assertVideo(videoId);
    const previous = await this.database.client.videoPolicyOverride.findUnique({
      where: { videoId },
    });
    await this.database.client.$transaction(async (tx) => {
      await tx.videoPolicyOverride.deleteMany({ where: { videoId } });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "video_policy.override_clear",
        entityType: "Video",
        entityId: videoId,
        reason,
        metadata: {
          previousDisposition: previous?.disposition ?? null,
          previousExpiresAt: previous?.expiresAt?.toISOString() ?? null,
        },
      });
    });
    return { videoId, override: null };
  }

  private async assertVideo(videoId: string) {
    const video = await this.database.client.video.findUnique({
      where: { id: videoId },
      select: { id: true },
    });
    if (!video) throw new NotFoundException("This video could not be found.");
  }
}
