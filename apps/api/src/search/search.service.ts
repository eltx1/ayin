import type { Prisma } from "@ayin/db";
import { HttpException, Inject, Injectable } from "@nestjs/common";

import { VIDEO_CATEGORIES } from "../creator/video-metadata.validation.js";
import { DatabaseService } from "../database/database.service.js";
import { isKidsSearchResultTypeAllowed, kidsSafeHref } from "../kids/kids-policy.js";
import { MovieCatalogService } from "../movie-catalog/movie-catalog.service.js";
import { SeriesCatalogService } from "../series-catalog/series-catalog.service.js";
import {
  VideoPolicyService,
  type VideoPolicyContext,
} from "../video-policy/video-policy.service.js";
import {
  PostgresSearchService,
  type SearchCandidate,
  type SearchCandidateType,
} from "./search-postgres.service.js";

const maxPageSize = 24;
const maxCursorOffset = 500;
const popularitySnapshotMaxAgeMs = 72 * 60 * 60 * 1000;
const maxPopularityBoost = 10;
const publicVideoWhere = {
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
} satisfies Prisma.VideoWhereInput;

export type SearchResultType = SearchCandidateType;

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  href: string;
  kicker: string;
  meta: string | null;
  artworkObjectKey: string | null;
}

type RankedResult = {
  item: SearchResult;
  score: number;
  popularityVideoId: string | null;
};

