import { Prisma } from "@ayin/db";
import { publicVideoEligibility, publicVideoSelect } from "../creator/public-video-read.js";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import {
  VideoPolicyService,
  type VideoPolicyContext,
} from "../video-policy/video-policy.service.js";

export type SeoSitemapKind = "videos" | "channels" | "playlists";

const playableVideoWhere = {
  status: "PUBLISHED" as const,
  visibility: "PUBLIC" as const,
  removedAt: null,
  channel: { status: "ACTIVE" as const, removedAt: null },
  mediaAssets: {
    some: {
      kind: "SOURCE_VIDEO" as const,
      status: "VALIDATED" as const,
      removedAt: null,
      mimeType: "video/mp4",
    },
  },
};

const publicPlaylistVideoWhere = {
  video: playableVideoWhere,
};

const completedImageStatuses = ["UPLOADED", "VALIDATED"] as const;

@Injectable()
export class SeoService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,
  ) {}

  async getVideo(slug: string, context: VideoPolicyContext = {}) {
    const video = await this.database.client.video.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        durationMs: true,
        visibility: true,
        status: true,
        publishedAt: true,
        updatedAt: true,
        removedAt: true,
        channel: {
          select: { id: true, handle: true, name: true, status: true, removedAt: true },
        },
        mediaAssets: {
          where: { removedAt: null, status: { in: [...completedImageStatuses] } },
          orderBy: { createdAt: "desc" },
          select: {
            kind: true,
            status: true,
            mimeType: true,
            r2ObjectKey: true,
            durationMs: true,
            width: true,
            height: true,
          },
        },
      },
    });

    const source = video?.mediaAssets.find(
      (asset) =>
        asset.kind === "SOURCE_VIDEO" &&
        asset.status === "VALIDATED" &&
        asset.mimeType === "video/mp4",
    );
    if (
      !video ||
      video.status !== "PUBLISHED" ||
      video.visibility === "PRIVATE" ||
      video.removedAt ||
      video.channel.status !== "ACTIVE" ||
      video.channel.removedAt ||
      !source
    ) {
      throw new NotFoundException("This video is not available for SEO metadata.");
    }

    const availability = await this.videoPolicy.decide(video.id, context);
    if (!availability.allowed)
      throw new NotFoundException("This video is not available for SEO metadata.");

    const thumbnail = video.mediaAssets.find((asset) => asset.kind === "THUMBNAIL");
    return {
      id: video.id,
      slug: video.slug,
      title: video.title,
      description: video.description,
      durationMs: video.durationMs ?? source.durationMs,
      visibility: video.visibility,
      publishedAt: video.publishedAt,
      updatedAt: video.updatedAt,
      channel: {
        id: video.channel.id,
        handle: video.channel.handle,
        name: video.channel.name,
      },
      thumbnail: thumbnail
        ? {
            objectKey: thumbnail.r2ObjectKey,
            mimeType: thumbnail.mimeType,
            width: thumbnail.width,
            height: thumbnail.height,
          }
        : null,
      source: {
        objectKey: source.r2ObjectKey,
        mimeType: source.mimeType,
      },
    };
  }

  async getChannel(handle: string, context: VideoPolicyContext = {}) {
    const policyContext = { ...context, now: context.now ?? new Date() };
    return this.database.client.$transaction(
      async (tx) => {
        const channel = await tx.channel.findUnique({
          where: { handle },
          select: {
            id: true,
            handle: true,
            name: true,
            description: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            removedAt: true,
            mediaAssets: {
              where: {
                removedAt: null,
                status: { in: [...completedImageStatuses] },
                kind: { in: ["CHANNEL_AVATAR", "CHANNEL_BANNER"] },
              },
              orderBy: { createdAt: "desc" },
              select: {
                kind: true,
                r2ObjectKey: true,
                mimeType: true,
                width: true,
                height: true,
              },
            },
          },
        });

        if (!channel || channel.status !== "ACTIVE" || channel.removedAt) {
          throw new NotFoundException("This channel is not available for SEO metadata.");
        }

        const [counts] = await tx.$queryRaw<
          { videoCount: number; playlistCount: number }[]
        >(Prisma.sql`
      SELECT (SELECT COUNT(*)::integer FROM "Video" v WHERE v."channelId" = ${channel.id}::uuid
        AND ${publicVideoEligibility(policyContext)}) AS "videoCount",
      (SELECT COUNT(*)::integer FROM "Playlist" p WHERE p."channelId" = ${channel.id}::uuid
        AND p.visibility = 'PUBLIC' AND p."isPublic" = TRUE AND p."deletedAt" IS NULL
        AND EXISTS (SELECT 1 FROM "PlaylistItem" i JOIN "Video" v ON v.id = i."videoId"
          WHERE i."playlistId" = p.id AND ${publicVideoEligibility(policyContext)})) AS "playlistCount"
    `);
        if (!counts) throw new Error("Missing channel count projection.");
        const avatar = channel.mediaAssets.find((asset) => asset.kind === "CHANNEL_AVATAR");
        const banner = channel.mediaAssets.find((asset) => asset.kind === "CHANNEL_BANNER");
        return {
          id: channel.id,
          handle: channel.handle,
          name: channel.name,
          description: channel.description,
          createdAt: channel.createdAt,
          updatedAt: channel.updatedAt,
          publicVideoCount: counts.videoCount,
          publicPlaylistCount: counts.playlistCount,
          avatar: avatar
            ? {
                objectKey: avatar.r2ObjectKey,
                mimeType: avatar.mimeType,
                width: avatar.width,
                height: avatar.height,
              }
            : null,
          banner: banner
            ? {
                objectKey: banner.r2ObjectKey,
                mimeType: banner.mimeType,
                width: banner.width,
                height: banner.height,
              }
            : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async getPlaylist(handle: string, slug: string, context: VideoPolicyContext = {}) {
    const policyContext = { ...context, now: context.now ?? new Date() };
    return this.database.client.$transaction(
      async (tx) => {
        const playlist = await tx.playlist.findFirst({
          where: {
            slug,
            deletedAt: null,
            visibility: { in: ["PUBLIC", "UNLISTED"] },
            isPublic: true,
            channel: { handle, status: "ACTIVE", removedAt: null },
          },
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
            visibility: true,
            createdAt: true,
            updatedAt: true,
            channel: { select: { id: true, handle: true, name: true } },
          },
        });

        if (!playlist) {
          throw new NotFoundException("This playlist is not available for SEO metadata.");
        }

        const candidates = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT i.id FROM "PlaylistItem" i JOIN "Video" v ON v.id = i."videoId"
      WHERE i."playlistId" = ${playlist.id}::uuid AND ${publicVideoEligibility(policyContext)}
      ORDER BY i.position ASC, i.id ASC LIMIT 50
    `);
        const availableItems = candidates.length
          ? await tx.playlistItem.findMany({
              where: { id: { in: candidates.map((item) => item.id) } },
              orderBy: [{ position: "asc" }, { id: "asc" }],
              select: {
                position: true,
                video: {
                  select: {
                    ...publicVideoSelect,
                    mediaAssets: {
                      ...publicVideoSelect.mediaAssets,
                      select: { r2ObjectKey: true, mimeType: true, width: true, height: true },
                    },
                  },
                },
              },
            })
          : [];
        if (!availableItems.length) {
          throw new NotFoundException("This playlist is not available for SEO metadata.");
        }

        return {
          id: playlist.id,
          slug: playlist.slug,
          name: playlist.name,
          description: playlist.description,
          visibility: playlist.visibility,
          createdAt: playlist.createdAt,
          updatedAt: playlist.updatedAt,
          channel: playlist.channel,
          items: availableItems.map((item) => ({
            position: item.position,
            video: {
              id: item.video.id,
              slug: item.video.slug,
              title: item.video.title,
              description: item.video.description,
              durationMs: item.video.durationMs,
              publishedAt: item.video.publishedAt,
              thumbnail: item.video.mediaAssets[0] ?? null,
            },
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async listSitemap(kind: SeoSitemapKind, offset: number, limit: number) {
    if (kind === "videos") return this.listVideos(offset, limit);
    if (kind === "channels") return this.listChannels(offset, limit);
    return this.listPlaylists(offset, limit);
  }

  private async listVideos(offset: number, limit: number) {
    const videos = await this.database.client.video.findMany({
      where: playableVideoWhere,
      orderBy: { id: "asc" },
      skip: offset,
      take: limit,
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        durationMs: true,
        publishedAt: true,
        updatedAt: true,
        channel: { select: { handle: true, name: true } },
        mediaAssets: {
          where: { removedAt: null, status: { in: [...completedImageStatuses] } },
          orderBy: { createdAt: "desc" },
          select: {
            kind: true,
            status: true,
            mimeType: true,
            r2ObjectKey: true,
            durationMs: true,
          },
        },
      },
    });

    const allowedVideoIds = await this.videoPolicy.filterAvailableVideoIds(
      videos.map((video) => video.id),
      {},
    );
    return {
      items: videos
        .filter((video) => allowedVideoIds.has(video.id))
        .map((video) => {
          const source = video.mediaAssets.find(
            (asset) =>
              asset.kind === "SOURCE_VIDEO" &&
              asset.status === "VALIDATED" &&
              asset.mimeType === "video/mp4",
          );
          const thumbnail = video.mediaAssets.find((asset) => asset.kind === "THUMBNAIL");
          return {
            id: video.id,
            slug: video.slug,
            title: video.title,
            description: video.description,
            durationMs: video.durationMs ?? source?.durationMs ?? null,
            publishedAt: video.publishedAt,
            updatedAt: video.updatedAt,
            channel: video.channel,
            thumbnailObjectKey: thumbnail?.r2ObjectKey ?? null,
            sourceObjectKey: source?.r2ObjectKey ?? null,
          };
        }),
    };
  }

  private async listChannels(offset: number, limit: number) {
    const channels = await this.database.client.channel.findMany({
      where: { status: "ACTIVE", removedAt: null },
      orderBy: { id: "asc" },
      skip: offset,
      take: limit,
      select: {
        id: true,
        handle: true,
        name: true,
        description: true,
        updatedAt: true,
        mediaAssets: {
          where: {
            removedAt: null,
            status: { in: [...completedImageStatuses] },
            kind: { in: ["CHANNEL_AVATAR", "CHANNEL_BANNER"] },
          },
          orderBy: { createdAt: "desc" },
          select: { kind: true, r2ObjectKey: true },
        },
      },
    });

    return {
      items: channels.map((channel) => ({
        id: channel.id,
        handle: channel.handle,
        name: channel.name,
        description: channel.description,
        updatedAt: channel.updatedAt,
        imageObjectKey:
          channel.mediaAssets.find((asset) => asset.kind === "CHANNEL_BANNER")?.r2ObjectKey ??
          channel.mediaAssets.find((asset) => asset.kind === "CHANNEL_AVATAR")?.r2ObjectKey ??
          null,
      })),
    };
  }

  private async listPlaylists(offset: number, limit: number) {
    const playlists = await this.database.client.playlist.findMany({
      where: {
        visibility: "PUBLIC",
        isPublic: true,
        deletedAt: null,
        channel: { status: "ACTIVE", removedAt: null },
        items: { some: publicPlaylistVideoWhere },
      },
      orderBy: { id: "asc" },
      skip: offset,
      take: limit,
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        updatedAt: true,
        channel: { select: { handle: true, name: true } },
        items: {
          where: publicPlaylistVideoWhere,
          orderBy: { position: "asc" },
          take: 1,
          select: {
            video: {
              select: {
                id: true,
                mediaAssets: {
                  where: {
                    kind: "THUMBNAIL",
                    status: { in: [...completedImageStatuses] },
                    removedAt: null,
                  },
                  orderBy: { createdAt: "desc" },
                  take: 1,
                  select: { r2ObjectKey: true },
                },
              },
            },
          },
        },
      },
    });

    const leadVideoIds = playlists.flatMap((playlist) =>
      playlist.items.map((item) => item.video.id),
    );
    const allowedLeadVideoIds = await this.videoPolicy.filterAvailableVideoIds(leadVideoIds, {});
    return {
      items: playlists
        .filter((playlist) => playlist.items.some((item) => allowedLeadVideoIds.has(item.video.id)))
        .map((playlist) => ({
          id: playlist.id,
          slug: playlist.slug,
          name: playlist.name,
          description: playlist.description,
          updatedAt: playlist.updatedAt,
          channel: playlist.channel,
          imageObjectKey: playlist.items[0]?.video.mediaAssets[0]?.r2ObjectKey ?? null,
        })),
    };
  }
}
