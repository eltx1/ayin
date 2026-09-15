import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { VideoPolicyService } from "../video-policy/video-policy.service.js";

export interface CatalogPlayableVideo {
  id: string;
  title: string;
  slug: string;
  status: string;
  visibility: string;
  durationMs: number | null;
  removedAt: Date | null;
  channel: { id: string; name: string; handle: string; status: string; removedAt: Date | null };
}

export interface CatalogArtworkAsset {
  id: string;
  r2ObjectKey: string;
  mimeType: string;
  kind: string;
  status: string;
  width: number | null;
  height: number | null;
  removedAt: Date | null;
  video: { id: string; title: string; slug: string } | null;
  channel: { id: string; name: string; handle: string } | null;
}

@Injectable()
export class CatalogAdminMediaService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,
  ) {}

  async getPlayableVideo(videoId: string): Promise<CatalogPlayableVideo | null> {
    const video = await this.database.client.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        visibility: true,
        durationMs: true,
        removedAt: true,
        channel: {
          select: { id: true, name: true, handle: true, status: true, removedAt: true },
        },
        mediaAssets: {
          where: {
            kind: "SOURCE_VIDEO",
            status: "VALIDATED",
            removedAt: null,
            mimeType: "video/mp4",
          },
          take: 1,
          select: { id: true },
        },
      },
    });
    if (
      !video ||
      video.status !== "PUBLISHED" ||
      video.visibility !== "PUBLIC" ||
      video.removedAt ||
      video.channel.status !== "ACTIVE" ||
      video.channel.removedAt ||
      video.mediaAssets.length === 0
    ) {
      return null;
    }
    const decision = await this.videoPolicy.decide(video.id);
    if (!decision.allowed && decision.reason !== "REGION_UNKNOWN") return null;
    return {
      id: video.id,
      title: video.title,
      slug: video.slug,
      status: video.status,
      visibility: video.visibility,
      durationMs: video.durationMs,
      removedAt: video.removedAt,
      channel: video.channel,
    };
  }

  async getArtworkAsset(assetId: string): Promise<CatalogArtworkAsset | null> {
    const asset = await this.database.client.mediaAsset.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        r2ObjectKey: true,
        mimeType: true,
        kind: true,
        status: true,
        width: true,
        height: true,
        removedAt: true,
        video: { select: { id: true, title: true, slug: true } },
        channel: { select: { id: true, name: true, handle: true } },
      },
    });
    if (
      !asset ||
      asset.status !== "VALIDATED" ||
      asset.removedAt ||
      !asset.mimeType.toLowerCase().startsWith("image/")
    ) {
      return null;
    }
    return asset;
  }

  async searchPlayableVideos(queryRaw?: string, limit = 25) {
    const query = queryRaw?.trim();
    const rows = await this.database.client.video.findMany({
      where: {
        status: "PUBLISHED",
        visibility: "PUBLIC",
        removedAt: null,
        channel: { status: "ACTIVE", removedAt: null },
        mediaAssets: {
          some: {
            kind: "SOURCE_VIDEO",
            status: "VALIDATED",
            removedAt: null,
            mimeType: "video/mp4",
          },
        },
        ...(query
          ? {
              OR: [
                { title: { contains: query, mode: "insensitive" } },
                { slug: { contains: query, mode: "insensitive" } },
                { channel: { name: { contains: query, mode: "insensitive" } } },
                { channel: { handle: { contains: query, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: Math.min(Math.max(limit * 2, limit), 80),
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        visibility: true,
        durationMs: true,
        removedAt: true,
        channel: {
          select: { id: true, name: true, handle: true, status: true, removedAt: true },
        },
      },
    });
    const decisions = await this.videoPolicy.decideMany(rows.map((item) => item.id));
    return rows
      .filter((item) => {
        const decision = decisions.get(item.id);
        return decision?.allowed === true || decision?.reason === "REGION_UNKNOWN";
      })
      .slice(0, limit)
      .map((item) => ({
        ...item,
        label: `${item.title} · @${item.channel.handle}`,
      }));
  }

  async searchArtwork(queryRaw?: string, limit = 25) {
    const query = queryRaw?.trim();
    const rows = await this.database.client.mediaAsset.findMany({
      where: {
        status: "VALIDATED",
        removedAt: null,
        mimeType: { startsWith: "image/", mode: "insensitive" },
        ...(query
          ? {
              OR: [
                { r2ObjectKey: { contains: query, mode: "insensitive" } },
                { video: { title: { contains: query, mode: "insensitive" } } },
                { video: { slug: { contains: query, mode: "insensitive" } } },
                { channel: { name: { contains: query, mode: "insensitive" } } },
                { channel: { handle: { contains: query, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: Math.min(Math.max(limit, 1), 50),
      select: {
        id: true,
        r2ObjectKey: true,
        mimeType: true,
        kind: true,
        status: true,
        width: true,
        height: true,
        removedAt: true,
        video: { select: { id: true, title: true, slug: true } },
        channel: { select: { id: true, name: true, handle: true } },
      },
    });
    return rows.map((item) => ({
      ...item,
      label: item.video
        ? `${item.video.title} · ${item.kind}`
        : item.channel
          ? `${item.channel.name} · ${item.kind}`
          : `${item.kind} · ${item.r2ObjectKey.split("/").at(-1) ?? item.r2ObjectKey}`,
    }));
  }
}
