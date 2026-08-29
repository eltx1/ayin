import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import { WatchService } from "../watch/watch.service.js";

const playableStates = ["UPLOADED", "VALIDATED"] as const;
const maxCursorOffset = 500;
const defaultSearchLimit = 12;
const maxSearchLimit = 20;

const searchableVideoWhere = {
  status: "PUBLISHED",
  visibility: "PUBLIC",
  removedAt: null,
  channel: { status: "ACTIVE", removedAt: null },
  mediaAssets: {
    some: {
      kind: "SOURCE_VIDEO",
      status: { in: [...playableStates] },
      removedAt: null,
      mimeType: "video/mp4",
    },
  },
} satisfies Prisma.VideoWhereInput;

const searchVideoSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  publishedAt: true,
  channel: { select: { handle: true, name: true } },
  mediaAssets: {
    where: { kind: "THUMBNAIL", status: { in: [...playableStates] }, removedAt: null },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { r2ObjectKey: true },
  },
} satisfies Prisma.VideoSelect;

type SearchVideoRecord = Prisma.VideoGetPayload<{ select: typeof searchVideoSelect }>;

export type SearchEntityType = "VIDEO" | "CHANNEL" | "PLAYLIST" | "CREATOR_TV";

export interface SearchItem {
  id: string;
  type: SearchEntityType;
  title: string;
  subtitle: string | null;
  href: string;
  artworkObjectKey: string | null;
}

export interface SearchPage {
  query: string;
  items: SearchItem[];
  nextCursor: string | null;
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

interface RankedSearchItem extends SearchItem {
  score: number;
  sortAt: Date | null;
}

@Injectable()
export class SearchRateLimitService {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(@Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService) {}

  async assertAllowed(clientKey: string): Promise<void> {
    const limit = (await this.settings.get("searchRequestsPerMinute")) as number;
    const now = Date.now();
    const current = this.windows.get(clientKey);
    if (!current || current.resetAt <= now) {
      this.windows.set(clientKey, { count: 1, resetAt: now + 60_000 });
      this.prune(now);
      return;
    }
    if (current.count >= limit) {
      throw new SearchError(
        "SEARCH_RATE_LIMITED",
        "Search is receiving too many requests. Please try again shortly.",
        429,
      );
    }
    current.count += 1;
  }

  private prune(now: number): void {
    if (this.windows.size < 2_000) return;
    for (const [key, value] of this.windows) {
      if (value.resetAt <= now) this.windows.delete(key);
    }
  }
}

@Injectable()
export class SearchService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async search(rawQuery: string, cursor?: string, requestedLimit?: number): Promise<SearchPage> {
    const query = normalizeSearchQuery(rawQuery);
    if (query.length < 2) {
      throw new SearchError("SEARCH_QUERY_TOO_SHORT", "Enter at least two characters to search AYIN.");
    }
    const offset = decodeCursor(cursor);
    const limit = Math.min(Math.max(requestedLimit ?? defaultSearchLimit, 1), maxSearchLimit);
    const candidateTake = Math.min(offset + limit + 1, maxCursorOffset + maxSearchLimit + 1);
    const contains = { contains: query, mode: "insensitive" as const };

