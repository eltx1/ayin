import { Prisma } from "@ayin/db";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { VideoPolicyService } from "../video-policy/video-policy.service.js";
import { AdminAuditLogService } from "./admin-audit-log.service.js";
import { lockAdminAccountWrite, type AccountWriteActor } from "./admin-account-write-authority.js";

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
    actor: AccountWriteActor,
    videoId: string,
    input: AdminVideoClassificationInput,
  ) {
    if (
      input.kidsEligible &&
      (input.maturityLevel !== "GENERAL" || input.ageRestriction !== "NONE")
    ) {
      throw new BadRequestException(
        "Kids-eligible content must be GENERAL and have no age restriction.",
      );
    }
    const policy = await this.database.client.$transaction(async (tx) => {
      await this.lockPolicyWrite(tx, actor, videoId, "CLASSIFICATION");
      const previous = await tx.videoPolicy.findUnique({ where: { videoId } });
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
        actorAccountId: actor.accountId,
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

  async setOverride(actor: AccountWriteActor, videoId: string, input: AdminPolicyOverrideInput) {
    const override = await this.database.client.$transaction(async (tx) => {
      await this.lockPolicyWrite(tx, actor, videoId, "OVERRIDE");
      const previous = await tx.videoPolicyOverride.findUnique({ where: { videoId } });
      const saved = await tx.videoPolicyOverride.upsert({
        where: { videoId },
        create: { videoId, actorAccountId: actor.accountId, ...input },
        update: { actorAccountId: actor.accountId, ...input },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId: actor.accountId,
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

  async clearOverride(actor: AccountWriteActor, videoId: string, reason: string) {
    await this.database.client.$transaction(async (tx) => {
      await this.lockPolicyWrite(tx, actor, videoId, "OVERRIDE");
      const previous = await tx.videoPolicyOverride.findUnique({ where: { videoId } });
      await tx.videoPolicyOverride.deleteMany({ where: { videoId } });
      await this.audit.recordInTransaction(tx, {
        actorAccountId: actor.accountId,
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

  private async lockPolicyWrite(
    tx: Prisma.TransactionClient,
    actor: AccountWriteActor,
    videoId: string,
    kind: "CLASSIFICATION" | "OVERRIDE",
  ) {
    // Match other admin/creator video writes: staff/MFA/account authority, then
    // Video, then policy. The Video lock also fences removal and absent-row inserts.
    await this.writeAuthority(tx, actor);
    const [video] = await tx.$queryRaw<
      Array<{ id: string; status: string; removedAt: Date | null }>
    >(
      Prisma.sql`SELECT "id", "status", "removedAt" FROM "Video" WHERE "id" = ${videoId}::uuid
        FOR NO KEY UPDATE /* ayin-admin-video-policy-target-lock */`,
    );
    // Lock existing policy state before reading it. Even a row-level wait must
    // finish before we capture audit-before state and recheck current authority.
    if (kind === "CLASSIFICATION") {
      await tx.$queryRaw(Prisma.sql`SELECT "videoId" FROM "VideoPolicy"
        WHERE "videoId" = ${videoId}::uuid FOR UPDATE /* ayin-admin-video-policy-row-lock */`);
    } else {
      await tx.$queryRaw(Prisma.sql`SELECT "videoId" FROM "VideoPolicyOverride"
        WHERE "videoId" = ${videoId}::uuid FOR UPDATE /* ayin-admin-video-policy-row-lock */`);
    }
    // Recheck session expiry and step-up freshness after every target/policy wait.
    await this.writeAuthority(tx, actor);
    if (!video) throw new NotFoundException("This video could not be found.");
    if (video.status === "REMOVED" || video.removedAt)
      throw new ConflictException("Removed video policy cannot be edited.");
  }

  private writeAuthority(tx: Prisma.TransactionClient, actor: AccountWriteActor) {
    return lockAdminAccountWrite(tx, actor, actor.accountId, undefined, [
      "OPERATIONS",
      "CONTENT_MODERATOR",
    ]);
  }

  private async assertVideo(videoId: string) {
    const video = await this.database.client.video.findUnique({
      where: { id: videoId },
      select: { id: true },
    });
    if (!video) throw new NotFoundException("This video could not be found.");
  }
}
