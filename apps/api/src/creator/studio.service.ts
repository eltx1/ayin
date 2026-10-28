import { Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { unauthorized } from "../auth/auth.errors.js";
import {
  assertChannelMediaOwners,
  lockChannelMediaAccounts,
  observeChannelMediaOwners,
} from "../media/media-privacy-account-fence.js";
import { lockMediaGeneration } from "../media/media-generation-safety.js";
import { freezeOutputAttempts } from "../media/media-output-write-journal.js";
import { registerRemovedVideoUploadCleanup } from "../media/media-upload-cleanup.js";

import { decodeStudioContentCursor, encodeStudioContentCursor } from "./studio-content-cursor.js";
import { DatabaseService } from "../database/database.service.js";

export class StudioError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "StudioError";
  }
}

export interface StudioVideoPatch {
  title?: string | undefined;
  description?: string | null | undefined;
  visibility?: "PUBLIC" | "UNLISTED" | "PRIVATE" | undefined;
  commentsEnabled?: boolean | undefined;
  tvIncluded?: boolean | undefined;
}

interface StudioContentQuery {
  query?: string | undefined;
  status?: string | undefined;
  visibility?: string | undefined;
  take?: number | undefined;
  cursor?: string | undefined;
}

@Injectable()
export class StudioService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async overview(accountId: string) {
    const channel = await this.channelForAccount(accountId);
    const [videos, publishedVideos, subscribers, comments, playlists, recentUploads, contract] =
      await Promise.all([
        this.database.client.video.count({
          where: { channelId: channel.id, status: { not: "REMOVED" } },
        }),
        this.database.client.video.count({
          where: { channelId: channel.id, status: "PUBLISHED" },
        }),
        this.database.client.subscription.count({ where: { channelId: channel.id } }),
        this.database.client.comment.count({
          where: { video: { channelId: channel.id }, status: "PUBLISHED" },
        }),
        this.database.client.playlist.count({
          where: { channelId: channel.id, deletedAt: null },
        }),
        this.database.client.video.findMany({
          where: { channelId: channel.id, status: { not: "REMOVED" } },
          orderBy: { createdAt: "desc" },
          take: 6,
          select: {
            id: true,
            title: true,
            status: true,
            visibility: true,
            videoForm: true,
            commentsEnabled: true,
            createdAt: true,
            publishedAt: true,
          },
        }),
        this.database.client.creatorContract.findFirst({
          where: { channelId: channel.id },
          orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
          select: { status: true, revenueShareBps: true, effectiveFrom: true },
        }),
      ]);

