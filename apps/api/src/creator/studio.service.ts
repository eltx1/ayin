import { Inject, Injectable } from "@nestjs/common";

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
    const query = input.query?.trim();

    const videos = await this.database.client.video.findMany({
      where: {
        channelId: channel.id,
        ...(input.status ? { status: input.status as never } : { status: { not: "REMOVED" } }),
        ...(input.visibility ? { visibility: input.visibility as never } : {}),
        ...(query
          ? {
              OR: [
                { title: { contains: query, mode: "insensitive" } },
                { description: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take,
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        visibility: true,
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

    return {
      channel,
      videos: videos.map((video) => ({
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

  async remove(accountId: string, videoId: string) {
    const video = await this.ownedVideo(accountId, videoId);
    if (video.status === "REMOVED") return { id: video.id, status: "REMOVED" as const };
    await this.database.client.$transaction(async (tx) => {
      await tx.video.update({
        where: { id: video.id },
        data: { status: "REMOVED", removedAt: new Date(), publishedAt: null },
      });
      await tx.creatorTvVideoPreference.updateMany({
        where: { videoId: video.id },
        data: { included: false },
      });
    });
    return { id: video.id, status: "REMOVED" as const };
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
