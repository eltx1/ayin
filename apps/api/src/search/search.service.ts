import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { SearchError } from "./search.errors.js";

const playableAssetStates = ["UPLOADED", "VALIDATED"] as const;
const defaultPageSize = 12;
const maxPageSize = 24;
const maxOffset = 192;
const candidateCap = maxOffset + maxPageSize + 1;

export const searchResultTypes = ["VIDEO", "CHANNEL", "PLAYLIST", "CREATOR_TV"] as const;
export type SearchResultType = (typeof searchResultTypes)[number];

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  href: string;
  kicker: string;
  meta: string | null;
  artworkObjectKey: string | null;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  nextCursor: string | null;
}

export interface SearchInput {
  query: string;
  types?: readonly SearchResultType[] | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
  minimumQueryLength?: number | undefined;
}

interface ScoredResult {
  result: SearchResult;
  score: number;
}

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

@Injectable()
export class SearchService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async search(input: SearchInput): Promise<SearchResponse> {
    const query = normalizeSearchQuery(input.query);
    const minimumQueryLength = input.minimumQueryLength ?? 2;
    if (query.length < minimumQueryLength) {
      throw new SearchError(
        "SEARCH_QUERY_TOO_SHORT",
        `Search queries must contain at least ${minimumQueryLength} characters.`,
      );
    }

    const offset = decodeSearchCursor(input.cursor);
    const limit = Math.min(Math.max(input.limit ?? defaultPageSize, 1), maxPageSize);
    const selectedTypes = new Set(input.types?.length ? input.types : searchResultTypes);
    const candidateTake = Math.min(offset + limit + 1, candidateCap);

    const groups = await Promise.all([
      selectedTypes.has("VIDEO") ? this.searchVideos(query, candidateTake) : [],
      selectedTypes.has("CHANNEL") ? this.searchChannels(query, candidateTake) : [],
      selectedTypes.has("PLAYLIST") ? this.searchPlaylists(query, candidateTake) : [],
      selectedTypes.has("CREATOR_TV") ? this.searchCreatorTv(query, candidateTake) : [],
    ]);
    const ranked = groups.flat().sort(compareScoredResults);
    const end = offset + limit;
    const results = ranked.slice(offset, end).map((candidate) => candidate.result);
    const nextCursor = ranked.length > end && end <= maxOffset ? encodeSearchCursor(end) : null;

