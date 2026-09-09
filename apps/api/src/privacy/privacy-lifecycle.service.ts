import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import {
  badRequest,
  conflict,
  isUniqueConstraintError,
  unauthorized,
} from "../auth/auth.errors.js";
import { PasswordService } from "../auth/password.service.js";
import { DatabaseService } from "../database/database.service.js";
import { MEDIA_STORAGE_ADAPTER, type MediaStorageAdapter } from "../media/media-storage.adapter.js";

export const ACCOUNT_DELETION_CONFIRMATION = "DELETE MY AYIN ACCOUNT";
export const ACCOUNT_DELETION_GRACE_DAYS = 14;
export const ACCOUNT_DEACTIVATED_RECOVERY_HOURS = 24;

const GRACE_MS = ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1_000;
const RECOVERY_MS = ACCOUNT_DEACTIVATED_RECOVERY_HOURS * 60 * 60 * 1_000;
const LEASE_MS = 5 * 60 * 1_000;
const MAX_MEDIA_ATTEMPTS = 5;

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
    return {
      policy: {
        gracePeriodDays: ACCOUNT_DELETION_GRACE_DAYS,
        deactivatedRecoveryHours: ACCOUNT_DEACTIVATED_RECOVERY_HOURS,
        finalDatabaseState: "ANONYMIZED" as const,
      },
      request: request ? publicRequest(request) : null,
    };
  }

  async requestDeletion(
    accountId: string,
    sessionId: string,
    input: { password: string; confirmation: string },
  ) {
    if (input.confirmation !== ACCOUNT_DELETION_CONFIRMATION) {
      throw badRequest(
        "DELETION_CONFIRMATION_REQUIRED",
        `Type ${ACCOUNT_DELETION_CONFIRMATION} exactly to confirm account deletion.`,
      );
    }
    const account = await this.database.client.account.findUnique({
      where: { id: accountId },
      select: { passwordHash: true, status: true },
    });
    if (
      !account ||
      account.status !== "ACTIVE" ||
      !account.passwordHash ||
      !(await this.passwords.verify(input.password, account.passwordHash))
    ) {
      throw unauthorized("The current password is incorrect.");
    }

    try {
      const request = await this.database.client.$transaction(async (tx) => {
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

  async cancelDeletion(accountId: string) {
    const request = await this.database.client.accountDeletionRequest.findFirst({
      where: { accountId, state: { in: ["REQUESTED", "GRACE_PERIOD"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, state: true },
    });
    if (!request) {
      throw conflict(
        "ACCOUNT_DELETION_NOT_CANCELLABLE",
        "There is no deletion request that can be cancelled by this account.",
      );
    }
    const now = new Date();
    await this.database.client.$transaction(async (tx) => {
      const changed = await tx.accountDeletionRequest.updateMany({
        where: {
          id: request.id,
          accountId,
          state: { in: ["REQUESTED", "GRACE_PERIOD"] },
        },
        data: {
          state: "CANCELLED",
          cancelledAt: now,
          lifecycleLeaseOwner: null,
          lifecycleLeaseUntil: null,
        },
      });
      if (changed.count !== 1) {
        throw conflict(
          "ACCOUNT_DELETION_CHANGED",
          "The deletion request changed before cancellation.",
        );
      }
      await this.audit.recordInTransaction(tx, {
        actorAccountId: accountId,
        action: "privacy.deletion_cancelled",
        entityType: "Account",
        entityId: accountId,
        metadata: { requestId: request.id, previousState: request.state },
      });
    });
    return { cancelled: true };
  }

  async adminRecover(actorAccountId: string, targetAccountId: string, reason: string) {
    const request = await this.database.client.accountDeletionRequest.findFirst({
      where: {
        accountId: targetAccountId,
        state: { in: ["REQUESTED", "GRACE_PERIOD", "DEACTIVATED"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, state: true },
    });
    if (!request) {
      throw conflict(
        "ACCOUNT_DELETION_NOT_RECOVERABLE",
        "No recoverable deletion request exists. Anonymization is intentionally irreversible.",
      );
    }
    const now = new Date();
    await this.database.client.$transaction(async (tx) => {
      const changed = await tx.accountDeletionRequest.updateMany({
        where: {
          id: request.id,
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
        metadata: { requestId: request.id, previousState: request.state },
      });
    });
    return { recovered: true, previousState: request.state };
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
    let processed = 0;
    for (let index = 0; index < limit; index += 1) {
      const job = await this.claimMediaJob(now);
      if (!job) break;
      try {
        if (!this.storage.available) {
          throw new Error("Media storage is not configured on this worker.");
        }
        if (job.kind === "PREFIX") await this.storage.deletePrefix(job.target);
        else await this.storage.deleteObject(job.target);
        await this.database.client.privacyMediaDeletionJob.update({
          where: { id: job.id },
          data: { status: "DONE", completedAt: new Date(), lastError: null },
        });
        await this.finalizeMediaCleanup(job.requestId);
      } catch (error) {
        await this.retryMediaJob(job, now, error);
      }
      processed += 1;
    }
    return processed;
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
      await this.startGrace(request, now);
      return;
    }
    if (request.state === "GRACE_PERIOD") {
      await this.deactivate(request, now);
      return;
    }
    await this.anonymize(request.id, request.accountId, now);
  }

  private async startGrace(request: LifecycleClaim, now: Date) {
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
    const [assets, processingJobs, playbackGenerations] = await Promise.all([
      tx.mediaAsset.findMany({
        where: {
          OR: [
            { channelId: { in: channelIds } },
            { videoId: { in: videoIds } },
            { id: { in: postImageIds } },
          ],
        },
        select: { id: true, r2ObjectKey: true },
      }),
      tx.mediaProcessingJob.findMany({
        where: { videoId: { in: videoIds } },
        select: {
          stagingKey: true,
          inputR2ObjectKey: true,
          outputR2ObjectKey: true,
        },
      }),
      tx.mediaPlaybackGeneration.findMany({
        where: { videoId: { in: videoIds } },
        select: {
          id: true,
          fallbackR2ObjectKey: true,
          hlsMasterR2ObjectKey: true,
          renditions: {
            select: { playlistR2ObjectKey: true, segmentR2Prefix: true },
          },
        },
      }),
    ]);

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
    const jobs = [
      ...[...objectTargets].map((target) => ({
        requestId,
        accountId,
        kind: "OBJECT" as const,
        target,
      })),
      ...[...prefixTargets].map((target) => ({
        requestId,
        accountId,
        kind: "PREFIX" as const,
        target,
      })),
    ];
    if (jobs.length > 0) {
      await tx.privacyMediaDeletionJob.createMany({ data: jobs, skipDuplicates: true });
    }

    await tx.mediaAsset.updateMany({
      where: { id: { in: assets.map(({ id }) => id) } },
      data: { status: "REMOVED", removedAt: now },
    });
    await tx.mediaProcessingJob.updateMany({
      where: { videoId: { in: videoIds } },
      data: { status: "CANCELLED", leaseOwner: null, leaseExpiresAt: null },
    });
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
    return jobs.length;
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

  private async claimMediaJob(now: Date) {
    const staleClaim = new Date(now.getTime() - LEASE_MS);
    const candidate = await this.database.client.privacyMediaDeletionJob.findFirst({
      where: {
        OR: [
          { status: "PENDING", availableAt: { lte: now } },
          { status: "PROCESSING", claimedAt: { lte: staleClaim } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        requestId: true,
        kind: true,
        target: true,
        attempts: true,
      },
    });
    if (!candidate) return null;
    const claimed = await this.database.client.privacyMediaDeletionJob.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { status: "PENDING", availableAt: { lte: now } },
          { status: "PROCESSING", claimedAt: { lte: staleClaim } },
        ],
      },
      data: {
        status: "PROCESSING",
        claimedAt: now,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return null;
    return { ...candidate, attempts: candidate.attempts + 1 };
  }

  private async retryMediaJob(
    job: {
      id: string;
      requestId: string;
      attempts: number;
    },
    now: Date,
    error: unknown,
  ) {
    const message = (error instanceof Error ? error.message : "Unknown media deletion error").slice(
      0,
      1_000,
    );
    if (job.attempts >= MAX_MEDIA_ATTEMPTS) {
      await this.database.client.$transaction(async (tx) => {
        await tx.privacyMediaDeletionJob.update({
          where: { id: job.id },
          data: { status: "FAILED", lastError: message },
        });
        await tx.accountDeletionRequest.update({
          where: { id: job.requestId },
          data: { lastError: "One or more media objects require operator retry." },
        });
      });
      return;
    }
    const backoffMs = Math.min(60_000, 2 ** job.attempts * 1_000);
    await this.database.client.privacyMediaDeletionJob.update({
      where: { id: job.id },
      data: {
        status: "PENDING",
        availableAt: new Date(now.getTime() + backoffMs),
        lastError: message,
      },
    });
  }

  private async finalizeMediaCleanup(requestId: string) {
    const remaining = await this.database.client.privacyMediaDeletionJob.count({
      where: { requestId, status: { not: "DONE" } },
    });
    if (remaining === 0) {
      await this.database.client.accountDeletionRequest.update({
        where: { id: requestId },
        data: { mediaCleanupCompletedAt: new Date(), lastError: null },
      });
    }
  }
}
