import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { isKidsSearchResultTypeAllowed, kidsSafeHref } from "../kids/kids-policy.js";
import { MovieCatalogService } from "../movie-catalog/movie-catalog.service.js";
import { SeriesCatalogService } from "../series-catalog/series-catalog.service.js";
import {
  VideoPolicyService,
  type VideoPolicyContext,
} from "../video-policy/video-policy.service.js";
import type { LensSemanticCandidate } from "./lens-embedding-index.service.js";
import type { SemanticSearchHit } from "./lens-hybrid-ranker.js";

const popularitySnapshotMaxAgeMs = 72 * 60 * 60 * 1000;

@Injectable()
export class LensSemanticHydratorService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,
    @Inject(MovieCatalogService) private readonly movieCatalog: MovieCatalogService,
    @Inject(SeriesCatalogService) private readonly seriesCatalog: SeriesCatalogService,
  ) {}

  async hydrate(
    candidates: readonly LensSemanticCandidate[],
    context: VideoPolicyContext = {},
  ): Promise<SemanticSearchHit[]> {
    const eligible = context.isKidsProfile
      ? candidates.filter((candidate) => isKidsSearchResultTypeAllowed(candidate.type))
      : [...candidates];
    const videoCandidates = eligible.filter((candidate) => candidate.type === "VIDEO");
    const movieCandidates = eligible.filter((candidate) => candidate.type === "MOVIE");
    const seriesCandidates = eligible.filter((candidate) => candidate.type === "SERIES");

    const [videos, movies, seriesSettled] = await Promise.all([
      videoCandidates.length
        ? this.database.client.video.findMany({
            where: {
              id: { in: videoCandidates.map((candidate) => candidate.id) },
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
            },
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
      Promise.all(
        movieCandidates.map((candidate) =>
          candidate.slug
            ? this.movieCatalog.getPublicBySlug(candidate.slug, context.countryCode)
            : Promise.resolve(null),
        ),
      ),
      Promise.allSettled(
        seriesCandidates.map((candidate) =>
          candidate.slug
            ? this.seriesCatalog.getPublicBySlug(candidate.slug, context.countryCode)
            : Promise.resolve(null),
        ),
      ),
    ]);

    const allowedVideoIds = await this.videoPolicy.filterAvailableVideoIds(
      videos.map((video) => video.id),
      context,
    );
    const candidateByKey = new Map(
      eligible.map((candidate) => [`${candidate.type}:${candidate.id}`, candidate] as const),
    );
    const hydrated: Array<{
      hit: Omit<SemanticSearchHit, "productScore">;
      popularityVideoId: string | null;
    }> = [];

    for (const video of videos) {
      if (!allowedVideoIds.has(video.id)) continue;
      const candidate = candidateByKey.get(`VIDEO:${video.id}`);
      if (!candidate) continue;
      hydrated.push({
        hit: {
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
          semanticScore: candidate.similarity,
        },
        popularityVideoId: video.id,
      });
    }

    for (const movie of movies) {
      if (!movie) continue;
      const candidate = candidateByKey.get(`MOVIE:${movie.id}`);
      if (!candidate) continue;
      hydrated.push({
        hit: {
          item: {
            id: movie.id,
            type: "MOVIE",
            title: movie.title,
            href: `/movies/${movie.slug}`,
            kicker: "Movie",
            meta: [String(movie.releaseYear), movie.genres[0]?.name].filter(Boolean).join(" · "),
            artworkObjectKey: movie.poster?.objectKey ?? movie.backdrop?.objectKey ?? null,
          },
          semanticScore: candidate.similarity,
        },
        popularityVideoId: movie.primaryVideo?.id ?? null,
      });
    }

    for (const settled of seriesSettled) {
      if (settled.status !== "fulfilled" || !settled.value) continue;
      const item = settled.value;
      const candidate = candidateByKey.get(`SERIES:${item.id}`);
      if (!candidate) continue;
      hydrated.push({
        hit: {
          item: {
            id: item.id,
            type: "SERIES",
            title: item.title,
            href: `/series/${item.slug}`,
            kicker: "Series",
            meta: `${item.episodeCount} episodes`,
            artworkObjectKey:
              item.artwork.find((artwork) => artwork.type === "POSTER")?.objectKey ??
              item.artwork.find((artwork) => artwork.type === "BACKDROP")?.objectKey ??
              null,
          },
          semanticScore: candidate.similarity,
        },
        popularityVideoId: item.firstEpisode?.video.id ?? null,
      });
    }

    const popularityIds = [
      ...new Set(
        hydrated.flatMap((entry) =>
          entry.popularityVideoId ? [entry.popularityVideoId] : [],
        ),
      ),
    ];
    const snapshots = popularityIds.length
      ? await this.database.client.trendingScoreSnapshot.findMany({
          where: {
            scopeKey: "GLOBAL",
            videoId: { in: popularityIds },
            sampledAt: { gte: new Date(Date.now() - popularitySnapshotMaxAgeMs) },
          },
          select: { videoId: true, score: true },
        })
      : [];
    const maxScore = Math.max(0, ...snapshots.map((snapshot) => Math.max(0, snapshot.score)));
    const popularityByVideo = new Map(
      snapshots.map((snapshot) => [snapshot.videoId, snapshot.score] as const),
    );

    return hydrated.map((entry) => ({
      ...entry.hit,
      productScore: normalizedProductScore(
        entry.popularityVideoId
          ? popularityByVideo.get(entry.popularityVideoId)
          : undefined,
        maxScore,
      ),
    }));
  }
}

function normalizedProductScore(score: number | undefined, maximum: number): number {
  if (!score || score <= 0 || maximum <= 0) return 0;
  return Math.min(1, Math.max(0, score) / maximum);
}
