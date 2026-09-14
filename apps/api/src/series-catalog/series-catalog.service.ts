import type { Prisma } from "@ayin/db";
import { HttpException, Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { VideoPolicyService } from "../video-policy/video-policy.service.js";
import {
  isSafeSeriesSlug,
  nextCatalogEpisode,
  normalizeSeriesSlug,
  seriesPublishIssues,
  type OrderedEpisode,
  type SeriesArtworkTypeValue,
} from "./series-catalog.policy.js";

export interface SeriesArtworkInput {
  type: SeriesArtworkTypeValue;
  mediaAssetId: string;
  altText?: string | null | undefined;
}

export interface SeriesCatalogInput {
  title: string;
  slug?: string | undefined;
  synopsis: string;
  releaseYear?: number | null | undefined;
  maturityRating: string;
  originalLanguage: string;
  genres: string[];
  artwork: SeriesArtworkInput[];
}

export interface SeriesCatalogPatch {
  title?: string | undefined;
  slug?: string | undefined;
  synopsis?: string | undefined;
  releaseYear?: number | null | undefined;
  maturityRating?: string | undefined;
  originalLanguage?: string | undefined;
  genres?: string[] | undefined;
  artwork?: SeriesArtworkInput[] | undefined;
}

export interface SeasonInput {
  seasonNumber: number;
  title?: string | null | undefined;
  sortOrder?: number | undefined;
  artwork?: SeriesArtworkInput[] | undefined;
}

export interface SeasonPatch {
  seasonNumber?: number | undefined;
  title?: string | null | undefined;
  sortOrder?: number | undefined;
  artwork?: SeriesArtworkInput[] | undefined;
}

export interface EpisodeInput {
  episodeNumber: number;
  title: string;
  synopsis: string;
  sortOrder?: number | undefined;
  releaseDate?: Date | null | undefined;
  videoId?: string | null | undefined;
}

export interface EpisodePatch {
  episodeNumber?: number | undefined;
  title?: string | undefined;
  synopsis?: string | undefined;
  sortOrder?: number | undefined;
  releaseDate?: Date | null | undefined;
  videoId?: string | null | undefined;
}

const seriesInclude = {
  genres: { include: { genre: true }, orderBy: { position: "asc" } },
  artwork: true,
  seasons: {
    orderBy: [{ sortOrder: "asc" }, { seasonNumber: "asc" }, { id: "asc" }],
    include: {
      artwork: true,
      episodes: {
        orderBy: [{ sortOrder: "asc" }, { episodeNumber: "asc" }, { id: "asc" }],
      },
    },
  },
} satisfies Prisma.SeriesInclude;

type SeriesWithRelations = Prisma.SeriesGetPayload<{ include: typeof seriesInclude }>;
type AssetRecord = {
  id: string;
  r2ObjectKey: string;
  mimeType: string;
  status: string;
  width: number | null;
  height: number | null;
  removedAt: Date | null;
};
type VideoRecord = {
  id: string;
  slug: string;
  title: string;
  status: string;
  visibility: string;
  durationMs: number | null;
  removedAt: Date | null;
};
type HydratedSeries = SeriesWithRelations & {
  assetById: Map<string, AssetRecord>;
  videoById: Map<string, VideoRecord>;
};

@Injectable()
export class SeriesCatalogService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,
  ) {}

  async createSeries(input: SeriesCatalogInput) {
    const normalized = this.normalizeSeries(input);
    await this.assertArtwork(normalized.artwork);
    try {
      const created = await this.database.client.$transaction(async (tx) => {
        const series = await tx.series.create({
          data: {
            title: normalized.title,
            slug: normalized.slug,
            synopsis: normalized.synopsis,
            releaseYear: normalized.releaseYear,
            maturityRating: normalized.maturityRating,
            originalLanguage: normalized.originalLanguage,
          },
        });
        await this.replaceGenres(tx, series.id, normalized.genres);
        if (normalized.artwork.length) {
          await tx.seriesArtwork.createMany({
            data: normalized.artwork.map((item) => ({ seriesId: series.id, ...item })),
          });
        }
        return series;
      });
      return this.getAdminById(created.id);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isUniqueConstraint(error)) {
        throw catalogError(409, "SERIES_SLUG_CONFLICT", "That series slug is already in use.");
      }
      throw error;
    }
  }

  async updateSeries(seriesId: string, patch: SeriesCatalogPatch) {
    const current = await this.getSeriesRow(seriesId);
    if (!current) throw catalogError(404, "SERIES_NOT_FOUND", "This series does not exist.");
    if (current.status === "ARCHIVED") {
      throw catalogError(409, "SERIES_ARCHIVED", "Archived series cannot be edited.");
    }
    const artwork = patch.artwork ? this.normalizeArtwork(patch.artwork) : undefined;
    if (artwork) await this.assertArtwork(artwork);
    const title = patch.title?.trim();
    const slugSource = patch.slug ?? (patch.title !== undefined ? title : undefined);
    const slug = slugSource !== undefined ? normalizeSeriesSlug(slugSource ?? "") : undefined;
    if (slug !== undefined && !isSafeSeriesSlug(slug)) {
      throw catalogError(400, "INVALID_SERIES_SLUG", "Series slug is not safe.");
    }
    try {
      await this.database.client.$transaction(async (tx) => {
        await tx.series.update({
          where: { id: seriesId },
          data: {
            ...(title !== undefined ? { title } : {}),
            ...(slug !== undefined ? { slug } : {}),
            ...(patch.synopsis !== undefined ? { synopsis: patch.synopsis.trim() } : {}),
            ...(patch.releaseYear !== undefined ? { releaseYear: patch.releaseYear } : {}),
            ...(patch.maturityRating !== undefined
              ? { maturityRating: patch.maturityRating.trim() }
              : {}),
            ...(patch.originalLanguage !== undefined
              ? { originalLanguage: patch.originalLanguage.trim().toLowerCase() }
              : {}),
          },
        });
        if (patch.genres) await this.replaceGenres(tx, seriesId, uniqueTrimmed(patch.genres));
        if (artwork) {
          await tx.seriesArtwork.deleteMany({ where: { seriesId } });
          if (artwork.length) {
            await tx.seriesArtwork.createMany({
              data: artwork.map((item) => ({ seriesId, ...item })),
            });
          }
        }
      });
      return this.getAdminById(seriesId);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isUniqueConstraint(error)) {
        throw catalogError(409, "SERIES_SLUG_CONFLICT", "That series slug is already in use.");
      }
      throw error;
    }
  }

  async createSeason(seriesId: string, input: SeasonInput) {
    await this.assertEditableSeries(seriesId);
    const artwork = this.normalizeArtwork(input.artwork ?? []);
    await this.assertArtwork(artwork);
    const sortOrder = input.sortOrder ?? (await this.nextSeasonSortOrder(seriesId));
    try {
      const season = await this.database.client.seriesSeason.create({
        data: {
          seriesId,
          seasonNumber: input.seasonNumber,
          title: cleanNullable(input.title),
          sortOrder,
          artwork: { create: artwork },
        },
      });
      return this.getAdminSeason(season.id);
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw catalogError(
          409,
          "SEASON_NUMBER_CONFLICT",
          "That season number already exists in this series.",
        );
      }
      throw error;
    }
  }

  async updateSeason(seasonId: string, patch: SeasonPatch) {
    const season = await this.getSeasonRow(seasonId);
    if (!season) throw catalogError(404, "SEASON_NOT_FOUND", "This season does not exist.");
    await this.assertEditableSeries(season.seriesId);
    const artwork = patch.artwork ? this.normalizeArtwork(patch.artwork) : undefined;
    if (artwork) await this.assertArtwork(artwork);
    try {
      await this.database.client.$transaction(async (tx) => {
        await tx.seriesSeason.update({
          where: { id: seasonId },
          data: {
            ...(patch.seasonNumber !== undefined ? { seasonNumber: patch.seasonNumber } : {}),
            ...(patch.title !== undefined ? { title: cleanNullable(patch.title) } : {}),
            ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
          },
        });
        if (artwork) {
          await tx.seriesSeasonArtwork.deleteMany({ where: { seasonId } });
          if (artwork.length) {
            await tx.seriesSeasonArtwork.createMany({
              data: artwork.map((item) => ({ seasonId, ...item })),
            });
          }
        }
      });
      return this.getAdminSeason(seasonId);
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw catalogError(
          409,
          "SEASON_NUMBER_CONFLICT",
          "That season number already exists in this series.",
        );
      }
      throw error;
    }
  }

  async reorderSeasons(seriesId: string, orderedIds: string[]) {
    await this.assertEditableSeries(seriesId);
    const existing = await this.database.client.seriesSeason.findMany({
      where: { seriesId },
      select: { id: true },
    });
    assertExactIdSet(
      existing.map((item) => item.id),
      orderedIds,
      "season",
    );
    await this.database.client.$transaction(
      orderedIds.map((id, index) =>
        this.database.client.seriesSeason.update({
          where: { id },
          data: { sortOrder: index * 10 },
        }),
      ),
    );
    return this.getAdminById(seriesId);
  }

  async createEpisode(seasonId: string, input: EpisodeInput) {
    const season = await this.getSeasonRow(seasonId);
    if (!season) throw catalogError(404, "SEASON_NOT_FOUND", "This season does not exist.");
    await this.assertEditableSeries(season.seriesId);
    await this.assertVideoExists(input.videoId ?? null);
    const sortOrder = input.sortOrder ?? (await this.nextEpisodeSortOrder(seasonId));
    try {
      const episode = await this.database.client.seriesEpisode.create({
        data: {
          seasonId,
          episodeNumber: input.episodeNumber,
          title: input.title.trim(),
          synopsis: input.synopsis.trim(),
          sortOrder,
          releaseDate: input.releaseDate ?? null,
          videoId: input.videoId ?? null,
        },
      });
      return episode;
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw catalogError(
          409,
          "EPISODE_NUMBER_CONFLICT",
          "That episode number already exists in this season.",
        );
      }
      throw error;
    }
  }

  async updateEpisode(episodeId: string, patch: EpisodePatch) {
    const episode = await this.database.client.seriesEpisode.findUnique({
      where: { id: episodeId },
      include: { season: true },
    });
    if (!episode) throw catalogError(404, "EPISODE_NOT_FOUND", "This episode does not exist.");
    await this.assertEditableSeries(episode.season.seriesId);
    if (patch.videoId !== undefined) await this.assertVideoExists(patch.videoId);
    try {
      return await this.database.client.seriesEpisode.update({
        where: { id: episodeId },
        data: {
          ...(patch.episodeNumber !== undefined ? { episodeNumber: patch.episodeNumber } : {}),
          ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
          ...(patch.synopsis !== undefined ? { synopsis: patch.synopsis.trim() } : {}),
          ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
          ...(patch.releaseDate !== undefined ? { releaseDate: patch.releaseDate } : {}),
          ...(patch.videoId !== undefined ? { videoId: patch.videoId } : {}),
        },
      });
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw catalogError(
          409,
          "EPISODE_NUMBER_CONFLICT",
          "That episode number already exists in this season.",
        );
      }
      throw error;
    }
  }

  async reorderEpisodes(seasonId: string, orderedIds: string[]) {
    const season = await this.getSeasonRow(seasonId);
    if (!season) throw catalogError(404, "SEASON_NOT_FOUND", "This season does not exist.");
    await this.assertEditableSeries(season.seriesId);
    const existing = await this.database.client.seriesEpisode.findMany({
      where: { seasonId },
      select: { id: true },
    });
    assertExactIdSet(
      existing.map((item) => item.id),
      orderedIds,
      "episode",
    );
    await this.database.client.$transaction(
      orderedIds.map((id, index) =>
        this.database.client.seriesEpisode.update({
          where: { id },
          data: { sortOrder: index * 10 },
        }),
      ),
    );
    return this.getAdminSeason(seasonId);
  }

  async publishEpisode(episodeId: string) {
    const episode = await this.database.client.seriesEpisode.findUnique({
      where: { id: episodeId },
      include: { season: true },
    });
    if (!episode) throw catalogError(404, "EPISODE_NOT_FOUND", "This episode does not exist.");
    await this.assertEditableSeries(episode.season.seriesId);
    if (!episode.videoId) {
      throw catalogError(
        409,
        "EPISODE_VIDEO_REQUIRED",
        "Assign a playable video before publishing.",
      );
    }
    const video = await this.getVideo(episode.videoId);
    if (
      !video ||
      video.status !== "PUBLISHED" ||
      video.visibility !== "PUBLIC" ||
      video.removedAt
    ) {
      throw catalogError(
        409,
        "EPISODE_VIDEO_NOT_PUBLIC",
        "The assigned video must be a public published video.",
      );
    }
    return this.database.client.seriesEpisode.update({
      where: { id: episodeId },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
  }

  async unpublishEpisode(episodeId: string) {
    return this.database.client.seriesEpisode.update({
      where: { id: episodeId },
      data: { status: "DRAFT", publishedAt: null },
    });
  }

  async publishSeries(seriesId: string) {
    const hydrated = await this.getHydrated(seriesId);
    if (!hydrated) throw catalogError(404, "SERIES_NOT_FOUND", "This series does not exist.");
    if (hydrated.status === "ARCHIVED") {
      throw catalogError(409, "SERIES_ARCHIVED", "Archived series cannot be published.");
    }
    const issues = seriesPublishIssues({
      title: hydrated.title,
      slug: hydrated.slug,
      synopsis: hydrated.synopsis,
      maturityRating: hydrated.maturityRating,
      originalLanguage: hydrated.originalLanguage,
      genres: hydrated.genres,
      artwork: hydrated.artwork.map((item) => ({
        type: item.type,
        assetReady: isReadyAsset(hydrated.assetById.get(item.mediaAssetId)),
      })),
      episodes: hydrated.seasons.flatMap((season) =>
        season.episodes.map((episode) => ({
          status: episode.status,
          video: episode.videoId ? (hydrated.videoById.get(episode.videoId) ?? null) : null,
          releaseDate: episode.releaseDate,
        })),
      ),
    });
    if (issues.length) {
      throw catalogError(409, "SERIES_NOT_PUBLISHABLE", "Series is not ready to publish.", {
        issues,
      });
    }
    await this.database.client.series.update({
      where: { id: seriesId },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    return this.getAdminById(seriesId);
  }

  async unpublishSeries(seriesId: string) {
    await this.database.client.series.update({
      where: { id: seriesId },
      data: { status: "DRAFT", publishedAt: null },
    });
    return this.getAdminById(seriesId);
  }

  async archiveSeries(seriesId: string) {
    await this.database.client.series.update({
      where: { id: seriesId },
      data: { status: "ARCHIVED", publishedAt: null },
    });
    return this.getAdminById(seriesId);
  }

  async listAdmin(limit = 50) {
    const rows = await this.database.client.series.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit,
      include: seriesInclude,
    });
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async getAdminById(seriesId: string) {
    const hydrated = await this.getHydrated(seriesId);
    if (!hydrated) throw catalogError(404, "SERIES_NOT_FOUND", "This series does not exist.");
    return this.adminShape(hydrated);
  }

  async getAdminSeason(seasonId: string) {
    const season = await this.database.client.seriesSeason.findUnique({
      where: { id: seasonId },
      include: {
        artwork: true,
        episodes: {
          orderBy: [{ sortOrder: "asc" }, { episodeNumber: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!season) throw catalogError(404, "SEASON_NOT_FOUND", "This season does not exist.");
    return season;
  }

  async listPublic(limit = 24, search?: string, countryCode?: string) {
    const normalizedSearch = search?.trim();
    const rows = await this.database.client.series.findMany({
      where: {
        status: "PUBLISHED",
        ...(normalizedSearch
          ? {
              OR: [
                { title: { contains: normalizedSearch, mode: "insensitive" } },
                { synopsis: { contains: normalizedSearch, mode: "insensitive" } },
                {
                  genres: {
                    some: { genre: { name: { contains: normalizedSearch, mode: "insensitive" } } },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ publishedAt: "desc" }, { title: "asc" }, { id: "asc" }],
      take: Math.min(Math.max(limit, 1), 100),
      include: seriesInclude,
    });
    const result = [];
    for (const row of rows) {
      const publicSeries = await this.publicShape(await this.hydrate(row), countryCode);
      if (publicSeries) result.push(publicSeries);
    }
    return result;
  }

  async getPublicBySlug(slug: string, countryCode?: string) {
    const row = await this.database.client.series.findUnique({
      where: { slug },
      include: seriesInclude,
    });
    if (!row || row.status !== "PUBLISHED") {
      throw catalogError(404, "SERIES_NOT_FOUND", "This series could not be found.");
    }
    const publicSeries = await this.publicShape(await this.hydrate(row), countryCode);
    if (!publicSeries)
      throw catalogError(404, "SERIES_NOT_FOUND", "This series could not be found.");
    return publicSeries;
  }

  async getPublicContextsForVideos(videoIds: string[], countryCode?: string) {
    if (!videoIds.length) return new Map<string, ReturnType<typeof toEpisodeContext>>();
    const matches = await this.database.client.seriesEpisode.findMany({
      where: {
        videoId: { in: [...new Set(videoIds)] },
        status: "PUBLISHED",
        season: { series: { status: "PUBLISHED" } },
      },
      select: { videoId: true, season: { select: { seriesId: true } } },
    });
    const seriesIds = [...new Set(matches.map((item) => item.season.seriesId))];
    const publicSeriesById = new Map<
      string,
      Awaited<ReturnType<SeriesCatalogService["publicShape"]>>
    >();
    for (const seriesId of seriesIds) {
      const row = await this.database.client.series.findUnique({
        where: { id: seriesId },
        include: seriesInclude,
      });
      if (row)
        publicSeriesById.set(
          seriesId,
          await this.publicShape(await this.hydrate(row), countryCode),
        );
    }
    const contexts = new Map<string, ReturnType<typeof toEpisodeContext>>();
    for (const match of matches) {
      if (!match.videoId) continue;
      const series = publicSeriesById.get(match.season.seriesId);
      if (!series) continue;
      for (const season of series.seasons) {
        const episode = season.episodes.find((item) => item.video.id === match.videoId);
        if (!episode) continue;
        contexts.set(match.videoId, toEpisodeContext(series, season, episode));
      }
    }
    return contexts;
  }

  async getPublicContextForVideo(videoId: string, countryCode?: string) {
    return (await this.getPublicContextsForVideos([videoId], countryCode)).get(videoId) ?? null;
  }

  private async publicShape(hydrated: HydratedSeries, countryCode?: string) {
    if (hydrated.status !== "PUBLISHED") return null;
    const now = new Date();
    const episodeVideoIds = hydrated.seasons.flatMap((season) =>
      season.episodes.flatMap((episode) =>
        episode.status === "PUBLISHED" &&
        episode.videoId &&
        (!episode.releaseDate || episode.releaseDate <= now)
          ? [episode.videoId]
          : [],
      ),
    );
    const allowed = await this.videoPolicy.filterAvailableVideoIds(episodeVideoIds, {
      countryCode,
    });
    const seasons = hydrated.seasons
      .map((season) => ({
        id: season.id,
        seasonNumber: season.seasonNumber,
        title: season.title,
        sortOrder: season.sortOrder,
        artwork: season.artwork.flatMap((item) => {
          const asset = hydrated.assetById.get(item.mediaAssetId);
          return asset && isReadyAsset(asset)
            ? [{ type: item.type, altText: item.altText, objectKey: asset.r2ObjectKey }]
            : [];
        }),
        episodes: season.episodes.flatMap((episode) => {
          if (
            episode.status !== "PUBLISHED" ||
            !episode.videoId ||
            !allowed.has(episode.videoId) ||
            (episode.releaseDate && episode.releaseDate > now)
          ) {
            return [];
          }
          const video = hydrated.videoById.get(episode.videoId);
          if (
            !video ||
            video.status !== "PUBLISHED" ||
            video.visibility !== "PUBLIC" ||
            video.removedAt
          ) {
            return [];
          }
          return [
            {
              id: episode.id,
              episodeNumber: episode.episodeNumber,
              title: episode.title,
              synopsis: episode.synopsis,
              sortOrder: episode.sortOrder,
              releaseDate: episode.releaseDate,
              publishedAt: episode.publishedAt,
              video: {
                id: video.id,
                slug: video.slug,
                title: video.title,
                durationMs: video.durationMs,
                href: `/watch/${video.slug}`,
              },
            },
          ];
        }),
      }))
      .filter((season) => season.episodes.length > 0);
    if (!seasons.length) return null;
    const artwork = hydrated.artwork.flatMap((item) => {
      const asset = hydrated.assetById.get(item.mediaAssetId);
      return asset && isReadyAsset(asset)
        ? [
            {
              type: item.type,
              altText: item.altText,
              objectKey: asset.r2ObjectKey,
              width: asset.width,
              height: asset.height,
            },
          ]
        : [];
    });
    return {
      id: hydrated.id,
      title: hydrated.title,
      slug: hydrated.slug,
      synopsis: hydrated.synopsis,
      releaseYear: hydrated.releaseYear,
      maturityRating: hydrated.maturityRating,
      originalLanguage: hydrated.originalLanguage,
      publishedAt: hydrated.publishedAt,
      updatedAt: hydrated.updatedAt,
      genres: hydrated.genres.map((item) => item.genre.name),
      artwork,
      seasons,
      episodeCount: seasons.reduce((total, season) => total + season.episodes.length, 0),
      firstEpisode: seasons[0]?.episodes[0] ?? null,
    };
  }

  private adminShape(hydrated: HydratedSeries) {
    return {
      ...hydrated,
      genres: hydrated.genres.map((item) => item.genre),
      artwork: hydrated.artwork.map((item) => ({
        ...item,
        asset: hydrated.assetById.get(item.mediaAssetId) ?? null,
      })),
      seasons: hydrated.seasons.map((season) => ({
        ...season,
        artwork: season.artwork.map((item) => ({
          ...item,
          asset: hydrated.assetById.get(item.mediaAssetId) ?? null,
        })),
        episodes: season.episodes.map((episode) => ({
          ...episode,
          video: episode.videoId ? (hydrated.videoById.get(episode.videoId) ?? null) : null,
        })),
      })),
      assetById: undefined,
      videoById: undefined,
    };
  }

  private async getHydrated(seriesId: string) {
    const row = await this.getSeriesRow(seriesId);
    return row ? this.hydrate(row) : null;
  }

  private getSeriesRow(seriesId: string) {
    return this.database.client.series.findUnique({
      where: { id: seriesId },
      include: seriesInclude,
    });
  }

  private async hydrate(row: SeriesWithRelations): Promise<HydratedSeries> {
    const assetIds = [
      ...row.artwork.map((item) => item.mediaAssetId),
      ...row.seasons.flatMap((season) => season.artwork.map((item) => item.mediaAssetId)),
    ];
    const videoIds = row.seasons.flatMap((season) =>
      season.episodes.flatMap((episode) => (episode.videoId ? [episode.videoId] : [])),
    );
    const [assets, videos] = await Promise.all([
      assetIds.length
        ? this.database.client.mediaAsset.findMany({
            where: { id: { in: [...new Set(assetIds)] } },
            select: {
              id: true,
              r2ObjectKey: true,
              mimeType: true,
              status: true,
              width: true,
              height: true,
              removedAt: true,
            },
          })
        : [],
      videoIds.length
        ? this.database.client.video.findMany({
            where: { id: { in: [...new Set(videoIds)] } },
            select: {
              id: true,
              slug: true,
              title: true,
              status: true,
              visibility: true,
              durationMs: true,
              removedAt: true,
            },
          })
        : [],
    ]);
    return {
      ...row,
      assetById: new Map(assets.map((asset) => [asset.id, asset])),
      videoById: new Map(videos.map((video) => [video.id, video])),
    };
  }

  private normalizeSeries(input: SeriesCatalogInput) {
    const title = input.title.trim();
    const slug = normalizeSeriesSlug(input.slug ?? title);
    if (
      !title ||
      !input.synopsis.trim() ||
      !input.maturityRating.trim() ||
      !input.originalLanguage.trim()
    ) {
      throw catalogError(400, "INVALID_SERIES", "Required series metadata is missing.");
    }
    if (!isSafeSeriesSlug(slug)) {
      throw catalogError(400, "INVALID_SERIES_SLUG", "Series slug is not safe.");
    }
    return {
      title,
      slug,
      synopsis: input.synopsis.trim(),
      releaseYear: input.releaseYear ?? null,
      maturityRating: input.maturityRating.trim(),
      originalLanguage: input.originalLanguage.trim().toLowerCase(),
      genres: uniqueTrimmed(input.genres),
      artwork: this.normalizeArtwork(input.artwork),
    };
  }

  private normalizeArtwork(input: SeriesArtworkInput[]) {
    const seen = new Set<string>();
    return input.map((item) => {
      if (seen.has(item.type)) {
        throw catalogError(
          400,
          "DUPLICATE_ARTWORK_TYPE",
          "Each artwork type may appear only once.",
        );
      }
      seen.add(item.type);
      return {
        type: item.type,
        mediaAssetId: item.mediaAssetId,
        altText: cleanNullable(item.altText),
      };
    });
  }

  private async assertArtwork(artwork: SeriesArtworkInput[]) {
    const ids = [...new Set(artwork.map((item) => item.mediaAssetId))];
    if (!ids.length) return;
    const count = await this.database.client.mediaAsset.count({
      where: { id: { in: ids }, removedAt: null },
    });
    if (count !== ids.length) {
      throw catalogError(400, "ARTWORK_NOT_FOUND", "One or more artwork assets do not exist.");
    }
  }

  private async assertVideoExists(videoId: string | null) {
    if (!videoId) return;
    if (!(await this.getVideo(videoId))) {
      throw catalogError(400, "VIDEO_NOT_FOUND", "The assigned video does not exist.");
    }
  }

  private getVideo(videoId: string) {
    return this.database.client.video.findUnique({
      where: { id: videoId },
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        visibility: true,
        durationMs: true,
        removedAt: true,
      },
    });
  }

  private async assertEditableSeries(seriesId: string) {
    const series = await this.database.client.series.findUnique({
      where: { id: seriesId },
      select: { status: true },
    });
    if (!series) throw catalogError(404, "SERIES_NOT_FOUND", "This series does not exist.");
    if (series.status === "ARCHIVED") {
      throw catalogError(409, "SERIES_ARCHIVED", "Archived series cannot be edited.");
    }
  }

  private getSeasonRow(seasonId: string) {
    return this.database.client.seriesSeason.findUnique({
      where: { id: seasonId },
      select: { id: true, seriesId: true },
    });
  }

  private async nextSeasonSortOrder(seriesId: string) {
    const last = await this.database.client.seriesSeason.findFirst({
      where: { seriesId },
      orderBy: [{ sortOrder: "desc" }, { seasonNumber: "desc" }, { id: "desc" }],
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -10) + 10;
  }

  private async nextEpisodeSortOrder(seasonId: string) {
    const last = await this.database.client.seriesEpisode.findFirst({
      where: { seasonId },
      orderBy: [{ sortOrder: "desc" }, { episodeNumber: "desc" }, { id: "desc" }],
      select: { sortOrder: true },
    });
    return (last?.sortOrder ?? -10) + 10;
  }

  private async replaceGenres(tx: Prisma.TransactionClient, seriesId: string, names: string[]) {
    await tx.seriesGenreAssignment.deleteMany({ where: { seriesId } });
    let position = 0;
    for (const name of uniqueTrimmed(names)) {
      const slug = normalizeSeriesSlug(name);
      if (!slug) throw catalogError(400, "INVALID_GENRE", "Every genre must contain a safe name.");
      const genre = await tx.seriesGenre.upsert({
        where: { slug },
        update: { name },
        create: { slug, name },
      });
      await tx.seriesGenreAssignment.create({ data: { seriesId, genreId: genre.id, position } });
      position += 1;
    }
  }
}

function toEpisodeContext(
  series: NonNullable<Awaited<ReturnType<SeriesCatalogService["getPublicBySlug"]>>>,
  season: NonNullable<
    Awaited<ReturnType<SeriesCatalogService["getPublicBySlug"]>>
  >["seasons"][number],
  episode: NonNullable<
    Awaited<ReturnType<SeriesCatalogService["getPublicBySlug"]>>
  >["seasons"][number]["episodes"][number],
) {
  const ordered: OrderedEpisode[] = series.seasons.flatMap((itemSeason) =>
    itemSeason.episodes.map((itemEpisode) => ({
      id: itemEpisode.id,
      seasonId: itemSeason.id,
      seasonNumber: itemSeason.seasonNumber,
      seasonSortOrder: itemSeason.sortOrder,
      episodeNumber: itemEpisode.episodeNumber,
      sortOrder: itemEpisode.sortOrder,
      videoId: itemEpisode.video.id,
      status: "PUBLISHED",
      releaseDate: itemEpisode.releaseDate,
    })),
  );
  const next = nextCatalogEpisode(ordered, episode.id);
  const nextDetail = next
    ? (series.seasons
        .flatMap((itemSeason) =>
          itemSeason.episodes.map((itemEpisode) => ({ season: itemSeason, episode: itemEpisode })),
        )
        .find((item) => item.episode.id === next.id) ?? null)
    : null;
  return {
    series: {
      id: series.id,
      title: series.title,
      slug: series.slug,
      href: `/series/${series.slug}`,
    },
    season: { id: season.id, seasonNumber: season.seasonNumber, title: season.title },
    episode,
    nextEpisode: nextDetail
      ? {
          ...nextDetail.episode,
          seasonNumber: nextDetail.season.seasonNumber,
        }
      : null,
  };
}

function assertExactIdSet(existing: string[], ordered: string[], label: string) {
  const expected = [...existing].toSorted();
  const actual = [...new Set(ordered)].toSorted();
  if (
    ordered.length !== actual.length ||
    expected.length !== actual.length ||
    expected.some((id, index) => id !== actual[index])
  ) {
    throw catalogError(400, "INVALID_REORDER", `Reorder must contain every ${label} exactly once.`);
  }
}

function uniqueTrimmed(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function cleanNullable(value?: string | null) {
  if (value === undefined || value === null) return null;
  return value.trim() || null;
}

function isReadyAsset(asset?: AssetRecord) {
  return Boolean(asset && !asset.removedAt && ["UPLOADED", "VALIDATED"].includes(asset.status));
}

function isUniqueConstraint(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "P2002",
  );
}

function catalogError(status: number, code: string, message: string, details?: unknown) {
  return new HttpException(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    status,
  );
}