    const [videos, channels, playlists, tvChannels] = await Promise.all([
      this.database.client.video.findMany({
        where: {
          AND: [
            searchableVideoWhere,
            {
              OR: [
                { title: contains },
                { description: contains },
                { channel: { name: contains } },
                { channel: { handle: contains } },
              ],
            },
          ],
        },
        orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
        take: candidateTake,
        select: searchVideoSelect,
      }),
      this.database.client.channel.findMany({
        where: {
          status: "ACTIVE",
          removedAt: null,
          OR: [{ name: contains }, { handle: contains }, { description: contains }],
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: candidateTake,
        select: { id: true, handle: true, name: true, description: true, createdAt: true },
      }),
      this.database.client.playlist.findMany({
        where: {
          visibility: "PUBLIC",
          isPublic: true,
          deletedAt: null,
          channel: { status: "ACTIVE", removedAt: null },
          OR: [{ name: contains }, { description: contains }, { channel: { name: contains } }],
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: candidateTake,
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          createdAt: true,
          channel: { select: { handle: true, name: true } },
        },
      }),
      this.database.client.creatorTvChannel.findMany({
        where: {
          status: "ACTIVE",
          channel: { status: "ACTIVE", removedAt: null },
          OR: [{ name: contains }, { slug: contains }, { channel: { name: contains } }],
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: candidateTake,
        select: {
          id: true,
          slug: true,
          name: true,
          createdAt: true,
          channel: { select: { handle: true, name: true } },
        },
      }),
    ]);

    const ranked: RankedSearchItem[] = [
      ...videos.map((video) => rankVideo(query, video)),
      ...channels.map((channel) => ({
        id: channel.id,
        type: "CHANNEL" as const,
        title: channel.name,
        subtitle: `@${channel.handle}`,
        href: `/c/${encodeURIComponent(channel.handle)}`,
        artworkObjectKey: null,
        score: relevanceScore(query, channel.name, channel.handle, channel.description),
        sortAt: channel.createdAt,
      })),
      ...playlists.map((playlist) => ({
        id: playlist.id,
        type: "PLAYLIST" as const,
        title: playlist.name,
        subtitle: `${playlist.channel.name} playlist`,
        href: `/c/${encodeURIComponent(playlist.channel.handle)}/playlists/${encodeURIComponent(playlist.slug)}`,
        artworkObjectKey: null,
        score: relevanceScore(query, playlist.name, playlist.channel.name, playlist.description),
        sortAt: playlist.createdAt,
      })),
      ...tvChannels.map((tv) => ({
        id: tv.id,
        type: "CREATOR_TV" as const,
        title: tv.name,
        subtitle: `${tv.channel.name} · Creator TV`,
        href: `/c/${encodeURIComponent(tv.channel.handle)}/tv`,
        artworkObjectKey: null,
        score: relevanceScore(query, tv.name, tv.channel.name, tv.slug),
        sortAt: tv.createdAt,
      })),
    ].sort(compareRankedItems);

    const page = ranked.slice(offset, offset + limit + 1);
    const hasMore = page.length > limit && offset + limit < maxCursorOffset;
    return {
      query,
      items: page.slice(0, limit).map(stripRank),
      nextCursor: hasMore ? encodeCursor(offset + limit) : null,
    };
  }

  async suggestions(rawQuery: string, requestedLimit = 8): Promise<SearchItem[]> {
    const query = normalizeSearchQuery(rawQuery);
    if (query.length < 2) return [];
    const page = await this.search(query, undefined, Math.min(Math.max(requestedLimit, 1), 10));
    return page.items;
  }
}

@Injectable()
export class ContentDetailService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WatchService) private readonly watch: WatchService,
  ) {}

  async get(kind: string, slug: string) {
    if (kind.toLowerCase() !== "video") {
      throw new SearchError(
        "CONTENT_KIND_NOT_AVAILABLE",
        "This content type is not available in the current AYIN catalog.",
        404,
      );
    }
    return this.getVideo(slug);
  }

  private async getVideo(slug: string) {
    const playback = await this.watch.getPublicPlayback(slug);
    const record = await this.database.client.video.findUnique({
      where: { id: playback.video.id },
      select: {
        commentsEnabled: true,
        createdAt: true,
        mediaAssets: {
          where: { kind: "THUMBNAIL", status: { in: [...playableStates] }, removedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { r2ObjectKey: true },
        },
      },
    });
    if (!record) {
      throw new SearchError("CONTENT_NOT_FOUND", "This AYIN content could not be found.", 404);
    }

    const related = await this.database.client.video.findMany({
      where: {
        AND: [searchableVideoWhere, { channelId: playback.video.channel.id }, { id: { not: playback.video.id } }],
      },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take: 8,
      select: searchVideoSelect,
    });

    return {
      kind: "VIDEO" as const,
      content: {
        id: playback.video.id,
        slug: playback.video.slug,
        title: playback.video.title,
        description: playback.video.description,
        durationMs: playback.video.durationMs,
        publishedAt: playback.video.publishedAt,
        artworkObjectKey: record.mediaAssets[0]?.r2ObjectKey ?? null,
        creator: playback.video.channel,
      },
      playback,
      related: related.map((video) => stripRank(rankVideo("", video))),
      capabilities: {
        save: "RESERVED_TASK_14" as const,
        comments: record.commentsEnabled ? ("RESERVED_TASK_15" as const) : ("DISABLED" as const),
        externalAdPlacementKeys: ["content_detail", "watch_below_player"] as const,
      },
      catalogCompatibility: {
        supportedPattern: ["VIDEO", "MOVIE", "SERIES"] as const,
        implementedKinds: ["VIDEO"] as const,
      },
    };
  }
}

function rankVideo(query: string, video: SearchVideoRecord): RankedSearchItem {
  return {
    id: video.id,
    type: "VIDEO",
    title: video.title,
    subtitle: video.channel.name,
    href: `/watch/${encodeURIComponent(video.slug)}`,
    artworkObjectKey: video.mediaAssets[0]?.r2ObjectKey ?? null,
    score: relevanceScore(query, video.title, video.channel.name, video.description),
    sortAt: video.publishedAt,
  };
}

function normalizeSearchQuery(input: string): string {
  return input.normalize("NFKC").replaceAll(/\s+/g, " ").trim().slice(0, 100);
}

function relevanceScore(query: string, primary: string, secondary?: string | null, tertiary?: string | null): number {
  if (!query) return 100;
  const needle = query.toLocaleLowerCase();
  const first = primary.toLocaleLowerCase();
  const second = secondary?.toLocaleLowerCase() ?? "";
  const third = tertiary?.toLocaleLowerCase() ?? "";
  if (first === needle) return 0;
  if (first.startsWith(needle)) return 10;
  if (first.includes(needle)) return 20;
  if (second === needle || second.startsWith(needle)) return 30;
  if (second.includes(needle)) return 40;
  if (third.includes(needle)) return 50;
  return 100;
}

function compareRankedItems(left: RankedSearchItem, right: RankedSearchItem): number {
  if (left.score !== right.score) return left.score - right.score;
  const leftTime = left.sortAt?.getTime() ?? 0;
  const rightTime = right.sortAt?.getTime() ?? 0;
  if (leftTime !== rightTime) return rightTime - leftTime;
  const titleComparison = left.title.localeCompare(right.title);
  return titleComparison !== 0 ? titleComparison : left.id.localeCompare(right.id);
}

function stripRank(item: RankedSearchItem): SearchItem {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    subtitle: item.subtitle,
    href: item.href,
    artworkObjectKey: item.artworkObjectKey,
  };
}

function encodeCursor(offset: number): string {
  return String(offset);
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  if (!/^\d{1,3}$/.test(cursor)) {
    throw new SearchError("INVALID_SEARCH_CURSOR", "The search cursor is invalid.");
  }
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > maxCursorOffset) {
    throw new SearchError("INVALID_SEARCH_CURSOR", "The search cursor is invalid.");
  }
  return offset;
}
