import { Prisma } from "@ayin/db";
import { publicVideoEligibility, publicVideoSelect } from "../creator/public-video-read.js";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import {
  VideoPolicyService,
  type VideoPolicyContext,
} from "../video-policy/video-policy.service.js";

export type SeoSitemapKind = "videos" | "channels" | "playlists";

function publicPlaylistEligibility(context: VideoPolicyContext) {
  return Prisma.sql`p.visibility = 'PUBLIC' AND p."isPublic" = TRUE AND p."deletedAt" IS NULL
    AND EXISTS (SELECT 1 FROM "Channel" c WHERE c.id = p."channelId" AND c.status = 'ACTIVE' AND c."removedAt" IS NULL)
    AND EXISTS (SELECT 1 FROM "PlaylistItem" i JOIN "Video" v ON v.id = i."videoId"
      WHERE i."playlistId" = p.id AND ${publicVideoEligibility(context)})`;
}
export interface SitemapVideoRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  durationMs: number | null;
  publishedAt: Date | null;
  updatedAt: Date;
  channel: { handle: string; name: string };
  thumbnailObjectKey: string | null;
  sourceObjectKey: string | null;
}
export interface SitemapChannelRow {
  id: string;
  handle: string;
  name: string;
  description: string | null;
  updatedAt: Date;
  imageObjectKey: string | null;
}
export interface SitemapPlaylistRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  updatedAt: Date;
  channel: { handle: string; name: string };
  imageObjectKey: string | null;
}

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

  async sitemapCounts() {
    const context = { now: new Date() };
    const [counts] = await this.database.client.$queryRaw<
      Array<{ videos: number; channels: number; playlists: number }>
    >(Prisma.sql`
      SELECT (SELECT COUNT(*)::integer FROM "Video" v WHERE ${publicVideoEligibility(context)}) AS videos,
      (SELECT COUNT(*)::integer FROM "Channel" c WHERE c.status = 'ACTIVE' AND c."removedAt" IS NULL) AS channels,
      (SELECT COUNT(*)::integer FROM "Playlist" p WHERE ${publicPlaylistEligibility(context)}) AS playlists
    `);
    if (!counts) throw Error("Missing sitemap counts.");
    return counts;
  }
  async listSitemap(kind: SeoSitemapKind, offset: number, limit: number) {
    const context = { now: new Date() };
    if (kind === "videos")
      return {
        items: await this.database.client.$queryRaw<SitemapVideoRow[]>(Prisma.sql`
      SELECT v.id, v.slug, v.title, v.description, COALESCE(v."durationMs", source."durationMs") AS "durationMs", v."publishedAt", v."updatedAt",
        json_build_object('handle', c.handle, 'name', c.name) AS channel,
        thumbnail."r2ObjectKey" AS "thumbnailObjectKey", source."r2ObjectKey" AS "sourceObjectKey"
      FROM "Video" v JOIN "Channel" c ON c.id = v."channelId"
      JOIN LATERAL (SELECT m."r2ObjectKey", m."durationMs" FROM "MediaAsset" m WHERE m."videoId" = v.id AND m.kind = 'SOURCE_VIDEO' AND m.status = 'VALIDATED' AND m."removedAt" IS NULL AND m."mimeType" = 'video/mp4' ORDER BY m."updatedAt" DESC, m.id DESC LIMIT 1) source ON TRUE
      LEFT JOIN LATERAL (SELECT m."r2ObjectKey" FROM "MediaAsset" m WHERE m."videoId" = v.id AND m.kind = 'THUMBNAIL' AND m.status IN ('UPLOADED','VALIDATED') AND m."removedAt" IS NULL ORDER BY m."updatedAt" DESC, m.id DESC LIMIT 1) thumbnail ON TRUE
      WHERE ${publicVideoEligibility(context)} ORDER BY v.id ASC OFFSET ${offset} LIMIT ${limit}
    `),
      };
    if (kind === "channels")
      return {
        items: await this.database.client.$queryRaw<SitemapChannelRow[]>(Prisma.sql`
      SELECT c.id, c.handle, c.name, c.description, c."updatedAt", image."r2ObjectKey" AS "imageObjectKey"
      FROM "Channel" c
      LEFT JOIN LATERAL (SELECT m."r2ObjectKey" FROM "MediaAsset" m WHERE m."channelId" = c.id AND m.kind IN ('CHANNEL_BANNER','CHANNEL_AVATAR') AND m.status IN ('UPLOADED','VALIDATED') AND m."removedAt" IS NULL ORDER BY CASE WHEN m.kind = 'CHANNEL_BANNER' THEN 0 ELSE 1 END, m."updatedAt" DESC, m.id DESC LIMIT 1) image ON TRUE
      WHERE c.status = 'ACTIVE' AND c."removedAt" IS NULL ORDER BY c.id ASC OFFSET ${offset} LIMIT ${limit}
    `),
      };
    return {
      items: await this.database.client.$queryRaw<SitemapPlaylistRow[]>(Prisma.sql`
      SELECT p.id, p.slug, p.name, p.description, p."updatedAt", json_build_object('handle',c.handle,'name',c.name) AS channel, thumbnail."r2ObjectKey" AS "imageObjectKey"
      FROM "Playlist" p JOIN "Channel" c ON c.id = p."channelId"
      JOIN LATERAL (SELECT v.id FROM "PlaylistItem" i JOIN "Video" v ON v.id = i."videoId" WHERE i."playlistId" = p.id AND ${publicVideoEligibility(context)} ORDER BY i.position ASC, i."videoId" ASC LIMIT 1) lead ON TRUE
      LEFT JOIN LATERAL (SELECT m."r2ObjectKey" FROM "MediaAsset" m WHERE m."videoId" = lead.id AND m.kind = 'THUMBNAIL' AND m.status IN ('UPLOADED','VALIDATED') AND m."removedAt" IS NULL ORDER BY m."updatedAt" DESC, m.id DESC LIMIT 1) thumbnail ON TRUE
      WHERE ${publicPlaylistEligibility(context)} ORDER BY p.id ASC OFFSET ${offset} LIMIT ${limit}
    `),
    };
  }
}