    return { query, results, nextCursor };
  }

  async suggestions(query: string, limit = 6, minimumQueryLength = 2): Promise<SearchResult[]> {
    const response = await this.search({
      query,
      limit: Math.min(Math.max(limit, 1), 10),
      minimumQueryLength,
    });
    return response.results;
  }

  private async searchVideos(query: string, take: number): Promise<ScoredResult[]> {
    const videos = await this.database.client.video.findMany({
      where: {
        AND: [
          publicVideoWhere,
          {
            OR: [
              { title: { contains: query, mode: "insensitive" } },
              { description: { contains: query, mode: "insensitive" } },
              { channel: { name: { contains: query, mode: "insensitive" } } },
            ],
          },
        ],
      },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take,
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        durationMs: true,
        channel: { select: { handle: true, name: true } },
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

    return videos.map((video) => ({
      result: {
        id: video.id,
        type: "VIDEO",
        title: video.title,
        href: `/watch/${encodeURIComponent(video.slug)}`,
        kicker: "Video",
        meta: video.channel.name,
        artworkObjectKey: video.mediaAssets[0]?.r2ObjectKey ?? null,
      },
      score: relevanceScore("VIDEO", video.title, [video.description, video.channel.name], query),
    }));
  }

  private async searchChannels(query: string, take: number): Promise<ScoredResult[]> {
    const handleQuery = query.startsWith("@") ? query.slice(1) : query;
    const channels = await this.database.client.channel.findMany({
      where: {
        status: "ACTIVE",
        removedAt: null,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { handle: { contains: handleQuery, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take,
      select: { id: true, handle: true, name: true, description: true },
    });

    return channels.map((channel) => ({
      result: {
        id: channel.id,
        type: "CHANNEL",
        title: channel.name,
        href: `/c/${encodeURIComponent(channel.handle)}`,
        kicker: "Channel",
        meta: `@${channel.handle}`,
        artworkObjectKey: null,
      },
      score: relevanceScore("CHANNEL", channel.name, [channel.handle, channel.description], query),
    }));
  }

  private async searchPlaylists(query: string, take: number): Promise<ScoredResult[]> {
    const playlists = await this.database.client.playlist.findMany({
      where: {
        visibility: "PUBLIC",
        deletedAt: null,
        channel: { status: "ACTIVE", removedAt: null },
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
          { channel: { name: { contains: query, mode: "insensitive" } } },
        ],
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take,
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        channel: { select: { handle: true, name: true } },
      },
    });

    return playlists.map((playlist) => ({
      result: {
        id: playlist.id,
        type: "PLAYLIST",
        title: playlist.name,
        href: `/c/${encodeURIComponent(playlist.channel.handle)}/playlists/${encodeURIComponent(playlist.slug)}`,
        kicker: "Playlist",
        meta: playlist.channel.name,
        artworkObjectKey: null,
      },
      score: relevanceScore("PLAYLIST", playlist.name, [playlist.description, playlist.channel.name], query),
    }));
  }

  private async searchCreatorTv(query: string, take: number): Promise<ScoredResult[]> {
    const handleQuery = query.startsWith("@") ? query.slice(1) : query;
    const channels = await this.database.client.creatorTvChannel.findMany({
      where: {
        status: "ACTIVE",
        disabledAt: null,
        channel: { status: "ACTIVE", removedAt: null },
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { slug: { contains: query, mode: "insensitive" } },
          { channel: { name: { contains: query, mode: "insensitive" } } },
          { channel: { handle: { contains: handleQuery, mode: "insensitive" } } },
        ],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take,
      select: {
        id: true,
        slug: true,
        name: true,
        channel: { select: { handle: true, name: true } },
      },
    });

    return channels.map((tv) => ({
      result: {
        id: tv.id,
        type: "CREATOR_TV",
        title: tv.name,
        href: `/c/${encodeURIComponent(tv.channel.handle)}/tv`,
        kicker: "Creator TV",
        meta: tv.channel.name,
        artworkObjectKey: null,
      },
      score: relevanceScore("CREATOR_TV", tv.name, [tv.slug, tv.channel.name, tv.channel.handle], query),
    }));
  }
}

export function normalizeSearchQuery(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function encodeSearchCursor(offset: number): string {
  return Buffer.from(`search:${offset}`, "utf8").toString("base64url");
}

export function decodeSearchCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const match = /^search:(\d{1,3})$/.exec(decoded);
    const offset = match ? Number(match[1]) : Number.NaN;
    if (!Number.isInteger(offset) || offset < 0 || offset > maxOffset) throw new Error();
    return offset;
  } catch {
    throw new SearchError("INVALID_SEARCH_CURSOR", "The search cursor is invalid.");
  }
}

function relevanceScore(
  type: SearchResultType,
  title: string,
  secondary: Array<string | null>,
  query: string,
): number {
  const normalizedTitle = title.toLocaleLowerCase();
  const normalizedQuery = query.replace(/^@/, "").toLocaleLowerCase();
  let score = typePriority(type);
  if (normalizedTitle === normalizedQuery) score += 1_000;
  else if (normalizedTitle.startsWith(normalizedQuery)) score += 700;
  else if (normalizedTitle.includes(normalizedQuery)) score += 500;
  for (const value of secondary) {
    const normalized = value?.toLocaleLowerCase();
    if (!normalized) continue;
    if (normalized === normalizedQuery) score += 250;
    else if (normalized.startsWith(normalizedQuery)) score += 160;
    else if (normalized.includes(normalizedQuery)) score += 90;
  }
  return score;
}

function typePriority(type: SearchResultType): number {
  switch (type) {
    case "VIDEO":
      return 40;
    case "CHANNEL":
      return 30;
    case "CREATOR_TV":
      return 20;
    case "PLAYLIST":
      return 10;
  }
}

function compareScoredResults(left: ScoredResult, right: ScoredResult): number {
  if (left.score !== right.score) return right.score - left.score;
  const titleOrder = compareText(left.result.title, right.result.title);
  if (titleOrder !== 0) return titleOrder;
  const typeOrder = compareText(left.result.type, right.result.type);
  return typeOrder !== 0 ? typeOrder : compareText(left.result.id, right.result.id);
}

function compareText(left: string, right: string): number {
  const a = left.toLocaleLowerCase();
  const b = right.toLocaleLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
}