    return {
      channel,
      counters: { videos, publishedVideos, subscribers, comments, playlists },
      analytics: {
        views: null,
        watchTimeMs: null,
        available: false,
        reason:
          "Detailed viewing analytics become available after the analytics pipeline is enabled.",
      },
      recentUploads,
      monetization: {
        contractStatus: contract?.status ?? "PENDING",
        revenueShareBps: contract?.revenueShareBps ?? null,
        effectiveFrom: contract?.effectiveFrom ?? null,
        estimatedRevenue: null,
        available: false,
        reason: "Revenue reporting is not available until revenue attribution is enabled.",
      },
    };
  }

  async content(accountId: string, input: StudioContentQuery) {
    const channel = await this.channelForAccount(accountId);
    const take = Math.min(Math.max(input.take ?? 50, 1), 100);
    const query = input.query?.trim() ?? "";
    const page = {
      take,
      query,
      status: input.status ?? "",
      visibility: input.visibility ?? "",
      cursor: input.cursor ?? null,
    };
    const scope = { accountId, channelId: channel.id, ...page };
    let boundary: { updatedAt: Date; id: string } | null = null;
    if (input.cursor) {
      try {
        boundary = decodeStudioContentCursor(input.cursor, scope);
      } catch {
        throw new StudioError(
          "INVALID_CONTENT_CURSOR",
          "This content page is invalid. Return to the first page.",
        );
      }
    }

    const videos = await this.database.client.video.findMany({
      where: {
        channelId: channel.id,
        ...(input.status ? { status: input.status as never } : { status: { not: "REMOVED" } }),
        ...(input.visibility ? { visibility: input.visibility as never } : {}),
        AND: [
          ...(query
            ? [
                {
                  OR: [
                    { title: { contains: query, mode: "insensitive" as const } },
                    { description: { contains: query, mode: "insensitive" as const } },
                  ],
                },
              ]
            : []),
          ...(boundary
            ? [
                {
                  // Give PostgreSQL a channel-local timestamp range in addition
                  // to the exact lexicographic tie-break predicate.
                  updatedAt: { lte: boundary.updatedAt },
                  OR: [
                    { updatedAt: { lt: boundary.updatedAt } },
                    { updatedAt: boundary.updatedAt, id: { lt: boundary.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: take + 1,
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        visibility: true,
        videoForm: true,
        commentsEnabled: true,
        createdAt: true,
        updatedAt: true,
        publishedAt: true,
        tvPreferences: {
          where: { tvChannel: { channelId: channel.id } },
          take: 1,
          select: { included: true },
        },
      },
    });

    // The lookahead never receives advanced metadata or leaves the service. The cursor contains the issued
    // boundary values, not a mutable anchor row that must still exist later.
    const rows = videos.slice(0, take);
    const last = rows.at(-1);
    return {
      channel,
      actorAccountId: accountId,
      page,
      nextCursor: videos.length > take && last ? encodeStudioContentCursor(last, scope) : null,
      videos: rows.map((video) => ({
        ...video,
        tvIncluded: video.tvPreferences[0]?.included ?? true,
        tvPreferences: undefined,
      })),
    };
  }

  async updateVideo(accountId: string, videoId: string, patch: StudioVideoPatch) {
    const video = await this.ownedVideo(accountId, videoId);
    const title = patch.title?.trim();
    if (patch.title !== undefined && !title) {
      throw new StudioError("INVALID_VIDEO_TITLE", "Video title cannot be empty.");
    }

    await this.database.client.$transaction(async (tx) => {
      await tx.video.update({
        where: { id: video.id },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
          ...(patch.commentsEnabled !== undefined
            ? { commentsEnabled: patch.commentsEnabled }
            : {}),
        },
      });

      if (patch.tvIncluded !== undefined) {
        const tv = await tx.creatorTvChannel.findFirst({
          where: { channelId: video.channelId },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        if (tv) {
          await tx.creatorTvVideoPreference.upsert({
            where: { tvChannelId_videoId: { tvChannelId: tv.id, videoId: video.id } },
            create: {
              tvChannelId: tv.id,
              videoId: video.id,
              included: patch.tvIncluded,
              priority: 0,
            },
            update: { included: patch.tvIncluded },
          });
        }
      }
    });

    return this.videoSummary(video.id);
  }

  async unpublish(accountId: string, videoId: string) {
    const video = await this.ownedVideo(accountId, videoId);
    if (video.status === "REMOVED") {
      throw new StudioError("VIDEO_REMOVED", "This video has already been removed.", 409);
    }
    await this.database.client.video.update({
      where: { id: video.id },
      data: { status: "DRAFT", publishedAt: null, scheduledPublishAt: null },
    });
    return this.videoSummary(video.id);
  }

  async remove(actor: AuthenticatedRequest["ayinAuth"], videoId: string) {
    return this.database.client.$transaction(async (tx) => {
      const observed = await tx.video.findUnique({
        where: { id: videoId },
        select: { channelId: true },
      });
      if (!observed)
        throw new StudioError(
          "VIDEO_NOT_FOUND",
          "This video is not available in your Studio.",
          404,
        );
      const owners = await observeChannelMediaOwners(tx, observed.channelId);
      await lockChannelMediaAccounts(tx, actor.accountId, owners);
      await assertChannelMediaOwners(tx, observed.channelId, owners);
      const assertActor = async () => {
        const account = await tx.account.findUnique({
          where: { id: actor.accountId },
          select: { status: true, authVersion: true },
        });
        const sessions = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "AccountSession"
          WHERE id=${actor.sessionId}::uuid AND "accountId"=${actor.accountId}::uuid
            AND "authVersion"=${actor.authVersion} AND "revokedAt" IS NULL
            AND "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC') FOR SHARE`;
        if (
          !account ||
          account.status !== "ACTIVE" ||
          account.authVersion !== actor.authVersion ||
          !sessions.length
        )
          throw unauthorized();
        const membership = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "ChannelMember"
          WHERE "channelId"=${observed.channelId}::uuid AND "accountId"=${actor.accountId}::uuid
            AND role IN ('OWNER','ADMIN','EDITOR') FOR SHARE`;
        if (!membership.length)
          throw new StudioError(
            "VIDEO_NOT_FOUND",
            "This video is not available in your Studio.",
            404,
          );
      };
      await assertActor();
      await lockMediaGeneration(tx, videoId);
      await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE "videoId"=${videoId}::uuid
        ORDER BY id FOR NO KEY UPDATE /* ayin-studio-remove-assets */`;
      await tx.$queryRaw`SELECT id FROM "MediaProcessingJob" WHERE "videoId"=${videoId}::uuid
        ORDER BY id FOR UPDATE /* ayin-studio-remove-jobs */`;
      await tx.$queryRaw`SELECT id FROM "Video" WHERE id=${videoId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Channel" WHERE id=${observed.channelId}::uuid FOR SHARE`;
      const video = await tx.video.findUnique({
        where: { id: videoId },
        select: { channelId: true, removedAt: true },
      });
      const channel = await tx.channel.findUnique({
        where: { id: observed.channelId },
        select: { status: true, removedAt: true },
      });
      if (
        !video ||
        video.channelId !== observed.channelId ||
        !channel ||
        channel.status === "REMOVED" ||
        channel.removedAt
      )
        throw new StudioError(
          "VIDEO_NOT_FOUND",
          "This video is not available in your Studio.",
          404,
        );
      await assertActor();
      const [uploads, attempts, jobs] = await Promise.all([
        tx.mediaUploadSession.findMany({
          where: { videoId, sourceProtocolVersion: 2 },
          orderBy: { id: "asc" },
        }),
        tx.mediaProcessingOutputAttempt.findMany({
          where: { videoId, protocolVersion: 2 },
          orderBy: { id: "asc" },
        }),
        tx.mediaProcessingJob.findMany({ where: { videoId }, select: { id: true } }),
      ]);
      if ([...uploads, ...attempts].some((record) => record.channelId !== observed.channelId))
        throw new StudioError(
          "VIDEO_STATE_CHANGED",
          "This video's media ownership requires review.",
          409,
        );
      const now = new Date();
      await tx.video.update({
        where: { id: videoId },
        data: {
          status: "REMOVED",
          removedAt: video.removedAt ?? now,
          publishedAt: null,
          scheduledPublishAt: null,
        },
      });
      await tx.mediaProcessingJob.updateMany({
        where: { videoId },
        data: {
          status: "CANCELLED",
          leaseOwner: null,
          leaseWorkerId: null,
          leaseExpiresAt: null,
        },
      });
      await freezeOutputAttempts(
        tx,
        [
          ...new Set([
            ...jobs.map((job) => job.id),
            ...attempts.map((attempt) => attempt.processingJobId),
          ]),
        ].sort(),
        now,
      );
      // Retire only durable owned media references here. Legacy pending sources
      // retain their existing janitor/accounting path until their URLs expire.
      const sourceIds = uploads.flatMap((upload) =>
        upload.sourceAssetId ? [upload.sourceAssetId] : [],
      );
      if (sourceIds.length || attempts.length)
        await tx.mediaAsset.updateMany({
          where: {
            videoId,
            OR: [
              { id: { in: sourceIds } },
              ...attempts.map((attempt) => ({ r2ObjectKey: { startsWith: attempt.prefix } })),
            ],
          },
          data: { status: "REMOVED", removedAt: now },
        });
      await tx.mediaPlaybackGeneration.updateMany({
        where: { videoId },
        data: {
          status: "SUPERSEDED",
          fallbackStatus: "REMOVED",
          hlsMasterStatus: "REMOVED",
        },
      });
      await tx.mediaPlaybackRendition.updateMany({
        where: { playbackGeneration: { videoId } },
        data: { status: "REMOVED" },
      });
      for (const upload of uploads)
        await registerRemovedVideoUploadCleanup(tx, {
          sessionId: upload.id,
          videoId,
          channelId: observed.channelId,
          now,
        });
      await tx.creatorTvVideoPreference.updateMany({
        where: { videoId },
        data: { included: false },
      });
      return { id: videoId, status: "REMOVED" as const };
    });
  }

  async comments(accountId: string) {
    const channel = await this.channelForAccount(accountId);
    const comments = await this.database.client.comment.findMany({
      where: { video: { channelId: channel.id }, status: { not: "REMOVED" } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        body: true,
        status: true,
        createdAt: true,
        parentId: true,
        authorProfile: { select: { id: true, name: true, slug: true } },
        video: { select: { id: true, title: true, commentsEnabled: true } },
        _count: { select: { reactions: true, reports: true, replies: true } },
      },
    });
    return { channel, comments };
  }

  async settings(accountId: string) {
    const channel = await this.channelForAccount(accountId);
    const settings = await this.database.client.channelSettings.findUnique({
      where: { channelId: channel.id },
    });
    return { channel, settings };
  }

  private async channelForAccount(accountId: string) {
    const membership = await this.database.client.channelMember.findFirst({
      where: {
        accountId,
        role: { in: ["OWNER", "ADMIN", "EDITOR"] },
        channel: { status: { not: "REMOVED" } },
      },
      orderBy: { createdAt: "asc" },
      select: { channel: { select: { id: true, handle: true, name: true, status: true } } },
    });
    if (!membership) {
      throw new StudioError(
        "CHANNEL_NOT_FOUND",
        "No creator channel is available for this account.",
        404,
      );
    }
    return membership.channel;
  }

  private async ownedVideo(accountId: string, videoId: string) {
    const video = await this.database.client.video.findFirst({
      where: {
        id: videoId,
        channel: { members: { some: { accountId, role: { in: ["OWNER", "ADMIN", "EDITOR"] } } } },
      },
      select: { id: true, channelId: true, status: true },
    });
    if (!video) {
      throw new StudioError("VIDEO_NOT_FOUND", "This video is not available in your Studio.", 404);
    }
    return video;
  }

  private async videoSummary(videoId: string) {
    return this.database.client.video.findUniqueOrThrow({
      where: { id: videoId },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        visibility: true,
        commentsEnabled: true,
        publishedAt: true,
        updatedAt: true,
      },
    });
  }
}