type VideoMetadataSignal = {
  videoId: string;
  tags: string[];
  category: string | null;
};

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
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PostgresSearchService) private readonly postgresSearch: PostgresSearchService,
    @Inject(SeriesCatalogService) private readonly seriesCatalog: SeriesCatalogService,
    @Inject(MovieCatalogService) private readonly movieCatalog: MovieCatalogService,
    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,
  ) {}

  async search(
    query: string,
    cursor?: string,
    requestedLimit = 12,
    context: VideoPolicyContext = {},
  ) {
    const normalized = normalizeSearchQuery(query);
    const offset = decodeCursor(cursor);
    const limit = Math.min(Math.max(requestedLimit, 1), maxPageSize);
    const takePerType = Math.min(Math.max(offset + limit + 8, 24), 64);
    const [lexicalCandidates, metadataMatches] = await Promise.all([
      this.postgresSearch.searchCandidates(normalized, takePerType),
      this.metadataCandidates(normalized, Math.min(takePerType, 32)),
    ]);
    const candidates = mergeMetadataCandidates(lexicalCandidates, metadataMatches);
    const ranked = await this.hydrateCandidates(candidates, normalized, context, true);
    const eligibleRanked = context.isKidsProfile
      ? ranked.filter((entry) => isKidsSearchResultTypeAllowed(entry.item.type))
      : ranked;
    const items = eligibleRanked.slice(offset, offset + limit).map((entry) => entry.item);
    return {
      query: normalized,
      items,
      nextCursor: eligibleRanked.length > offset + limit ? encodeCursor(offset + limit) : null,
      emptyMessage:
        items.length === 0
          ? "No matches yet. Try a movie, series, creator name, video title, playlist, or Creator TV."
          : null,
    };
  }

  async suggest(query: string, requestedLimit = 6, context: VideoPolicyContext = {}) {
    const normalized = normalizeSearchQuery(query);
    const limit = Math.min(Math.max(requestedLimit, 1), 8);
    const candidates = await this.postgresSearch.suggestCandidates(normalized, limit);
    const ranked = await this.hydrateCandidates(candidates, normalized, context, false);
    const suggestions = ranked
      .filter((entry) => !context.isKidsProfile || isKidsSearchResultTypeAllowed(entry.item.type))
      .slice(0, limit)
      .map(({ item }) => ({
        id: item.id,
        type: item.type,
        label: item.title,
        href: item.href,
      }));
    return { query: normalized, suggestions };
  }

  async filterResults(items: SearchResult[], context: VideoPolicyContext = {}) {
    const videoIds = items.filter((item) => item.type === "VIDEO").map((item) => item.id);
    if (!videoIds.length) return items;
    const allowed = await this.videoPolicy.filterAvailableVideoIds(videoIds, context);
    return items.filter((item) => item.type !== "VIDEO" || allowed.has(item.id));
  }

  private async metadataCandidates(query: string, limit: number): Promise<VideoMetadataSignal[]> {
    const normalizedTag = query.toLocaleLowerCase();
    const categoryToken = query
      .trim()
      .toUpperCase()
      .replace(/[\s&-]+/g, "_");
    const category = VIDEO_CATEGORIES.find((value) => value === categoryToken);
    return this.database.client.videoCreatorMetadata.findMany({
      where: {
        OR: [{ tags: { has: normalizedTag } }, ...(category ? [{ category }] : [])],
      },
      take: limit,
      select: { videoId: true, tags: true, category: true },
    });
  }

  private async hydrateCandidates(
    candidates: SearchCandidate[],
    query: string,
    context: VideoPolicyContext,
    includePopularity: boolean,
  ): Promise<RankedResult[]> {
    const eligibleCandidates = context.isKidsProfile
      ? candidates.filter((candidate) => isKidsSearchResultTypeAllowed(candidate.type))
      : candidates;
    const ids = (type: SearchCandidateType) =>
      eligibleCandidates
        .filter((candidate) => candidate.type === type)
        .map((candidate) => candidate.id);
    const videoIds = ids("VIDEO");
    const channelIds = ids("CHANNEL");
    const playlistIds = ids("PLAYLIST");
    const televisionIds = ids("CREATOR_TV");
    const seriesCandidates = eligibleCandidates.filter((candidate) => candidate.type === "SERIES");
    const movieCandidates = eligibleCandidates.filter((candidate) => candidate.type === "MOVIE");

    const [videos, channels, playlists, televisions, seriesSettled, movies, metadata] =
      await Promise.all([
        videoIds.length
          ? this.database.client.video.findMany({
              where: { AND: [publicVideoWhere, { id: { in: videoIds } }] },
              select: {
                id: true,
                slug: true,
                title: true,
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
            })
          : [],
        channelIds.length
          ? this.database.client.channel.findMany({
              where: { id: { in: channelIds }, status: "ACTIVE", removedAt: null },
              select: { id: true, handle: true, name: true },
            })
          : [],
        playlistIds.length
          ? this.database.client.playlist.findMany({
              where: {
                id: { in: playlistIds },
                deletedAt: null,
                visibility: "PUBLIC",
                channel: { status: "ACTIVE", removedAt: null },
              },
              select: {
                id: true,
                slug: true,
                name: true,
                channel: { select: { handle: true, name: true } },
              },
            })
          : [],
        televisionIds.length
          ? this.database.client.creatorTvChannel.findMany({
              where: {
                id: { in: televisionIds },
                status: "ACTIVE",
                disabledAt: null,
                channel: { status: "ACTIVE", removedAt: null },
              },
              select: {
                id: true,
                name: true,
                channel: { select: { handle: true, name: true } },
              },
            })
          : [],
        Promise.allSettled(
          seriesCandidates
            .slice(0, maxPageSize)
            .map((candidate) =>
              candidate.slug
                ? this.seriesCatalog.getPublicBySlug(candidate.slug, context.countryCode)
                : Promise.resolve(null),
            ),
        ),
        Promise.all(
          movieCandidates
            .slice(0, maxPageSize)
            .map((candidate) =>
              candidate.slug
                ? this.movieCatalog.getPublicBySlug(candidate.slug, context.countryCode)
                : Promise.resolve(null),
            ),
        ),
        videoIds.length
          ? this.database.client.videoCreatorMetadata.findMany({
              where: { videoId: { in: videoIds } },
              select: { videoId: true, tags: true, category: true },
            })
          : [],
      ]);

    const allowedVideoIds = await this.videoPolicy.filterAvailableVideoIds(
      videos.map((video) => video.id),
      context,
    );
    const videoById = new Map(videos.map((video) => [video.id, video]));
    const channelById = new Map(channels.map((channel) => [channel.id, channel]));
    const playlistById = new Map(playlists.map((playlist) => [playlist.id, playlist]));
    const televisionById = new Map(televisions.map((tv) => [tv.id, tv]));
    const seriesById = new Map(
      seriesSettled.flatMap((settled) =>
        settled.status === "fulfilled" && settled.value
          ? [[settled.value.id, settled.value] as const]
          : [],
      ),
    );
    const movieById = new Map(
      movies.flatMap((movie) => (movie ? [[movie.id, movie] as const] : [])),
    );
    const metadataByVideo = new Map(metadata.map((item) => [item.videoId, item]));

    const hydrated = eligibleCandidates.flatMap<RankedResult>((candidate) => {
      if (candidate.type === "VIDEO") {
        const video = videoById.get(candidate.id);
        if (!video || !allowedVideoIds.has(video.id)) return [];
        return [
          {
            item: {
              id: video.id,
              type: "VIDEO",
              title: video.title,
              href: context.isKidsProfile
                ? kidsSafeHref(`/watch/${video.slug}`)
                : `/watch/${video.slug}`,
              kicker: "Video",
              meta: video.channel.name,
              artworkObjectKey: video.mediaAssets[0]?.r2ObjectKey ?? null,
            },
            score: candidate.score + metadataSignalScore(query, metadataByVideo.get(video.id)),
            popularityVideoId: video.id,
          },
        ];
      }
      if (candidate.type === "CHANNEL") {
        const channel = channelById.get(candidate.id);
        if (!channel) return [];
        return [
          {
            item: {
              id: channel.id,
              type: "CHANNEL",
              title: channel.name,
              href: `/c/${channel.handle}`,
              kicker: "Creator",
              meta: `@${channel.handle}`,
              artworkObjectKey: null,
            },
            score: candidate.score,
            popularityVideoId: null,
          },
        ];
      }
      if (candidate.type === "PLAYLIST") {
        const playlist = playlistById.get(candidate.id);
        if (!playlist) return [];
        return [
          {
            item: {
              id: playlist.id,
              type: "PLAYLIST",
              title: playlist.name,
              href: `/c/${playlist.channel.handle}/playlists/${playlist.slug}`,
              kicker: "Playlist",
              meta: playlist.channel.name,
              artworkObjectKey: null,
            },
            score: candidate.score,
            popularityVideoId: null,
          },
        ];
      }
      if (candidate.type === "CREATOR_TV") {
        const television = televisionById.get(candidate.id);
        if (!television) return [];
        return [
          {
            item: {
              id: television.id,
              type: "CREATOR_TV",
              title: television.name,
              href: `/c/${television.channel.handle}/tv`,
              kicker: "Creator TV",
              meta: television.channel.name,
              artworkObjectKey: null,
            },
            score: candidate.score,
            popularityVideoId: null,
          },
        ];
      }
      if (candidate.type === "SERIES") {
        const series = seriesById.get(candidate.id);
        if (!series) return [];
        return [
          {
            item: {
              id: series.id,
              type: "SERIES",
              title: series.title,
              href: `/series/${series.slug}`,
              kicker: "Series",
              meta: `${series.episodeCount} episodes`,
              artworkObjectKey:
                series.artwork.find((item) => item.type === "POSTER")?.objectKey ??
                series.artwork.find((item) => item.type === "BACKDROP")?.objectKey ??
                null,
            },
            score: candidate.score,
            popularityVideoId: series.firstEpisode?.video.id ?? null,
          },
        ];
      }
      const movie = movieById.get(candidate.id);
      if (!movie) return [];
      return [
        {
          item: {
            id: movie.id,
            type: "MOVIE",
            title: movie.title,
            href: `/movies/${movie.slug}`,
            kicker: "Movie",
            meta: [String(movie.releaseYear), movie.genres[0]?.name].filter(Boolean).join(" · "),
            artworkObjectKey: movie.poster?.objectKey ?? movie.backdrop?.objectKey ?? null,
          },
          score: candidate.score,
          popularityVideoId: movie.primaryVideo?.id ?? null,
        },
      ];
    });

    if (!includePopularity) return sortRanked(hydrated);
    const popularityIds = [
      ...new Set(
        hydrated.flatMap((entry) => (entry.popularityVideoId ? [entry.popularityVideoId] : [])),
      ),
    ];
    if (!popularityIds.length) return sortRanked(hydrated);
    const snapshots = await this.database.client.trendingScoreSnapshot.findMany({
      where: {
        scopeKey: "GLOBAL",
        videoId: { in: popularityIds },
        sampledAt: { gte: new Date(Date.now() - popularitySnapshotMaxAgeMs) },
      },
      select: { videoId: true, score: true },
    });
    const maxScore = Math.max(0, ...snapshots.map((snapshot) => Math.max(0, snapshot.score)));
    const popularityByVideo = new Map(
      snapshots.map((snapshot) => [snapshot.videoId, snapshot.score]),
    );
    return sortRanked(
      hydrated.map((entry) => ({
        ...entry,
        score:
          entry.score +
          popularityBoost(
            entry.popularityVideoId ? popularityByVideo.get(entry.popularityVideoId) : undefined,
            maxScore,
          ),
      })),
    );
  }
}

