import { redactCancelledInputIntegrityInTransaction } from "../media/media-processing-integrity.js";
import { freezeOutputAttempts } from "../media/media-output-write-journal.js";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import {
  badRequest,
  conflict,
  isUniqueConstraintError,
  unauthorized,
} from "../auth/auth.errors.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { PasswordService } from "../auth/password.service.js";
import { DatabaseService } from "../database/database.service.js";
import { MEDIA_STORAGE_ADAPTER, type MediaStorageAdapter } from "../media/media-storage.adapter.js";

import {
  cleanupOperationKey,
  registerUploadCleanupInTransaction,
} from "../media/media-upload-cleanup.js";
import { processPrivacyMediaDeletionBatch } from "./privacy-media-cleanup.js";

export const ACCOUNT_DELETION_CONFIRMATION = "DELETE MY AYIN ACCOUNT";
export const ACCOUNT_DELETION_GRACE_DAYS = 14;
export const ACCOUNT_DEACTIVATED_RECOVERY_HOURS = 24;

const GRACE_MS = ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1_000;
const RECOVERY_MS = ACCOUNT_DEACTIVATED_RECOVERY_HOURS * 60 * 60 * 1_000;
const LEASE_MS = 5 * 60 * 1_000;

type ActiveDeletionState = "REQUESTED" | "GRACE_PERIOD" | "DEACTIVATED";

interface LifecycleClaim {
  id: string;
  accountId: string;
  state: ActiveDeletionState;
  requestedAt: Date;
}

interface PublicDeletionRequest {
  id: string;
  state: string;
  requestedAt: Date;
  graceEndsAt: Date | null;
  deactivatedAt: Date | null;
  anonymizedAt: Date | null;
  cancelledAt: Date | null;
  mediaCleanupQueuedAt: Date | null;
  mediaCleanupCompletedAt: Date | null;
}

function publicRequest(request: PublicDeletionRequest) {
  return {
    id: request.id,
    state: request.state,
    requestedAt: request.requestedAt,
    graceEndsAt: request.graceEndsAt,
    deactivatedAt: request.deactivatedAt,
    anonymizedAt: request.anonymizedAt,
    cancelledAt: request.cancelledAt,
    mediaCleanupQueuedAt: request.mediaCleanupQueuedAt,
    mediaCleanupCompletedAt: request.mediaCleanupCompletedAt,
  };
}

