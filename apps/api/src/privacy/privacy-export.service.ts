import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item));
  if (value && typeof value === "object") {
    const candidate = value as { toJSON?: () => unknown };
    if (typeof candidate.toJSON === "function") return jsonSafe(candidate.toJSON());
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

@Injectable()
export class PrivacyExportService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async build(accountId: string) {
    const account = await this.database.client.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        email: true,
        displayName: true,
        status: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
        closedAt: true,
      },
    });
    if (!account) return null;

    const profiles = await this.database.client.viewerProfile.findMany({
      where: { accountId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        isDefault: true,
        isKids: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });
    const profileIds = profiles.map(({ id }) => id);

    const memberships = await this.database.client.channelMember.findMany({
      where: { accountId },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        createdAt: true,
        channel: {
          select: {
            id: true,
            handle: true,
            name: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });
    const ownedChannelIds = memberships
      .filter(({ role }) => role === "OWNER")
      .map(({ channel }) => channel.id);

    const videos = await this.database.client.video.findMany({
      where: { channelId: { in: ownedChannelIds } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        channelId: true,
        slug: true,
        title: true,
        description: true,
        contentType: true,
        videoForm: true,
        status: true,
        visibility: true,
        commentsEnabled: true,
        durationMs: true,
        scheduledPublishAt: true,
        publishedAt: true,
        removedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const videoIds = videos.map(({ id }) => id);

    const [
      comments,
      subscriptions,
      watchProgress,
      watchHistory,
      watchLater,
      myList,
      notifications,
      communityPosts,
      communityReactions,
      communityComments,
      communityVotes,
      communityReports,
      reports,
      rightsDeclarations,
      contracts,
      earnings,
      payouts,
      payoutProfiles,
      revenueDisputes,
      mediaAssets,
      liveStreams,
      liveChatMessages,
      privacyEvents,
      deletionRequests,
    ] = await Promise.all([
      this.database.client.comment.findMany({
        where: { authorProfileId: { in: profileIds } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          videoId: true,
          parentId: true,
          body: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          removedAt: true,
        },
      }),
      this.database.client.subscription.findMany({
        where: { profileId: { in: profileIds } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          profileId: true,
          notificationLevel: true,
          createdAt: true,
          updatedAt: true,
          channel: { select: { id: true, handle: true, name: true } },
        },
      }),
      this.database.client.watchProgress.findMany({
        where: { profileId: { in: profileIds } },
        orderBy: { lastWatchedAt: "asc" },
        select: {
          id: true,
          profileId: true,
          videoId: true,
          positionMs: true,
          lastWatchedAt: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.database.client.watchHistory.findMany({
        where: { profileId: { in: profileIds } },
        orderBy: { lastWatchedAt: "asc" },
        select: {
          id: true,
          profileId: true,
          videoId: true,
          firstWatchedAt: true,
          lastWatchedAt: true,
          viewCount: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.database.client.watchLaterItem.findMany({
        where: { profileId: { in: profileIds } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          profileId: true,
          videoId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.database.client.myListItem.findMany({
        where: { profileId: { in: profileIds } },
        orderBy: { createdAt: "asc" },
        select: { id: true, profileId: true, videoId: true, createdAt: true },
      }),
      this.database.client.notification.findMany({
        where: { accountId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          data: true,
          readAt: true,
          createdAt: true,
        },
      }),
      this.database.client.communityPost.findMany({
        where: { authorAccountId: accountId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          channelId: true,
          type: true,
          status: true,
          body: true,
          sharedVideoId: true,
          scheduledPublishAt: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true,
          removedAt: true,
        },
      }),
      this.database.client.communityPostReaction.findMany({
        where: { profileId: { in: profileIds } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          postId: true,
          profileId: true,
          type: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.database.client.communityPostComment.findMany({
        where: { authorProfileId: { in: profileIds } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          postId: true,
          parentId: true,
          body: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          removedAt: true,
        },
      }),
      this.database.client.communityPollVote.findMany({
        where: { profileId: { in: profileIds } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          postId: true,
          optionId: true,
          profileId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.database.client.communityPostReport.findMany({
        where: { reporterProfileId: { in: profileIds } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          postId: true,
          reason: true,
          details: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          resolvedAt: true,
        },
      }),
      this.database.client.report.findMany({
        where: { reporterProfileId: { in: profileIds } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          channelId: true,
          videoId: true,
          commentId: true,
          reason: true,
          details: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          resolvedAt: true,
        },
      }),
      this.database.client.contentRightsDeclaration.findMany({
        where: { declaredByAccountId: accountId },
        orderBy: { declaredAt: "asc" },
        select: {
          id: true,
          videoId: true,
          version: true,
          basis: true,
          status: true,
          statement: true,
          declaredAt: true,
          revokedAt: true,
        },
      }),
      this.database.client.creatorContract.findMany({
        where: { channelId: { in: ownedChannelIds } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          channelId: true,
          status: true,
          revenueShareBps: true,
          effectiveFrom: true,
          effectiveTo: true,
          termsVersion: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.database.client.earningsLedgerEntry.findMany({
        where: { channelId: { in: ownedChannelIds } },
        orderBy: { occurredAt: "asc" },
        select: {
          id: true,
          channelId: true,
          contractId: true,
          videoId: true,
          payoutId: true,
          type: true,
          state: true,
          grossAmount: true,
          amount: true,
          currency: true,
          revenueShareBps: true,
          adSource: true,
          periodStart: true,
          periodEnd: true,
          memo: true,
          occurredAt: true,
          finalizedAt: true,
          createdAt: true,
        },
      }),
      this.database.client.payout.findMany({
        where: { channelId: { in: ownedChannelIds } },
        orderBy: { requestedAt: "asc" },
        select: {
          id: true,
          channelId: true,
          status: true,
          amount: true,
          currency: true,
          provider: true,
          requestSource: true,
          destinationMaskSnapshot: true,
          legalNameSnapshot: true,
          countryCodeSnapshot: true,
          requestedAt: true,
          processedAt: true,
          paidAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.database.client.creatorPayoutProfile.findMany({
        where: { channelId: { in: ownedChannelIds } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          channelId: true,
          legalName: true,
          preferredCurrency: true,
          provider: true,
          destinationMask: true,
          countryCode: true,
          identityStatus: true,
          taxStatus: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.database.client.revenueDispute.findMany({
        where: {
          channelId: { in: ownedChannelIds },
          createdByAccountId: accountId,
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          channelId: true,
          payoutId: true,
          category: true,
          message: true,
          status: true,
          resolution: true,
          createdAt: true,
          updatedAt: true,
          resolvedAt: true,
        },
      }),
      this.database.client.mediaAsset.findMany({
        where: {
          OR: [{ channelId: { in: ownedChannelIds } }, { videoId: { in: videoIds } }],
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          videoId: true,
          channelId: true,
          kind: true,
          status: true,
          mimeType: true,
          sizeBytes: true,
          width: true,
          height: true,
          durationMs: true,
          createdAt: true,
          updatedAt: true,
          removedAt: true,
        },
      }),
      this.database.client.liveStream.findMany({
        where: {
          OR: [{ createdByAccountId: accountId }, { channelId: { in: ownedChannelIds } }],
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          channelId: true,
          slug: true,
          title: true,
          description: true,
          status: true,
          scheduledStartAt: true,
          startedAt: true,
          endedAt: true,
          chatEnabled: true,
          adBreaksEnabled: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.database.client.liveChatMessage.findMany({
        where: { authorProfileId: { in: profileIds } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          liveStreamId: true,
          body: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          removedAt: true,
        },
      }),
      this.database.client.adminAuditLog.findMany({
        where: {
          entityType: "Account",
          entityId: accountId,
          action: { startsWith: "privacy." },
        },
        orderBy: { createdAt: "asc" },
        select: { action: true, createdAt: true },
      }),
      this.database.client.accountDeletionRequest.findMany({
        where: { accountId },
        orderBy: { createdAt: "asc" },
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
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return jsonSafe({
      exportVersion: 1,
      generatedAt: new Date(),
      account,
      profiles,
      channelMemberships: memberships,
      creator: { videos, rightsDeclarations, mediaAssets, liveStreams },
      viewing: { watchProgress, watchHistory, watchLater, myList, subscriptions },
      activity: {
        comments,
        communityPosts,
        communityReactions,
        communityComments,
        communityVotes,
        liveChatMessages,
      },
      notifications,
      moderation: { reports, communityReports },
      finance: { contracts, earnings, payouts, payoutProfiles, revenueDisputes },
      privacy: { deletionRequests, events: privacyEvents },
      exclusions: [
        "password hashes and authentication secrets",
        "session tokens and MFA secrets",
        "raw/internal media storage keys and checksums",
        "encrypted payout destinations",
        "privileged moderation case notes and staff identities",
        "general administrator audit metadata",
      ],
    });
  }
}