export function normalizeSearchQuery(query: string): string {
  const normalizedInput = query.normalize("NFKC");
  if (
    Array.from(normalizedInput).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    throw new SearchError(
      "INVALID_SEARCH_QUERY",
      "Search terms contain unsupported control characters.",
    );
  }
  const normalized = normalizedInput.replaceAll(/\s+/g, " ").trim();
  const length = Array.from(normalized).length;
  const tokens = normalized ? normalized.split(" ") : [];
  if (length < 2 || length > 100 || tokens.length > 12 || !/[\p{L}\p{N}]/u.test(normalized)) {
    throw new SearchError(
      "INVALID_SEARCH_QUERY",
      "Search terms must contain 2 to 100 characters and no more than 12 words.",
    );
  }
  return normalized;
}

function mergeMetadataCandidates(
  lexical: SearchCandidate[],
  metadata: VideoMetadataSignal[],
): SearchCandidate[] {
  const byKey = new Map(
    lexical.map((candidate) => [`${candidate.type}:${candidate.id}`, candidate]),
  );
  for (const item of metadata) {
    const key = `VIDEO:${item.videoId}`;
    if (!byKey.has(key)) {
      byKey.set(key, { id: item.videoId, type: "VIDEO", slug: null, score: 0 });
    }
  }
  return [...byKey.values()];
}

