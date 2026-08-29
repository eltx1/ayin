import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { WatchService } from "../watch/watch.service.js";

const playableAssetStates = ["UPLOADED", "VALIDATED"] as const;

const publicVideoWhere = {
  status: "PUBLISHED",
  visibility: "PUBLIC",
  removedAt: null,
  channel: { status: "ACTIVE", removedAt: null },
  mediaAssets: {
    some: {
      kind: "SOURCE_VIDEO",
      status: { in: [...playableAssetStates] },
      removedAt: null,
      mimeType: "video/mp4",
    },
  },
} satisfies Prisma.VideoWhereInput;

export type PublicPlaybackContract = Awaited<ReturnType<WatchService["getPublicPlayback"]>>;

export interface RelatedContentItem {
  id: string;
  type: "VIDEO";
  title: string;
  href: string;
  kicker: string;
  meta: string | null;
  artworkObjectKey: string | null;
}

export interface VideoContentDetailResponse {
  kind: "VIDEO";
  content: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    durationMs: number | null;
    publishedAt: Date | null;
    artworkObjectKey: string | null;
    creator: { id: string; handle: string; name: string };
  };
  playback: PublicPlaybackContract;
  related: RelatedContentItem[];
  actionHooks: {
    save: { key: "save"; status: "RESERVED"; targetTask: "TASK_14" };
  };
  slots: {
    comments: {
      key: "comments";
      enabled: boolean;
      status: "RESERVED_TASK_15";
    };
    externalAds: Array<{
      key: "watch_below_player" | "content_detail";
      status: "RESERVED";
    }>;
  };
}

@Injectable()
export class ContentService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WatchService) private readonly watch: WatchService,
  ) {}

  async getVideoDetail(slug: string): Promise<VideoContentDetailResponse> {
    const playback = await this.watch.getPublicPlayback(slug);
    const detail = await this.database.client.video.findUniqueOrThrow({
      where: { id: playback.video.id },
      select: {
        commentsEnabled: true,
        mediaAssets: {
          where: {
            kind: "THUMBNAIL",
            status: { in: [...playableAssetStates] },
            removedAt: null,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { r2ObjectKey: true },
        },
      },
    });

    return {
      kind: "VIDEO",
      content: {
        id: playback.video.id,
        slug: playback.video.slug,
        title: playback.video.title,
        description: playback.video.description,
        durationMs: playback.video.durationMs,
        publishedAt: playback.video.publishedAt,
        artworkObjectKey: detail.mediaAssets[0]?.r2ObjectKey ?? null,
        creator: playback.video.channel,
      },
      playback,
      related: await this.relatedVideos(playback.video.id, playback.video.channel.id),
      actionHooks: {
        save: { key: "save", status: "RESERVED", targetTask: "TASK_14" },
      },
      slots: {
        comments: {
          key: "comments",
          enabled: detail.commentsEnabled,
          status: "RESERVED_TASK_15",
        },
        externalAds: [
          { key: "watch_below_player", status: "RESERVED" },
          { key: "content_detail", status: "RESERVED" },
        ],
      },
    };
  }

  private async relatedVideos(videoId: string, channelId: string): Promise<RelatedContentItem[]> {
    const select = {
      id: true,
      slug: true,
      title: true,
      channel: { select: { name: true } },
      mediaAssets: {
        where: {
          kind: "THUMBNAIL" as const,
          status: { in: [...playableAssetStates] },
          removedAt: null,
        },
        orderBy: { createdAt: "desc" as const },
        take: 1,
        select: { r2ObjectKey: true },
      },
    } satisfies Prisma.VideoSelect;

    const sameChannel = await this.database.client.video.findMany({
      where: { AND: [publicVideoWhere, { channelId, id: { not: videoId } }] },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take: 6,
      select,
    });
    const remaining = Math.max(8 - sameChannel.length, 0);
    const fallback =
      remaining > 0
        ? await this.database.client.video.findMany({
            where: {
              AND: [
                publicVideoWhere,
                { channelId: { not: channelId } },
                { id: { notIn: [videoId, ...sameChannel.map((video) => video.id)] } },
              ],
            },
            orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
            take: remaining,
            select,
          })
        : [];

    return [...sameChannel, ...fallback].map((video) => ({
      id: video.id,
      type: "VIDEO",
      title: video.title,
      href: `/watch/${encodeURIComponent(video.slug)}`,
      kicker: "Related video",
      meta: video.channel.name,
      artworkObjectKey: video.mediaAssets[0]?.r2ObjectKey ?? null,
    }));
  }
}
