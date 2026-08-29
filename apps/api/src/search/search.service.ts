import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";

const maxPageSize = 24;
const publicVideoWhere = {
  status: "PUBLISHED",
  visibility: "PUBLIC",
  removedAt: null,
  channel: { status: "ACTIVE", removedAt: null },
  mediaAssets: {
    some: {
      kind: "SOURCE_VIDEO",
      status: { in: ["UPLOADED", "VALIDATED"] },
      removedAt: null,
      mimeType: "video/mp4",
    },
  },
} satisfies Prisma.VideoWhereInput;

export type SearchResultType = "VIDEO" | "CHANNEL" | "PLAYLIST" | "CREATOR_TV";

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  href: string;
  kicker: string;
  meta: string | null;
  artworkObjectKey: string | null;
}

export class SearchError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "SearchError";
  }
}

@Injectable()
export class SearchService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async search(query: string, cursor?: string, requestedLimit = 12) {
    const normalized = normalizeQuery(query);
    const offset = decodeCursor(cursor);
    const limit = Math.min(Math.max(requestedLimit, 1), maxPageSize);
    const takePerType = Math.min(offset + limit + 1, maxPageSize * 3);

    const [videos, channels, playlists, televisions] = await Promise.all([
      this.database.client.video.findMany({
        where: {
          AND: [
            publicVideoWhere,
            {
              OR: [
                { title: { contains: normalized, mode: "insensitive" } },
                { description: { contains: normalized, mode: "insensitive" } },
                { channel: { name: { contains: normalized, mode: "insensitive" } } },
                { channel: { handle: { contains: normalized, mode: "insensitive" } } },
              ],
            },
          ],
        },
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        take: takePerType,
        select: {
          id: true,
          slug: true,
          title: true,
          publishedAt: true,
          channel: { select: { name: true } },
          mediaAssets: {
            where: {
              kind: "THUMBNAIL",
              status: { in: ["UPLOADED", "VALIDATED"] },
              removedAt: null,
            },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { r2ObjectKey: true },
          },
        },
      }),
      this.database.client.channel.findMany({
        where: {
          status: "ACTIVE",
          removedAt: null,
          OR: [
            { name: { contains: normalized, mode: "insensitive" } },
            { handle: { contains: normalized, mode: "insensitive" } },
            { description: { contains: normalized, mode: "insensitive" } },
          ],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: takePerType,
        select: { id: true, handle: true, name: true },
      }),
      this.database.client.playlist.findMany({
        where: {
          deletedAt: null,
          visibility: "PUBLIC",
          channel: { status: "ACTIVE", removedAt: null },
          OR: [
            { name: { contains: normalized, mode: "insensitive" } },
            { description: { contains: normalized, mode: "insensitive" } },
          ],
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: takePerType,
        select: {
          id: true,
          slug: true,
          name: true,
          channel: { select: { handle: true, name: true } },
        },
      }),
      this.database.client.creatorTvChannel.findMany({
        where: {
          status: "ACTIVE",
          disabledAt: null,
          channel: { status: "ACTIVE", removedAt: null },
          OR: [
            { name: { contains: normalized, mode: "insensitive" } },
            { channel: { name: { contains: normalized, mode: "insensitive" } } },
          ],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: takePerType,
        select: { id: true, name: true, channel: { select: { handle: true, name: true } } },
      }),
    ]);

    const ranked: SearchResult[] = [
      ...videos.map((video) => ({
        id: video.id,
        type: "VIDEO" as const,
        title: video.title,
        href: `/watch/${video.slug}`,
        kicker: "Video",
        meta: video.channel.name,
        artworkObjectKey: video.mediaAssets[0]?.r2ObjectKey ?? null,
      })),
      ...channels.map((channel) => ({
        id: channel.id,
        type: "CHANNEL" as const,
        title: channel.name,
        href: `/c/${channel.handle}`,
        kicker: "Creator",
        meta: `@${channel.handle}`,
        artworkObjectKey: null,
      })),
      ...playlists.map((playlist) => ({
        id: playlist.id,
        type: "PLAYLIST" as const,
        title: playlist.name,
        href: `/c/${playlist.channel.handle}/playlists/${playlist.slug}`,
        kicker: "Playlist",
        meta: playlist.channel.name,
        artworkObjectKey: null,
      })),
      ...televisions.map((tv) => ({
        id: tv.id,
        type: "CREATOR_TV" as const,
        title: tv.name,
        href: `/c/${tv.channel.handle}/tv`,
        kicker: "Creator TV",
        meta: tv.channel.name,
        artworkObjectKey: null,
      })),
    ];
    const items = ranked.slice(offset, offset + limit);
    return {
      query: normalized,
      items,
      nextCursor: ranked.length > offset + limit ? encodeCursor(offset + limit) : null,
      emptyMessage:
        items.length === 0
          ? "No matches yet. Try a creator name, video title, playlist, or Creator TV."
          : null,
    };
  }

  async suggest(query: string, requestedLimit = 6) {
    const normalized = normalizeQuery(query);
    const limit = Math.min(Math.max(requestedLimit, 1), 8);
    const [videos, channels, televisions] = await Promise.all([
      this.database.client.video.findMany({
        where: {
          AND: [publicVideoWhere, { title: { startsWith: normalized, mode: "insensitive" } }],
        },
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        take: limit,
        select: { id: true, slug: true, title: true },
      }),
      this.database.client.channel.findMany({
        where: {
          status: "ACTIVE",
          removedAt: null,
          OR: [
            { name: { startsWith: normalized, mode: "insensitive" } },
            { handle: { startsWith: normalized, mode: "insensitive" } },
          ],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        select: { id: true, handle: true, name: true },
      }),
      this.database.client.creatorTvChannel.findMany({
        where: {
          status: "ACTIVE",
          disabledAt: null,
          channel: { status: "ACTIVE", removedAt: null },
          name: { startsWith: normalized, mode: "insensitive" },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        select: { id: true, name: true, channel: { select: { handle: true } } },
      }),
    ]);
    return {
      query: normalized,
      suggestions: [
        ...videos.map((video) => ({
          id: video.id,
          type: "VIDEO" as const,
          label: video.title,
          href: `/watch/${video.slug}`,
        })),
        ...channels.map((channel) => ({
          id: channel.id,
          type: "CHANNEL" as const,
          label: channel.name,
          href: `/c/${channel.handle}`,
        })),
        ...televisions.map((tv) => ({
          id: tv.id,
          type: "CREATOR_TV" as const,
          label: tv.name,
          href: `/c/${tv.channel.handle}/tv`,
        })),
      ].slice(0, limit),
    };
  }
}

function normalizeQuery(query: string): string {
  const normalized = query.normalize("NFKC").replaceAll(/\s+/g, " ").trim();
  if (normalized.length < 2 || normalized.length > 100) {
    throw new SearchError("INVALID_SEARCH_QUERY", "Search terms must contain 2 to 100 characters.");
  }
  return normalized;
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("offset" in parsed) ||
      !Number.isInteger(parsed.offset) ||
      (parsed.offset as number) < 0 ||
      (parsed.offset as number) > 10_000
    ) {
      throw new Error("Invalid cursor");
    }
    return parsed.offset as number;
  } catch {
    throw new SearchError("INVALID_SEARCH_CURSOR", "This search page link is invalid.");
  }
}
