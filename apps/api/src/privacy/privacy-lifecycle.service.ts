import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import { badRequest, conflict, unauthorized } from "../auth/auth.errors.js";
import { PasswordService } from "../auth/password.service.js";
import { DatabaseService } from "../database/database.service.js";
import {
  MEDIA_STORAGE_ADAPTER,
  type MediaStorageAdapter,
} from "../media/media-storage.adapter.js";

export const ACCOUNT_DELETION_CONFIRMATION = "DELETE MY AYIN ACCOUNT";
export const ACCOUNT_DELETION_GRACE_DAYS = 14;
export const ACCOUNT_DEACTIVATED_RECOVERY_HOURS = 24;

const GRACE_MS = ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1_000;
const RECOVERY_MS = ACCOUNT_DEACTIVATED_RECOVERY_HOURS * 60 * 60 * 1_000;
const LEASE_MS = 5 * 60 * 1_000;
const MAX_MEDIA_ATTEMPTS = 5;

type ActiveDeletionState = "REQUESTED" | "GRACE_PERIOD" | "DEACTIVATED";

function publicRequest(request: {
  id: string;
  state: string;
  requestedAt: Date;
  graceEndsAt: Date | null;
  deactivatedAt: Date | null;
  anonymizedAt: Date | null;
  cancelledAt: Date | null;
  mediaCleanupQueuedAt: Date | null;
  mediaCleanupCompletedAt: Date | null;
}) {
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
    const existing = await this.database.client.accountDeletionRequest.findFirst({
      where: { accountId, state: { in: ["REQUESTED", "GRACE_PERIOD", "DEACTIVATED"] } },
      select: { id: true },
    });
    if (existing) {
      throw conflict(
        "ACCOUNT_DELETION_ALREADY_ACTIVE",
        "An account deletion request is already active.",
      );
    }

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
        where: { id: request.id, accountId, state: { in: ["REQUESTED", "GRACE_PERIOD"] } },
        data: {
          state: "CANCELLED",
          cancelledAt: now,
          lifecycleLeaseOwner: null,
          lifecycleLeaseUntil: null,
        },
      });
      if (changed.count !== 1) {
        throw conflict("ACCOUNT_DELETION_CHANGED", "The deletion request changed before cancellation.");
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
        if (!this.storage.available) throw new Error("Media storage is not configured on this worker.");
        if (job.kind === "PREFIX") await this.storage.deletePrefix(job.target);
        else await this.storage.deleteObject(job.target);
        await this.database.client.privacyMediaDeletionJob.update({
          where: { id: job.id },
          data: { status: "DONE", completedAt: new Date(), lastError: null },
        });
        await this.finalizeMediaCleanup(job.requestId);
      } catch (error) {
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
        } else {
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
      }
      processed += 1;
    }
    return processed;
  }

  private async claimLifecycle(now: Date) {
    const recoveryCutoff = new Date(now.getTime() - RECOVERY_MS);
    const candidate = await this.database.client.accountDeletionRequest.findFirst({
      where: {
        AND: [
          {
            OR: [
              { lifecycleLeaseUntil: null },
              { lifecycleLeaseUntil: { lte: now } },
            ],
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
    return claimed.count === 1 ? candidate : null;
  }

  private async advanceClaimed(
    request: { id: string; accountId: string; state: ActiveDeletionState; requestedAt: Date },
    now: Date,
  ) {
    if (request.state === "REQUESTED") {
      const graceEndsAt = new Date(request.requestedAt.getTime() + GRACE_MS);
      await this.database.client.$transaction(async (tx) => {
        const changed = await tx.accountDeletionRequest.updateMany({
          where: { id: request.id, state: "REQUESTED", lifecycleLeaseOwner: this.workerId },
          data: {
            state: "GRACE_PERIOD",
            graceEndsAt,
            lifecycleLeaseOwner: null,
            lifecycleLeaseUntil: null,
          },
        });
        if (changed.count === 1) {
          await tx.adminAuditLog.create({
            data: {
              action: "privacy.deletion_grace_started",
              entityType: "Account",
              entityId: request.accountId,
              metadata: { requestId: request.id, graceEndsAt: graceEndsAt.toISOString() },
            },
          });
        }
      });
      return;
    }

    if (request.state === "GRACE_PERIOD") {
      await this.database.client.$transaction(async (tx) => {
        const changed = await tx.accountDeletionRequest.updateMany({
          where: { id: request.id, state: "GRACE_PERIOD", lifecycleLeaseOwner: this.workerId },
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
      return;
    }

    await this.anonymize(request.id, request.accountId, now);
  }

  private async anonymize(requestId: string, accountId: string, now: Date) {
    await this.database.client.$transaction(async (tx) => {
      const changed = await tx.accountDeletionRequest.updateMany({
        where: { id: requestId, accountId, state: "DEACTIVATED", lifecycleLeaseOwner: this.workerId },
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
      const memberships = await tx.channelMember.findMany({
        where: { accountId, role: "OWNER" },
        select: { channelId: true },
      });
      const channelIds = memberships.map(({ channelId }) => channelId);
      const videos = await tx.video.findMany({
        where: { channelId: { in: channelIds } },
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
          select: { stagingKey: true, inputR2ObjectKey: true, outputR2ObjectKey: true },
        }),
        tx.mediaPlaybackGeneration.findMany({
          where: { videoId: { in: videoIds } },
          select: {
            id: true,
            fallbackR2ObjectKey: true,
            hlsMasterR2ObjectKey: true,
            renditions: { select: { playlistR2ObjectKey: true, segmentR2Prefix: true } },
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
      const mediaJobs = [
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
      if (mediaJobs.length > 0) {
        await tx.privacyMediaDeletionJob.createMany({ data: mediaJobs, skipDuplicates: true });
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
        where: { playbackGenerationId: { in: playbackGenerations.map(({ id }) => id) } },
        data: { status: "REMOVED" },
      });

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

      const liveStreams = await tx.liveStream.findMany({
        where: { OR: [{ createdByAccountId: accountId }, { channelId: { in: channelIds } }] },
        select: { id: true },
      });
      for (const stream of liveStreams) {
        await tx.liveStream.update({
          where: { id: stream.id },
          data: {
            slug: `deleted-${stream.id}`,
            title: "Deleted live stream",
            description: null,
            status: "CANCELLED",
            providerStreamId: null,
            streamKeyHash: null,
            ingestEndpoint: null,
            playbackUrl: null,
            chatEnabled: false,
          },
        });
      }

      await Promise.all([
        tx.watchProgress.deleteMany({ where: { profileId: { in: profileIds } } }),
        tx.watchHistory.deleteMany({ where: { profileId: { in: profileIds } } }),
        tx.watchLaterItem.deleteMany({ where: { profileId: { in: profileIds } } }),
        tx.myListItem.deleteMany({ where: { profileId: { in: profileIds } } }),
        tx.subscription.deleteMany({ where: { profileId: { in: profileIds } } }),
        tx.reaction.deleteMany({ where: { profileId: { in: profileIds } } }),
        tx.communityPostReaction.deleteMany({ where: { profileId: { in: profileIds } } }),
        tx.communityPollVote.deleteMany({ where: { profileId: { in: profileIds } } }),
        tx.recommendationFeedback.deleteMany({ where: { profileId: { in: profileIds } } }),
        tx.recommendationProfileState.deleteMany({ where: { profileId: { in: profileIds } } }),
        tx.notification.deleteMany({ where: { accountId } }),
        tx.accountMfaCredential.deleteMany({ where: { accountId } }),
        tx.adminRoleAssignment.deleteMany({ where: { accountId } }),
        tx.channelMember.deleteMany({ where: { accountId, role: { not: "OWNER" } } }),
        tx.adEvent.updateMany({ where: { profileId: { in: profileIds } }, data: { profileId: null } }),
      ]);

      for (const profile of profiles) {
        await tx.viewerProfile.update({
          where: { id: profile.id },
          data: { name: "Deleted profile", slug: `deleted-${profile.id}`, deletedAt: now },
        });
      }
      await tx.creatorPayoutProfile.updateMany({
        where: { channelId: { in: channelIds } },
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
          ...(mediaJobs.length === 0 ? { mediaCleanupCompletedAt: now } : {}),
        },
      });
      await tx.adminAuditLog.create({
        data: {
          action: "privacy.account_anonymized",
          entityType: "Account",
          entityId: accountId,
          metadata: { requestId, mediaDeletionJobs: mediaJobs.length },
        },
      });
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
      select: { id: true, requestId: true, kind: true, target: true, attempts: true, status: true },
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
      data: { status: "PROCESSING", claimedAt: now, attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) return null;
    return { ...candidate, attempts: candidate.attempts + 1 };
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
