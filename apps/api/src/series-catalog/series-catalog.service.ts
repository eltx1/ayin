import type { Prisma } from "@ayin/db";
import { HttpException, Inject, Injectable } from "@nestjs/common";

import { CatalogAdminMediaService } from "../admin/catalog-admin-media.service.js";
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

export interface SeriesAvailabilityInput {
  territoryCode: string;
  rule: "ALLOW" | "BLOCK";
  startsAt?: Date | null | undefined;
  endsAt?: Date | null | undefined;
  note?: string | null | undefined;
}

export interface SeriesCatalogInput {
  title: string;
  slug?: string | undefined;
  synopsis: string;
  releaseYear?: number | null | undefined;
  maturityRating: string;
  originalLanguage: string;
  trailerVideoId?: string | null | undefined;
  genres: string[];
  artwork: SeriesArtworkInput[];
  availability?: SeriesAvailabilityInput[] | undefined;
}

export interface SeriesCatalogPatch {
  title?: string | undefined;
  slug?: string | undefined;
  synopsis?: string | undefined;
  releaseYear?: number | null | undefined;
  maturityRating?: string | undefined;
  originalLanguage?: string | undefined;
  trailerVideoId?: string | null | undefined;
  genres?: string[] | undefined;
  artwork?: SeriesArtworkInput[] | undefined;
  availability?: SeriesAvailabilityInput[] | undefined;
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
  availability: true,
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
    @Inject(CatalogAdminMediaService) private readonly catalogMedia: CatalogAdminMediaService,
  ) {}

  async createSeries(input: SeriesCatalogInput) {
    const normalized = this.normalizeSeries(input);
    await this.assertArtwork(normalized.artwork);
    await this.assertPlayableVideo(
      normalized.trailerVideoId,
      "TRAILER_VIDEO_NOT_PLAYABLE",
      "Trailer",
    );
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
            trailerVideoId: normalized.trailerVideoId,
            availability: { create: normalized.availability },
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
    const availability = patch.availability
      ? this.normalizeAvailability(patch.availability)
      : undefined;
    if (patch.trailerVideoId !== undefined) {
      await this.assertPlayableVideo(patch.trailerVideoId, "TRAILER_VIDEO_NOT_PLAYABLE", "Trailer");
    }
    this.assertPublishedSeriesPatchSafe(current, patch, artwork, availability);
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
            ...(patch.trailerVideoId !== undefined ? { trailerVideoId: patch.trailerVideoId } : {}),
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
        if (availability) {
          await tx.seriesAvailability.deleteMany({ where: { seriesId } });
          if (availability.length) {
            await tx.seriesAvailability.createMany({
              data: availability.map((item) => ({ seriesId, ...item })),
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
    await this.assertSeasonSortOrderAvailable(seriesId, sortOrder);
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
    if (patch.sortOrder !== undefined) {
      await this.assertSeasonSortOrderAvailable(season.seriesId, patch.sortOrder, seasonId);
    }
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
      select: { id: true, sortOrder: true },
    });
    assertExactIdSet(
      existing.map((item) => item.id),
      orderedIds,
      "season",
    );
    const maxOrder = existing.reduce((max, item) => Math.max(max, item.sortOrder), 0);
    const temporaryBase = maxOrder + orderedIds.length * 20 + 1000;
    await this.database.client.$transaction(async (tx) => {
      for (const [index, id] of orderedIds.entries()) {
        await tx.seriesSeason.update({
          where: { id },
          data: { sortOrder: temporaryBase + index },
        });
      }
      for (const [index, id] of orderedIds.entries()) {
        await tx.seriesSeason.update({ where: { id }, data: { sortOrder: index * 10 } });
      }
    });
    return this.getAdminById(seriesId);
  }

  async createEpisode(seasonId: string, input: EpisodeInput) {
    const season = await this.getSeasonRow(seasonId);
    if (!season) throw catalogError(404, "SEASON_NOT_FOUND", "This season does not exist.");
    await this.assertEditableSeries(season.seriesId);
    await this.assertPlayableVideo(
      input.videoId ?? null,
      "EPISODE_VIDEO_NOT_PLAYABLE",
      "Episode playback",
    );
    const sortOrder = input.sortOrder ?? (await this.nextEpisodeSortOrder(seasonId));
    await this.assertEpisodeSortOrderAvailable(seasonId, sortOrder);
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
    if (episode.status === "PUBLISHED" && patch.videoId === null) {
      throw catalogError(
        409,
        "PUBLISHED_EPISODE_VIDEO_REQUIRED",
        "Unpublish the episode before removing its playable Video.",
      );
    }
    if (patch.videoId !== undefined) {
      await this.assertPlayableVideo(
        patch.videoId,
        "EPISODE_VIDEO_NOT_PLAYABLE",
        "Episode playback",
      );
    }
    if (patch.sortOrder !== undefined) {
      await this.assertEpisodeSortOrderAvailable(episode.seasonId, patch.sortOrder, episodeId);
    }
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
      select: { id: true, sortOrder: true },
    });
    assertExactIdSet(
      existing.map((item) => item.id),
      orderedIds,
      "episode",
    );
    const maxOrder = existing.reduce((max, item) => Math.max(max, item.sortOrder), 0);
    const temporaryBase = maxOrder + orderedIds.length * 20 + 1000;
    await this.database.client.$transaction(async (tx) => {
      for (const [index, id] of orderedIds.entries()) {
        await tx.seriesEpisode.update({
          where: { id },
          data: { sortOrder: temporaryBase + index },
        });
      }
      for (const [index, id] of orderedIds.entries()) {
        await tx.seriesEpisode.update({ where: { id }, data: { sortOrder: index * 10 } });
      }
    });
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
    if (!(await this.catalogMedia.getPlayableVideo(episode.videoId))) {
      throw catalogError(
        409,
        "EPISODE_VIDEO_NOT_PLAYABLE",
        "The assigned video must be accessible, public, published and have validated playback media.",
      );
    }
    return this.database.client.seriesEpisode.update({
      where: { id: episodeId },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
  }

  async unpublishEpisode(episodeId: string) {
    const episode = await this.database.client.seriesEpisode.findUnique({
      where: { id: episodeId },
      include: { season: { include: { series: true } } },
    });
    if (!episode) throw catalogError(404, "EPISODE_NOT_FOUND", "This episode does not exist.");
    if (episode.status === "PUBLISHED" && episode.season.series.status === "PUBLISHED") {
      const others = await this.database.client.seriesEpisode.findMany({
        where: {
          id: { not: episodeId },
          status: "PUBLISHED",
          videoId: { not: null },
          season: { seriesId: episode.season.seriesId },
        },
        select: { videoId: true },
      });
      let replacementExists = false;
      for (const other of others) {
        if (other.videoId && (await this.catalogMedia.getPlayableVideo(other.videoId))) {
          replacementExists = true;
          break;
        }
      }
      if (!replacementExists) {
        throw catalogError(
          409,
          "SERIES_WOULD_BE_ORPHANED",
          "Unpublish the Series before removing its last published playable episode.",
        );
      }
    }
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
    const validation = await this.seriesValidation(hydrated);
    if (!validation.publishable) {
      throw catalogError(409, "SERIES_NOT_PUBLISHABLE", "Series is not ready to publish.", {
        issues: validation.issues,
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
    const current = await this.database.client.series.findUnique({
      where: { id: seriesId },
      select: { status: true },
    });
    if (!current) throw catalogError(404, "SERIES_NOT_FOUND", "This series does not exist.");
    if (current.status === "PUBLISHED") {
      throw catalogError(
        409,
        "UNPUBLISH_BEFORE_ARCHIVE",
        "Unpublish the Series before archiving it.",
      );
    }
    await this.database.client.series.update({
      where: { id: seriesId },
      data: { status: "ARCHIVED", publishedAt: null },
    });
    return this.getAdminById(seriesId);
  }

  async listAdmin(limit = 50, search?: string, status?: "DRAFT" | "PUBLISHED" | "ARCHIVED") {
    const q = search?.trim();
    const rows = await this.database.client.series.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { slug: { contains: q, mode: "insensitive" } },
                { synopsis: { contains: q, mode: "insensitive" } },
                { genres: { some: { genre: { name: { contains: q, mode: "insensitive" } } } } },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: Math.min(Math.max(limit, 1), 100),
      include: seriesInclude,
    });
    return Promise.all(rows.map(async (row) => this.adminShape(await this.hydrate(row))));
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
    if (!isSeriesAvailableInTerritory(hydrated.availability, countryCode, now)) return null;
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
    const trailer = hydrated.trailerVideoId
      ? (hydrated.videoById.get(hydrated.trailerVideoId) ?? null)
      : null;
    const trailerDecision = trailer
      ? await this.videoPolicy.decide(trailer.id, { countryCode })
      : null;
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
      trailerVideo:
        trailer && trailerDecision?.allowed && isVideoRecordPublic(trailer)
          ? {
              id: trailer.id,
              title: trailer.title,
              slug: trailer.slug,
              durationMs: trailer.durationMs,
            }
          : null,
      availability: hydrated.availability,
      seasons,
      episodeCount: seasons.reduce((total, season) => total + season.episodes.length, 0),
      firstEpisode: seasons[0]?.episodes[0] ?? null,
    };
  }

  private async adminShape(hydrated: HydratedSeries) {
    const validation = await this.seriesValidation(hydrated);
    return {
      ...hydrated,
      trailerVideo: hydrated.trailerVideoId
        ? (hydrated.videoById.get(hydrated.trailerVideoId) ?? null)
        : null,
      validation,
      genres: hydrated.genres.map((item) => item.genre),
      artwork: hydrated.artwork.map((item) => ({
        ...item,
        asset: hydrated.assetById.get(item.mediaAssetId) ?? null,
      })),
      seasons: await Promise.all(
        hydrated.seasons.map(async (season) => ({
          ...season,
          artwork: season.artwork.map((item) => ({
            ...item,
            asset: hydrated.assetById.get(item.mediaAssetId) ?? null,
          })),
          episodes: await Promise.all(
            season.episodes.map(async (episode) => {
              const playable = episode.videoId
                ? Boolean(await this.catalogMedia.getPlayableVideo(episode.videoId))
                : false;
              const issues = [
                ...(!episode.title.trim() ? ["TITLE_REQUIRED"] : []),
                ...(!episode.synopsis.trim() ? ["SYNOPSIS_REQUIRED"] : []),
                ...(!episode.videoId ? ["VIDEO_REQUIRED"] : []),
                ...(episode.videoId && !playable ? ["VIDEO_UNAVAILABLE"] : []),
              ];
              return {
                ...episode,
                video: episode.videoId ? (hydrated.videoById.get(episode.videoId) ?? null) : null,
                validation: {
                  status: issues.length ? ("BLOCKED" as const) : ("READY" as const),
                  publishable: issues.length === 0,
                  issues,
                },
              };
            }),
          ),
        })),
      ),
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
    const videoIds = [
      ...(row.trailerVideoId ? [row.trailerVideoId] : []),
      ...row.seasons.flatMap((season) =>
        season.episodes.flatMap((episode) => (episode.videoId ? [episode.videoId] : [])),
      ),
    ];
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
      trailerVideoId: input.trailerVideoId ?? null,
      genres: uniqueTrimmed(input.genres),
      artwork: this.normalizeArtwork(input.artwork),
      availability: this.normalizeAvailability(input.availability ?? []),
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
    for (const item of artwork) {
      if (!(await this.catalogMedia.getArtworkAsset(item.mediaAssetId))) {
        throw catalogError(
          400,
          "ARTWORK_NOT_READY",
          "Artwork must reference a validated, non-removed image MediaAsset.",
        );
      }
    }
  }

  private async assertPlayableVideo(videoId: string | null, code: string, label: string) {
    if (!videoId) return;
    if (!(await this.catalogMedia.getPlayableVideo(videoId))) {
      throw catalogError(
        400,
        code,
        `${label} must reference an accessible published public Video with validated playback media.`,
      );
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

  private assertPublishedSeriesPatchSafe(
    current: SeriesWithRelations,
    patch: SeriesCatalogPatch,
    artwork: ReturnType<SeriesCatalogService["normalizeArtwork"]> | undefined,
    availability: ReturnType<SeriesCatalogService["normalizeAvailability"]> | undefined,
  ) {
    if (current.status !== "PUBLISHED") return;
    if (patch.genres && uniqueTrimmed(patch.genres).length === 0) {
      throw catalogError(
        409,
        "PUBLISHED_SERIES_GENRE_REQUIRED",
        "Published Series must keep at least one genre.",
      );
    }
    if (artwork && !artwork.some((item) => item.type === "POSTER")) {
      throw catalogError(
        409,
        "PUBLISHED_SERIES_POSTER_REQUIRED",
        "Published Series must keep poster artwork.",
      );
    }
    if (availability && availability.length > 0 && !hasActiveSeriesAllow(availability)) {
      throw catalogError(
        409,
        "PUBLISHED_SERIES_AVAILABILITY_REQUIRED",
        "Explicit Series availability must include an active ALLOW rule.",
      );
    }
  }

  private normalizeAvailability(items: SeriesAvailabilityInput[]) {
    return items.map((item) => {
      const territoryCode = normalizeSeriesTerritory(item.territoryCode);
      if (!territoryCode) {
        throw catalogError(
          400,
          "INVALID_TERRITORY",
          "Territory must be a two-letter country code or '*'.",
        );
      }
      if (item.startsAt && item.endsAt && item.endsAt <= item.startsAt) {
        throw catalogError(
          400,
          "INVALID_RIGHTS_WINDOW",
          "Availability end must be after its start.",
        );
      }
      return {
        territoryCode,
        rule: item.rule,
        startsAt: item.startsAt ?? null,
        endsAt: item.endsAt ?? null,
        note: cleanNullable(item.note),
      };
    });
  }

  private async seriesValidation(hydrated: HydratedSeries) {
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
    let playablePublishedEpisode = false;
    for (const episode of hydrated.seasons.flatMap((season) => season.episodes)) {
      if (
        episode.status === "PUBLISHED" &&
        episode.videoId &&
        (!episode.releaseDate || episode.releaseDate <= new Date()) &&
        (await this.catalogMedia.getPlayableVideo(episode.videoId))
      ) {
        playablePublishedEpisode = true;
        break;
      }
    }
    if (!playablePublishedEpisode) issues.push("PLAYABLE_PUBLISHED_EPISODE_REQUIRED");
    if (
      hydrated.trailerVideoId &&
      !(await this.catalogMedia.getPlayableVideo(hydrated.trailerVideoId))
    ) {
      issues.push("TRAILER_VIDEO_UNAVAILABLE");
    }
    if (hydrated.availability.length > 0 && !hasActiveSeriesAllow(hydrated.availability)) {
      issues.push("ACTIVE_AVAILABILITY_REQUIRED");
    }
    const uniqueIssues = [...new Set(issues)];
    return {
      status: uniqueIssues.length ? ("BLOCKED" as const) : ("READY" as const),
      publishable: uniqueIssues.length === 0,
      issues: uniqueIssues,
    };
  }

  private async assertSeasonSortOrderAvailable(
    seriesId: string,
    sortOrder: number,
    excludeId?: string,
  ) {
    const conflict = await this.database.client.seriesSeason.findFirst({
      where: { seriesId, sortOrder, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (conflict)
      throw catalogError(
        409,
        "SEASON_ORDER_CONFLICT",
        "Another season already uses that catalog order.",
      );
  }

  private async assertEpisodeSortOrderAvailable(
    seasonId: string,
    sortOrder: number,
    excludeId?: string,
  ) {
    const conflict = await this.database.client.seriesEpisode.findFirst({
      where: { seasonId, sortOrder, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (conflict)
      throw catalogError(
        409,
        "EPISODE_ORDER_CONFLICT",
        "Another episode already uses that catalog order.",
      );
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
  return Boolean(
    asset &&
    !asset.removedAt &&
    asset.status === "VALIDATED" &&
    asset.mimeType.toLowerCase().startsWith("image/"),
  );
}

function isVideoRecordPublic(video: VideoRecord) {
  return video.status === "PUBLISHED" && video.visibility === "PUBLIC" && !video.removedAt;
}

function normalizeSeriesTerritory(value: string) {
  const normalized = value.trim().toUpperCase();
  if (normalized === "*") return "*";
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function hasActiveSeriesAllow(
  items: ReadonlyArray<{ rule: string; startsAt: Date | null; endsAt: Date | null }>,
  now = new Date(),
) {
  return items.some(
    (item) =>
      item.rule === "ALLOW" &&
      (!item.startsAt || item.startsAt <= now) &&
      (!item.endsAt || item.endsAt > now),
  );
}

function isSeriesAvailableInTerritory(
  items: ReadonlyArray<{
    territoryCode: string;
    rule: string;
    startsAt: Date | null;
    endsAt: Date | null;
  }>,
  countryCode?: string,
  now = new Date(),
) {
  if (items.length === 0) return true;
  const active = items.filter(
    (item) => (!item.startsAt || item.startsAt <= now) && (!item.endsAt || item.endsAt > now),
  );
  const territory = countryCode ? normalizeSeriesTerritory(countryCode) : null;
  if (territory && territory !== "*") {
    const exact = active.filter((item) => item.territoryCode === territory);
    if (exact.length) {
      return (
        exact.some((item) => item.rule === "ALLOW") && !exact.some((item) => item.rule === "BLOCK")
      );
    }
  }
  const global = active.filter((item) => item.territoryCode === "*");
  return (
    global.some((item) => item.rule === "ALLOW") && !global.some((item) => item.rule === "BLOCK")
  );
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
