import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";

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

@Injectable()
export class SeoService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async getVideo(slug: string) {
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
          where: { removedAt: null, status: "VALIDATED" },
          orderBy: { createdAt: "desc" },
          select: {
            kind: true,
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
      (asset) => asset.kind === "SOURCE_VIDEO" && asset.mimeType === "video/mp4",
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

  async getChannel(handle: string) {
    const channel = await this.database.client.channel.findUnique({
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
            status: "VALIDATED",
            kind: { in: ["CHANNEL_AVATAR", "CHANNEL_BANNER"] },
          },
          orderBy: { createdAt: "desc" },
          select: { kind: true, r2ObjectKey: true, mimeType: true, width: true, height: true },
        },
        _count: {
          select: {
            videos: { where: playableVideoWhere },
            playlists: {
              where: {
                visibility: "PUBLIC",
                isPublic: true,
                deletedAt: null,
                items: { some: publicPlaylistVideoWhere },
              },
            },
          },
        },
      },
    });

    if (!channel || channel.status !== "ACTIVE" || channel.removedAt) {
      throw new NotFoundException("This channel is not available for SEO metadata.");
    }

    const avatar = channel.mediaAssets.find((asset) => asset.kind === "CHANNEL_AVATAR");
    const banner = channel.mediaAssets.find((asset) => asset.kind === "CHANNEL_BANNER");
    return {
      id: channel.id,
      handle: channel.handle,
      name: channel.name,
      description: channel.description,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
      publicVideoCount: channel._count.videos,
      publicPlaylistCount: channel._count.playlists,
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
  }

  async getPlaylist(handle: string, slug: string) {
    const playlist = await this.database.client.playlist.findFirst({
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
        items: {
          where: publicPlaylistVideoWhere,
          orderBy: { position: "asc" },
          take: 50,
          select: {
            position: true,
            video: {
              select: {
                id: true,
                slug: true,
                title: true,
                description: true,
                durationMs: true,
                publishedAt: true,
                mediaAssets: {
                  where: { kind: "THUMBNAIL", status: "VALIDATED", removedAt: null },
                  orderBy: { createdAt: "desc" },
                  take: 1,
                  select: { r2ObjectKey: true, mimeType: true, width: true, height: true },
                },
              },
            },
          },
        },
      },
    });

    if (!playlist) {
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
      items: playlist.items.map((item) => ({
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
  }

  async listSitemap(kind: SeoSitemapKind, cursor: string | undefined, limit: number) {
    if (kind === "videos") return this.listVideos(cursor, limit);
    if (kind === "channels") return this.listChannels(cursor, limit);
    return this.listPlaylists(cursor, limit);
  }

  private async listVideos(cursor: string | undefined, limit: number) {
    const videos = await this.database.client.video.findMany({
      where: playableVideoWhere,
      orderBy: { id: "asc" },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
          where: { removedAt: null, status: "VALIDATED" },
          orderBy: { createdAt: "desc" },
          select: { kind: true, mimeType: true, r2ObjectKey: true, durationMs: true },
        },
      },
    });

    return {
      items: videos.map((video) => {
        const source = video.mediaAssets.find(
          (asset) => asset.kind === "SOURCE_VIDEO" && asset.mimeType === "video/mp4",
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
      nextCursor: videos.length === limit ? videos.at(-1)?.id ?? null : null,
    };
  }

  private async listChannels(cursor: string | undefined, limit: number) {
    const channels = await this.database.client.channel.findMany({
      where: { status: "ACTIVE", removedAt: null },
      orderBy: { id: "asc" },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        handle: true,
        name: true,
        description: true,
        updatedAt: true,
        mediaAssets: {
          where: {
            removedAt: null,
            status: "VALIDATED",
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
      nextCursor: channels.length === limit ? channels.at(-1)?.id ?? null : null,
    };
  }

  private async listPlaylists(cursor: string | undefined, limit: number) {
    const playlists = await this.database.client.playlist.findMany({
      where: {
        visibility: "PUBLIC",
        isPublic: true,
        deletedAt: null,
        channel: { status: "ACTIVE", removedAt: null },
        items: { some: publicPlaylistVideoWhere },
      },
      orderBy: { id: "asc" },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
                mediaAssets: {
                  where: { kind: "THUMBNAIL", status: "VALIDATED", removedAt: null },
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

    return {
      items: playlists.map((playlist) => ({
        id: playlist.id,
        slug: playlist.slug,
        name: playlist.name,
        description: playlist.description,
        updatedAt: playlist.updatedAt,
        channel: playlist.channel,
        imageObjectKey: playlist.items[0]?.video.mediaAssets[0]?.r2ObjectKey ?? null,
      })),
      nextCursor: playlists.length === limit ? playlists.at(-1)?.id ?? null : null,
    };
  }
}