function metadataSignalScore(
  query: string,
  metadata?: Omit<VideoMetadataSignal, "videoId">,
): number {
  if (!metadata) return 0;
  const normalized = query.toLocaleLowerCase();
  const tags = metadata.tags.map((tag) => tag.normalize("NFKC").toLocaleLowerCase());
  const category = metadata.category?.replaceAll("_", " ").toLocaleLowerCase() ?? "";
  if (tags.includes(normalized)) return 30;
  if (category === normalized) return 26;
  if (tags.some((tag) => tag.startsWith(normalized))) return 18;
  if (category.startsWith(normalized)) return 15;
  return 0;
}

function popularityBoost(score: number | undefined, maxScore: number): number {
  if (!score || score <= 0 || maxScore <= 0) return 0;
  return Math.min(maxPopularityBoost, (Math.max(0, score) / maxScore) * maxPopularityBoost);
}

function sortRanked(items: RankedResult[]): RankedResult[] {
  return items.toSorted(
    (a, b) =>
      b.score - a.score ||
      a.item.title.localeCompare(b.item.title) ||
      a.item.type.localeCompare(b.item.type) ||
      a.item.id.localeCompare(b.item.id),
  );
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
      (parsed.offset as number) > maxCursorOffset
    ) {
      throw new Error("Invalid cursor");
    }
    return parsed.offset as number;
  } catch {
    throw new SearchError("INVALID_SEARCH_CURSOR", "This search page link is invalid.");
  }
}

export function isSearchNotFound(error: unknown): boolean {
  return error instanceof HttpException && error.getStatus() === 404;
}