@Injectable()
export class PrivacyLifecycleService {
  private readonly workerId = `${hostname()}:${process.pid}:privacy:${randomUUID()}`;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
    @Inject(MEDIA_STORAGE_ADAPTER) private readonly storage: MediaStorageAdapter,
  ) {}

  async status(accountId: string) {
    const request = await this.database.client.accountDeletionRequest.findFirst({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        state: true,
        requestedAt: true,
        graceEndsAt: true,
        deactivatedAt: true,
        anonymizedAt: true,
        cancelledAt: true,
        mediaCleanupQueuedAt: true,
        mediaCleanupCompletedAt: true,
      },
    });
    const cleanupCounts = request
      ? await this.database.client.privacyMediaDeletionJob.groupBy({
          by: ["status"],
          where: { requestId: request.id },
          _count: true,
        })
      : [];
    return {
      mediaCleanup: request
        ? {
            pending: cleanupCounts.find((item) => item.status === "PENDING")?._count ?? 0,
            processing: cleanupCounts.find((item) => item.status === "PROCESSING")?._count ?? 0,
            requiresReview: cleanupCounts.find((item) => item.status === "FAILED")?._count ?? 0,
            completed: cleanupCounts.find((item) => item.status === "DONE")?._count ?? 0,
          }
        : null,
      policy: {
        gracePeriodDays: ACCOUNT_DELETION_GRACE_DAYS,
        deactivatedRecoveryHours: ACCOUNT_DEACTIVATED_RECOVERY_HOURS,
        finalDatabaseState: "ANONYMIZED" as const,
      },
      request: request ? publicRequest(request) : null,
    };
  }

  async requestDeletion(
    auth: AuthenticatedRequest["ayinAuth"],
    input: { password: string; confirmation: string },
  ) {
    const { accountId, sessionId } = auth;
    if (input.confirmation !== ACCOUNT_DELETION_CONFIRMATION) {
      throw badRequest(
        "DELETION_CONFIRMATION_REQUIRED",
        `Type ${ACCOUNT_DELETION_CONFIRMATION} exactly to confirm account deletion.`,
      );
    }
    const account = await this.database.client.account.findUnique({
      where: { id: accountId },
      select: { passwordHash: true, status: true, authVersion: true },
    });
    if (
      !account ||
      account.status !== "ACTIVE" ||
      !account.passwordHash ||
      account.authVersion !== auth.authVersion ||
      !(await this.passwords.verify(input.password, account.passwordHash))
    ) {
      throw unauthorized("The current password is incorrect.");
    }

    try {
      const request = await this.database.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${accountId}::uuid FOR UPDATE /* ayin-deletion-account-lock */`;
        await tx.$queryRaw`SELECT id FROM "AccountSession" WHERE id=${sessionId}::uuid FOR SHARE /* ayin-deletion-session-lock */`;
        const current = await tx.account.findUnique({
          where: { id: accountId },
          select: { passwordHash: true, status: true, authVersion: true },
        });
        const session = await tx.accountSession.findUnique({
          where: { id: sessionId },
          select: { accountId: true, authVersion: true, revokedAt: true, expiresAt: true },
        });
        if (
          !current ||
          current.status !== "ACTIVE" ||
          current.authVersion !== auth.authVersion ||
          !session ||
          session.accountId !== accountId ||
          session.authVersion !== auth.authVersion ||
          session.revokedAt !== null ||
          session.expiresAt.getTime() <= Date.now()
        )
          throw unauthorized("The current session is no longer active.");
        if (current.passwordHash !== account.passwordHash)
          throw conflict(
            "PASSWORD_CHANGED",
            "The password changed while this request was pending. Review your current credentials before another operation.",
          );
        const created = await tx.accountDeletionRequest.create({
          data: { accountId, requestedFromSessionId: sessionId },
          select: {
            id: true,
            state: true,
            requestedAt: true,
            graceEndsAt: true,
            deactivatedAt: true,
            anonymizedAt: true,
            cancelledAt: true,
            mediaCleanupQueuedAt: true,
            mediaCleanupCompletedAt: true,
          },
        });
        await this.audit.recordInTransaction(tx, {
          actorAccountId: accountId,
          action: "privacy.deletion_requested",
          entityType: "Account",
          entityId: accountId,
          metadata: { requestId: created.id },
        });
        return created;
      });
      return publicRequest(request);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw conflict(
          "ACCOUNT_DELETION_ALREADY_ACTIVE",
          "An account deletion request is already active.",
        );
      }
      throw error;
    }
  }

  async cancelDeletion(auth: AuthenticatedRequest["ayinAuth"]) {
    const { accountId, sessionId } = auth;
    await this.database.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${accountId}::uuid FOR UPDATE /* ayin-deletion-cancel-account-lock */`;
      await tx.$queryRaw`SELECT id FROM "AccountSession" WHERE id=${sessionId}::uuid FOR SHARE /* ayin-deletion-cancel-session-lock */`;
      const account = await tx.account.findUnique({
        where: { id: accountId },
        select: { status: true, authVersion: true },
      });
      const session = await tx.accountSession.findUnique({
        where: { id: sessionId },
        select: { accountId: true, authVersion: true, revokedAt: true, expiresAt: true },
      });
      if (
        !account ||
        account.status !== "ACTIVE" ||
        account.authVersion !== auth.authVersion ||
        !session ||
        session.accountId !== accountId ||
        session.authVersion !== auth.authVersion ||
        session.revokedAt !== null ||
        session.expiresAt.getTime() <= Date.now()
      )
        throw unauthorized("The current session is no longer active.");
      const candidate = await tx.accountDeletionRequest.findFirst({
        where: { accountId, state: { in: ["REQUESTED", "GRACE_PERIOD"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (!candidate)
        throw conflict(
          "ACCOUNT_DELETION_NOT_CANCELLABLE",
          "There is no deletion request that can be cancelled by this account.",
        );
      await tx.$queryRaw`SELECT id FROM "AccountDeletionRequest" WHERE id=${candidate.id}::uuid FOR UPDATE /* ayin-deletion-cancel-request-lock */`;
      const request = await tx.accountDeletionRequest.findUnique({
        where: { id: candidate.id },
        select: { accountId: true, state: true },
      });
      if (
        !request ||
        request.accountId !== accountId ||
        (request.state !== "REQUESTED" && request.state !== "GRACE_PERIOD")
      )
        throw conflict(
          "ACCOUNT_DELETION_CHANGED",
          "The deletion request changed before cancellation.",
        );
      // The request lock may wait behind grace transition; expiry is checked again after that wait.
      if (session.expiresAt.getTime() <= Date.now())
        throw unauthorized("The current session is no longer active.");
      await tx.accountDeletionRequest.update({
        where: { id: candidate.id },
        data: {
          state: "CANCELLED",
          cancelledAt: new Date(),
          lifecycleLeaseOwner: null,
          lifecycleLeaseUntil: null,
        },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId: accountId,
        action: "privacy.deletion_cancelled",
        entityType: "Account",
        entityId: accountId,
        metadata: { requestId: candidate.id, previousState: request.state },
      });
    });
    return { cancelled: true };
  }

  async adminRecover(actorAccountId: string, targetAccountId: string, reason: string) {
    const previousState = await this.database.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${targetAccountId}::uuid FOR UPDATE /* ayin-deletion-recovery-account-lock */`;
      const candidate = await tx.accountDeletionRequest.findFirst({
        where: {
          accountId: targetAccountId,
          state: { in: ["REQUESTED", "GRACE_PERIOD", "DEACTIVATED"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (!candidate)
        throw conflict(
          "ACCOUNT_DELETION_NOT_RECOVERABLE",
          "No recoverable deletion request exists. Anonymization is intentionally irreversible.",
        );
      await tx.$queryRaw`SELECT id FROM "AccountDeletionRequest" WHERE id=${candidate.id}::uuid FOR UPDATE /* ayin-deletion-recovery-request-lock */`;
      const request = await tx.accountDeletionRequest.findUnique({
        where: { id: candidate.id },
        select: { accountId: true, state: true },
      });
      if (
        !request ||
        request.accountId !== targetAccountId ||
        !["REQUESTED", "GRACE_PERIOD", "DEACTIVATED"].includes(request.state)
      )
        throw conflict("ACCOUNT_DELETION_CHANGED", "The deletion request changed before recovery.");
      const now = new Date();
      const changed = await tx.accountDeletionRequest.updateMany({
        where: {
          id: candidate.id,
          accountId: targetAccountId,
          state: { in: ["REQUESTED", "GRACE_PERIOD", "DEACTIVATED"] },
        },
        data: {
          state: "CANCELLED",
          cancelledAt: now,
          lifecycleLeaseOwner: null,
          lifecycleLeaseUntil: null,
        },
      });
      if (changed.count !== 1) {
        throw conflict("ACCOUNT_DELETION_CHANGED", "The deletion request changed before recovery.");
      }
      if (request.state === "DEACTIVATED") {
        await tx.account.update({
          where: { id: targetAccountId },
          data: { status: "ACTIVE", closedAt: null },
        });
      }
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "privacy.deletion_admin_recovered",
        entityType: "Account",
        entityId: targetAccountId,
        reason,
        metadata: { requestId: candidate.id, previousState: request.state },
      });
      return request.state;
    });
    return { recovered: true, previousState };
  }

  async advanceDue(now = new Date(), limit = 10): Promise<number> {
    let advanced = 0;
    for (let index = 0; index < limit; index += 1) {
      const request = await this.claimLifecycle(now);
      if (!request) break;
      await this.advanceClaimed(request, now);
      advanced += 1;
    }
    return advanced;
  }

  async processMediaDeletionBatch(now = new Date(), limit = 20): Promise<number> {
    return processPrivacyMediaDeletionBatch(this.database.client, this.storage, now, limit);
  }

  private async claimLifecycle(now: Date): Promise<LifecycleClaim | null> {
    const recoveryCutoff = new Date(now.getTime() - RECOVERY_MS);
    const candidate = await this.database.client.accountDeletionRequest.findFirst({
      where: {
        AND: [
          {
            OR: [{ lifecycleLeaseUntil: null }, { lifecycleLeaseUntil: { lte: now } }],
          },
          {
            OR: [
              { state: "REQUESTED" },
              { state: "GRACE_PERIOD", graceEndsAt: { lte: now } },
              { state: "DEACTIVATED", deactivatedAt: { lte: recoveryCutoff } },
            ],
          },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, accountId: true, state: true, requestedAt: true },
    });
    if (!candidate) return null;
    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    const claimed = await this.database.client.accountDeletionRequest.updateMany({
      where: {
        id: candidate.id,
        state: candidate.state,
        OR: [{ lifecycleLeaseUntil: null }, { lifecycleLeaseUntil: { lte: now } }],
      },
      data: { lifecycleLeaseOwner: this.workerId, lifecycleLeaseUntil: leaseUntil },
    });
    if (claimed.count !== 1) return null;
    return { ...candidate, state: candidate.state as ActiveDeletionState };
  }

  private async advanceClaimed(request: LifecycleClaim, now: Date) {
    if (request.state === "REQUESTED") {
      await this.startGrace(request);
      return;
    }
    if (request.state === "GRACE_PERIOD") {
      await this.deactivate(request, now);
      return;
    }
    await this.anonymize(request.id, request.accountId, now);
  }

  private async startGrace(request: LifecycleClaim) {
    const graceEndsAt = new Date(request.requestedAt.getTime() + GRACE_MS);
    await this.database.client.$transaction(async (tx) => {
      const changed = await tx.accountDeletionRequest.updateMany({
        where: {
          id: request.id,
          state: "REQUESTED",
          lifecycleLeaseOwner: this.workerId,
        },
        data: {
          state: "GRACE_PERIOD",
          graceEndsAt,
          lifecycleLeaseOwner: null,
          lifecycleLeaseUntil: null,
        },
      });
      if (changed.count !== 1) return;
      await tx.adminAuditLog.create({
        data: {
          action: "privacy.deletion_grace_started",
          entityType: "Account",
          entityId: request.accountId,
          metadata: { requestId: request.id, graceEndsAt: graceEndsAt.toISOString() },
        },
      });
    });
  }

  private async deactivate(request: LifecycleClaim, now: Date) {
    await this.database.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${request.accountId}::uuid FOR UPDATE /* ayin-deletion-deactivate-account-lock */`;
      const changed = await tx.accountDeletionRequest.updateMany({
        where: {
          id: request.id,
          state: "GRACE_PERIOD",
          lifecycleLeaseOwner: this.workerId,
        },
        data: {
          state: "DEACTIVATED",
          deactivatedAt: now,
          lifecycleLeaseOwner: null,
          lifecycleLeaseUntil: null,
        },
      });
      if (changed.count !== 1) return;
      await tx.account.update({
        where: { id: request.accountId },
        data: { status: "CLOSED", closedAt: now, authVersion: { increment: 1 } },
      });
      await tx.accountSession.updateMany({
        where: { accountId: request.accountId, revokedAt: null },
        data: { revokedAt: now, revokeReason: "ACCOUNT_DELETION" },
      });
      await tx.adminAuditLog.create({
        data: {
          action: "privacy.account_deactivated",
          entityType: "Account",
          entityId: request.accountId,
          metadata: { requestId: request.id },
        },
      });
    });
  }

  private async anonymize(requestId: string, accountId: string, now: Date) {
    await this.database.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${accountId}::uuid FOR UPDATE /* ayin-deletion-anonymize-account-lock */`;
      const changed = await tx.accountDeletionRequest.updateMany({
        where: {
          id: requestId,
          accountId,
          state: "DEACTIVATED",
          lifecycleLeaseOwner: this.workerId,
        },
        data: {
          state: "ANONYMIZED",
          anonymizedAt: now,
          lifecycleLeaseOwner: null,
          lifecycleLeaseUntil: null,
        },
      });
      if (changed.count !== 1) return;

      const profiles = await tx.viewerProfile.findMany({
        where: { accountId },
        select: { id: true },
      });
      const profileIds = profiles.map(({ id }) => id);
      const exclusiveChannelIds = await this.exclusiveOwnedChannelIds(tx, accountId);
      const videos = await tx.video.findMany({
        where: { channelId: { in: exclusiveChannelIds } },
        select: { id: true },
      });
      const videoIds = videos.map(({ id }) => id);
      const authoredPosts = await tx.communityPost.findMany({
        where: { authorAccountId: accountId },
        select: { id: true, imageAssetId: true },
      });
      const postIds = authoredPosts.map(({ id }) => id);
      const postImageIds = authoredPosts
        .map(({ imageAssetId }) => imageAssetId)
        .filter((value): value is string => Boolean(value));

      const mediaJobs = await this.queueCreatorMediaCleanup(
        tx,
        requestId,
        accountId,
        exclusiveChannelIds,
        videoIds,
        postImageIds,
        now,
      );

      await this.removeExclusiveCreatorSurfaces(tx, exclusiveChannelIds, videos, now);
      await this.redactAuthoredActivity(tx, accountId, profileIds, postIds, now);
      await this.deleteDisposableAccountData(tx, accountId, profileIds);

      for (const profile of profiles) {
        await tx.viewerProfile.update({
          where: { id: profile.id },
          data: {
            name: "Deleted profile",
            slug: `deleted-${profile.id}`,
            deletedAt: now,
          },
        });
      }
      await tx.creatorPayoutProfile.updateMany({
        where: { channelId: { in: exclusiveChannelIds } },
        data: {
          legalName: "Deleted account",
          destinationEncrypted: null,
          destinationMask: null,
          countryCode: null,
        },
      });
      await tx.accountSession.updateMany({
        where: { accountId },
        data: { deviceLabel: "Removed session" },
      });
      await tx.accountSession.updateMany({
        where: { accountId, revokedAt: null },
        data: { revokedAt: now, revokeReason: "ACCOUNT_ANONYMIZED" },
      });
      await tx.account.update({
        where: { id: accountId },
        data: {
          email: `deleted+${accountId}@deleted.ayin.invalid`,
          displayName: "Deleted AYIN user",
          passwordHash: null,
          emailVerifiedAt: null,
          status: "CLOSED",
          closedAt: now,
          authVersion: { increment: 1 },
        },
      });
      await tx.accountDeletionRequest.update({
        where: { id: requestId },
        data: {
          mediaCleanupQueuedAt: now,
          ...(mediaJobs === 0 ? { mediaCleanupCompletedAt: now } : {}),
        },
      });
      await tx.adminAuditLog.create({
        data: {
          action: "privacy.account_anonymized",
          entityType: "Account",
          entityId: accountId,
          metadata: {
            requestId,
            mediaDeletionJobs: mediaJobs,
            exclusiveCreatorChannels: exclusiveChannelIds.length,
          },
        },
      });
    });
  }

  private async exclusiveOwnedChannelIds(tx: Prisma.TransactionClient, accountId: string) {
    const ownerships = await tx.channelMember.findMany({
      where: { accountId, role: "OWNER" },
      select: { channelId: true },
    });
    const candidateIds = ownerships.map(({ channelId }) => channelId);
    if (candidateIds.length === 0) return [];
    const sharedOwnerships = await tx.channelMember.findMany({
      where: {
        channelId: { in: candidateIds },
        role: "OWNER",
        accountId: { not: accountId },
      },
      select: { channelId: true },
    });
    const shared = new Set(sharedOwnerships.map(({ channelId }) => channelId));
    return candidateIds.filter((channelId) => !shared.has(channelId));
  }

  private async queueCreatorMediaCleanup(
    tx: Prisma.TransactionClient,
    requestId: string,
    accountId: string,
    channelIds: string[],
    videoIds: string[],
    postImageIds: string[],
    now: Date,
  ): Promise<number> {
    const [assets, processingJobs, playbackGenerations, outputAttempts] = await Promise.all([
      tx.mediaAsset.findMany({
        where: {
          OR: [
            { channelId: { in: channelIds } },
            { videoId: { in: videoIds } },
            { id: { in: postImageIds } },
          ],
        },
        select: { id: true, videoId: true, r2ObjectKey: true },
      }),
      tx.mediaProcessingJob.findMany({
        where: { videoId: { in: videoIds } },
        select: {
          id: true,
          videoId: true,
          generation: true,
          inputIntegrityVersion: true,
          outputProtocolVersion: true,
          video: { select: { channelId: true } },
          stagingKey: true,
          inputR2ObjectKey: true,
          outputR2ObjectKey: true,
        },
      }),
      tx.mediaPlaybackGeneration.findMany({
        where: { videoId: { in: videoIds } },
        select: {
          id: true,
          videoId: true,
          generation: true,
          fallbackR2ObjectKey: true,
          hlsMasterR2ObjectKey: true,
          renditions: {
            select: { playlistR2ObjectKey: true, segmentR2Prefix: true },
          },
        },
      }),
      // No FK dependency: losing attempts remain discoverable after job/video
      // deletion through their immutable channel/video custody snapshots.
      tx.mediaProcessingOutputAttempt.findMany({
        where: { OR: [{ channelId: { in: channelIds } }, { videoId: { in: videoIds } }] },
        orderBy: [{ processingJobId: "asc" }, { attempt: "asc" }],
      }),
    ]);

    const uploadSessions = await tx.mediaUploadSession.findMany({
      where: {
        OR: [
          { channelId: { in: channelIds } },
          { videoId: { in: videoIds } },
          { sourceAssetId: { in: assets.map((asset) => asset.id) } },
          { initiatingAccountId: accountId, state: { not: "COMPLETED" } },
        ],
      },
      orderBy: { id: "asc" },
    });
    const cleanupAssetIds = [
      ...new Set([
        ...assets.map((asset) => asset.id),
        ...uploadSessions.flatMap((session) =>
          session.sourceAssetId ? [session.sourceAssetId] : [],
        ),
      ]),
    ].sort();
    // Lock the exact union before revoking sessions or mutating any source.
    if (cleanupAssetIds.length > 0)
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "MediaAsset"
        WHERE "id" IN (${Prisma.join(cleanupAssetIds.map((id) => Prisma.sql`${id}::uuid`))})
        ORDER BY "id" FOR NO KEY UPDATE /* ayin-privacy-media-asset-lock */`,
      );
    for (const session of uploadSessions)
      await registerUploadCleanupInTransaction(tx, {
        sessionId: session.id,
        accountId,
        requestId,
        state: "REVOKED",
        now,
      });

    // The account-first privacy fence excludes fresh claims/dispatches. Cancel
    // the jobs before freezing their exact immutable write sets, including
    // orphan attempts whose original job has already been detached.
    await tx.mediaProcessingJob.updateMany({
      where: { videoId: { in: videoIds } },
      data: { status: "CANCELLED", leaseOwner: null, leaseExpiresAt: null },
    });
    await freezeOutputAttempts(
      tx,
      [...new Set(outputAttempts.map((attempt) => attempt.processingJobId))].sort(),
      now,
    );

    // Preserve orphaned cleanup snapshots too: removing a source/session FK is
    // not provider cleanup, and previous expiry/processing work remains owed.
    await tx.privacyMediaDeletionJob.updateMany({
      where: {
        scope: { not: "PRIVACY" },
        OR: [
          { channelId: { in: channelIds } },
          // An initiating admin owns an OPEN grant, not another owner's accepted
          // media. Post-READY source obligations remain channel-owned.
          { scope: "UPLOAD_SESSION", accountId },
        ],
      },
      data: { requestId },
    });

    const objectTargets = new Set<string>();
    const prefixTargets = new Set<string>();
    for (const asset of assets) objectTargets.add(asset.r2ObjectKey);
    for (const job of processingJobs) {
      objectTargets.add(job.stagingKey);
      objectTargets.add(job.outputR2ObjectKey);
      if (job.inputR2ObjectKey) objectTargets.add(job.inputR2ObjectKey);
    }
    for (const generation of playbackGenerations) {
      objectTargets.add(generation.fallbackR2ObjectKey);
      objectTargets.add(generation.hlsMasterR2ObjectKey);
      for (const rendition of generation.renditions) {
        objectTargets.add(rendition.playlistR2ObjectKey);
        prefixTargets.add(rendition.segmentR2Prefix);
      }
    }
    for (const attempt of outputAttempts) {
      if (attempt.protocolVersion === 2) continue;
      objectTargets.add(attempt.canonicalR2ObjectKey);
      objectTargets.add(attempt.thumbnailR2ObjectKey);
      objectTargets.add(`${attempt.hlsR2Prefix}master.m3u8`);
      prefixTargets.add(attempt.prefix);
    }
    // V2 addresses are owned by their obligation-aware jobs. Do not create an
    // older DELETE-only lane for those same source/attempt addresses.
    for (const target of objectTargets) {
      if (
        uploadSessions.some(
          (session) => session.sourceProtocolVersion === 2 && session.objectKey === target,
        ) ||
        outputAttempts.some(
          (attempt) => attempt.protocolVersion === 2 && target.startsWith(attempt.prefix),
        )
      )
        objectTargets.delete(target);
    }
    for (const target of prefixTargets) {
      if (
        outputAttempts.some(
          (attempt) => attempt.protocolVersion === 2 && target.startsWith(attempt.prefix),
        )
      )
        prefixTargets.delete(target);
    }
    const jobs = [
      ...[...objectTargets].map((target) => ({
        requestId,
        accountId,
        kind: "OBJECT" as const,
        operationKey: cleanupOperationKey(`privacy:${requestId}`, "object", target),
        target,
      })),
      ...[...prefixTargets].map((target) => ({
        requestId,
        accountId,
        kind: "PREFIX" as const,
        operationKey: cleanupOperationKey(`privacy:${requestId}`, "prefix", target),
        target,
      })),
    ];
    if (jobs.length > 0) {
      await tx.privacyMediaDeletionJob.createMany({ data: jobs, skipDuplicates: true });
    }
    const outputJobIds = new Set([
      ...processingJobs
        .filter((job) => job.inputIntegrityVersion !== 0 && job.outputProtocolVersion !== 2)
        .map((job) => job.id),
      ...outputAttempts
        .filter((attempt) => attempt.protocolVersion !== 2)
        .map((attempt) => attempt.processingJobId),
    ]);
    const outputBarriers = [...outputJobIds].map((jobId) => {
      const job = processingJobs.find((job) => job.id === jobId);
      const attempts = outputAttempts.filter((attempt) => attempt.processingJobId === jobId);
      const snapshot = attempts[0];
      const videoId = job?.videoId ?? snapshot!.videoId;
      const generationNumber = job?.generation ?? snapshot!.generation;
      const generations = playbackGenerations.filter(
        (generation) =>
          generation.videoId === videoId && generation.generation === generationNumber,
      );
      return {
        operationKey: `processing-outputs:${jobId}`,
        requestId,
        accountId,
        scope: "PRIVACY" as const,
        kind: "OUTPUT_SETTLEMENT" as const,
        processingJobId: jobId,
        target: job?.outputR2ObjectKey ?? snapshot!.canonicalR2ObjectKey,
        outputAddresses: {
          version: 2,
          videoId,
          generation: generationNumber,
          // Snapshot every winning/losing reserved namespace, not only current
          // generation metadata. This is coverage, never write-settlement proof.
          attempts: attempts.map((attempt) => ({
            id: attempt.id,
            attempt: attempt.attempt,
            prefix: attempt.prefix,
          })),
          objects: [
            ...new Set([
              ...(job
                ? [
                    job.outputR2ObjectKey,
                    ...assets
                      .filter(
                        (asset) =>
                          asset.videoId === videoId &&
                          asset.r2ObjectKey !== job.stagingKey &&
                          asset.r2ObjectKey !== job.inputR2ObjectKey,
                      )
                      .map((asset) => asset.r2ObjectKey),
                  ]
                : []),
              ...attempts.flatMap((attempt) => [
                attempt.canonicalR2ObjectKey,
                attempt.thumbnailR2ObjectKey,
                `${attempt.hlsR2Prefix}master.m3u8`,
              ]),
              ...generations.flatMap((generation) => [
                generation.fallbackR2ObjectKey,
                generation.hlsMasterR2ObjectKey,
                ...generation.renditions.map((rendition) => rendition.playlistR2ObjectKey),
              ]),
            ]),
          ].sort(),
          prefixes: [
            ...new Set([
              ...attempts.flatMap((attempt) => [attempt.prefix, attempt.hlsR2Prefix]),
              ...generations.flatMap((generation) =>
                generation.renditions.map((rendition) => rendition.segmentR2Prefix),
              ),
            ]),
          ].sort(),
        },
      };
    });
    if (outputBarriers.length)
      await tx.privacyMediaDeletionJob.createMany({ data: outputBarriers, skipDuplicates: true });

    await tx.mediaAsset.updateMany({
      where: { id: { in: cleanupAssetIds } },
      data: { status: "REMOVED", removedAt: now },
    });
    await redactCancelledInputIntegrityInTransaction(tx, videoIds, now);
    await tx.mediaPlaybackGeneration.updateMany({
      where: { id: { in: playbackGenerations.map(({ id }) => id) } },
      data: { fallbackStatus: "REMOVED", hlsMasterStatus: "REMOVED" },
    });
    await tx.mediaPlaybackRendition.updateMany({
      where: {
        playbackGenerationId: {
          in: playbackGenerations.map(({ id }) => id),
        },
      },
      data: { status: "REMOVED" },
    });
    return tx.privacyMediaDeletionJob.count({
      where: { requestId, status: { not: "DONE" } },
    });
  }

  private async removeExclusiveCreatorSurfaces(
    tx: Prisma.TransactionClient,
    channelIds: string[],
    videos: Array<{ id: string }>,
    now: Date,
  ) {
    for (const video of videos) {
      await tx.video.update({
        where: { id: video.id },
        data: {
          slug: `deleted-${video.id}`,
          title: "Deleted video",
          description: null,
          status: "REMOVED",
          visibility: "PRIVATE",
          commentsEnabled: false,
          removedAt: now,
        },
      });
    }
    const playlists = await tx.playlist.findMany({
      where: { channelId: { in: channelIds } },
      select: { id: true },
    });
    for (const playlist of playlists) {
      await tx.playlist.update({
        where: { id: playlist.id },
        data: {
          slug: `deleted-${playlist.id}`,
          name: "Deleted playlist",
          description: null,
          visibility: "PRIVATE",
          isPublic: false,
          deletedAt: now,
        },
      });
    }
    const tvChannels = await tx.creatorTvChannel.findMany({
      where: { channelId: { in: channelIds } },
      select: { id: true },
    });
    for (const tvChannel of tvChannels) {
      await tx.creatorTvChannel.update({
        where: { id: tvChannel.id },
        data: {
          slug: `deleted-${tvChannel.id}`,
          name: "Deleted TV channel",
          status: "DISABLED",
          disabledAt: now,
        },
      });
    }
    for (const channelId of channelIds) {
      await tx.channel.update({
        where: { id: channelId },
        data: {
          handle: `deleted-${channelId}`,
          name: "Deleted channel",
          description: null,
          status: "REMOVED",
          removedAt: now,
        },
      });
    }
  }

  private async redactAuthoredActivity(
    tx: Prisma.TransactionClient,
    accountId: string,
    profileIds: string[],
    postIds: string[],
    now: Date,
  ) {
    await tx.communityPost.updateMany({
      where: { authorAccountId: accountId },
      data: {
        body: null,
        status: "REMOVED",
        imageAssetId: null,
        sharedVideoId: null,
        removedAt: now,
      },
    });
    await tx.communityPollOption.updateMany({
      where: { postId: { in: postIds } },
      data: { label: "[deleted]" },
    });
    await tx.comment.updateMany({
      where: { authorProfileId: { in: profileIds } },
      data: { body: "[deleted]", status: "REMOVED", removedAt: now },
    });
    await tx.communityPostComment.updateMany({
      where: { authorProfileId: { in: profileIds } },
      data: { body: "[deleted]", status: "REMOVED", removedAt: now },
    });
    await tx.liveChatMessage.updateMany({
      where: { authorProfileId: { in: profileIds } },
      data: { body: "[deleted]", status: "REMOVED", removedAt: now },
    });
  }

  private async deleteDisposableAccountData(
    tx: Prisma.TransactionClient,
    accountId: string,
    profileIds: string[],
  ) {
    await tx.watchProgress.deleteMany({ where: { profileId: { in: profileIds } } });
    await tx.watchHistory.deleteMany({ where: { profileId: { in: profileIds } } });
    await tx.watchLaterItem.deleteMany({ where: { profileId: { in: profileIds } } });
    await tx.myListItem.deleteMany({ where: { profileId: { in: profileIds } } });
    await tx.subscription.deleteMany({ where: { profileId: { in: profileIds } } });
    await tx.reaction.deleteMany({ where: { profileId: { in: profileIds } } });
    await tx.communityPostReaction.deleteMany({
      where: { profileId: { in: profileIds } },
    });
    await tx.communityPollVote.deleteMany({ where: { profileId: { in: profileIds } } });
    await tx.recommendationFeedback.deleteMany({
      where: { profileId: { in: profileIds } },
    });
    await tx.recommendationProfileState.deleteMany({
      where: { profileId: { in: profileIds } },
    });
    await tx.notification.deleteMany({ where: { accountId } });
    await tx.accountMfaCredential.deleteMany({ where: { accountId } });
    await tx.adminRoleAssignment.deleteMany({ where: { accountId } });
    await tx.channelMember.deleteMany({ where: { accountId } });
    await tx.adEvent.updateMany({
      where: { profileId: { in: profileIds } },
      data: { profileId: null },
    });
  }
}
