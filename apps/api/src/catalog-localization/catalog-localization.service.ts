import { HttpException, Inject, Injectable } from "@nestjs/common";

import { CatalogAdminMediaService } from "../admin/catalog-admin-media.service.js";
import { DatabaseService } from "../database/database.service.js";
import {
  CATALOG_GLOBAL_FALLBACK_LOCALE,
  compactDescription,
  normalizeCatalogLocale,
  resolveCatalogCopy,
  type CatalogLocalizationCopy,
} from "./catalog-localization.js";

export type CatalogEntityType = "MOVIE" | "SERIES" | "SEASON" | "EPISODE";

export interface CatalogLocalizationInput {
  title?: string | null;
  synopsis?: string | null;
  shortDescription?: string | null;
  posterMediaAssetId?: string | null;
  backdropMediaAssetId?: string | null;
}

type PublicArtwork = {
  mediaAssetId?: string;
  objectKey: string;
  mimeType?: string;
  width?: number | null;
  height?: number | null;
  altText?: string | null;
};

type LocalizableMovie = {
  id: string;
  title: string;
  synopsis?: string;
  poster?: PublicArtwork | null;
  backdrop?: PublicArtwork | null;
};

type LocalizableEpisode = {
  id: string;
  title: string;
  synopsis: string;
};

type LocalizableSeason = {
  id: string;
  title: string | null;
  episodes: LocalizableEpisode[];
};

type LocalizableSeries = {
  id: string;
  title: string;
  synopsis: string;
  artwork: Array<PublicArtwork & { type: string }>;
  seasons: LocalizableSeason[];
};

type ReadyAsset = {
  id: string;
  r2ObjectKey: string;
  mimeType: string;
  width: number | null;
  height: number | null;
};

@Injectable()
export class CatalogLocalizationService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CatalogAdminMediaService) private readonly catalogMedia: CatalogAdminMediaService,
  ) {}

  async localizeMovies<T extends LocalizableMovie>(items: T[], requestedLocale?: string | null) {
    if (!items.length) return items;
    const rows = await this.database.client.movieLocalization.findMany({
      where: { movieId: { in: items.map((item) => item.id) } },
      orderBy: [{ movieId: "asc" }, { locale: "asc" }],
    });
    const byMovie = new Map<string, typeof rows>();
    for (const row of rows) {
      const current = byMovie.get(row.movieId) ?? [];
      current.push(row);
      byMovie.set(row.movieId, current);
    }
    return Promise.all(
      items.map((item) => this.localizeMovieFromRows(item, byMovie.get(item.id) ?? [], requestedLocale)),
    );
  }

  async localizeMovie<T extends LocalizableMovie>(item: T, requestedLocale?: string | null) {
    const rows = await this.database.client.movieLocalization.findMany({
      where: { movieId: item.id },
      orderBy: { locale: "asc" },
    });
    return this.localizeMovieFromRows(item, rows, requestedLocale);
  }

  async localizeSeriesList<T extends LocalizableSeries>(items: T[], requestedLocale?: string | null) {
    return Promise.all(items.map((item) => this.localizeSeries(item, requestedLocale)));
  }

  async localizeSeries<T extends LocalizableSeries>(item: T, requestedLocale?: string | null) {
    const seasonIds = item.seasons.map((season) => season.id);
    const episodeIds = item.seasons.flatMap((season) => season.episodes.map((episode) => episode.id));
    const [seriesRows, seasonRows, episodeRows] = await Promise.all([
      this.database.client.seriesLocalization.findMany({
        where: { seriesId: item.id },
        orderBy: { locale: "asc" },
      }),
      seasonIds.length
        ? this.database.client.seriesSeasonLocalization.findMany({
            where: { seasonId: { in: seasonIds } },
            orderBy: [{ seasonId: "asc" }, { locale: "asc" }],
          })
        : [],
      episodeIds.length
        ? this.database.client.seriesEpisodeLocalization.findMany({
            where: { episodeId: { in: episodeIds } },
            orderBy: [{ episodeId: "asc" }, { locale: "asc" }],
          })
        : [],
    ]);
    const resolved = resolveCatalogCopy(
      requestedLocale,
      {
        title: item.title,
        synopsis: item.synopsis,
        shortDescription: compactDescription(item.synopsis),
      },
      seriesRows,
    );
    const locale = resolved.locale;
    const requestedRow = findLocale(seriesRows, locale);
    const englishRow = findLocale(seriesRows, CATALOG_GLOBAL_FALLBACK_LOCALE);
    const readyAssets = await this.readyAssets(
      [
        requestedRow?.posterMediaAssetId,
        requestedRow?.backdropMediaAssetId,
        englishRow?.posterMediaAssetId,
        englishRow?.backdropMediaAssetId,
      ].filter((value): value is string => Boolean(value)),
    );
    const artwork = [...item.artwork];
    this.replaceSeriesArtwork(
      artwork,
      "POSTER",
      this.pickArtwork(
        requestedRow?.posterMediaAssetId,
        artwork.find((entry) => entry.type === "POSTER") ?? null,
        englishRow?.posterMediaAssetId,
        readyAssets,
        resolved.title,
      ),
    );
    this.replaceSeriesArtwork(
      artwork,
      "BACKDROP",
      this.pickArtwork(
        requestedRow?.backdropMediaAssetId,
        artwork.find((entry) => entry.type === "BACKDROP") ?? null,
        englishRow?.backdropMediaAssetId,
        readyAssets,
        resolved.title,
      ),
    );

    const seasonRowsById = groupBy(seasonRows, (row) => row.seasonId);
    const episodeRowsById = groupBy(episodeRows, (row) => row.episodeId);
    const seasons = item.seasons.map((season) => {
      const localizedSeason = resolveCatalogCopy(
        locale,
        { title: season.title, shortDescription: null },
        seasonRowsById.get(season.id) ?? [],
      );
      return {
        ...season,
        title: localizedSeason.title,
        shortDescription: localizedSeason.shortDescription,
        localization: localizedSeason,
        episodes: season.episodes.map((episode) => {
          const localizedEpisode = resolveCatalogCopy(
            locale,
            {
              title: episode.title,
              synopsis: episode.synopsis,
              shortDescription: compactDescription(episode.synopsis),
            },
            episodeRowsById.get(episode.id) ?? [],
          );
          return {
            ...episode,
            title: localizedEpisode.title ?? episode.title,
            synopsis: localizedEpisode.synopsis ?? episode.synopsis,
            shortDescription: localizedEpisode.shortDescription,
            localization: localizedEpisode,
          };
        }),
      };
    });

    return {
      ...item,
      title: resolved.title ?? item.title,
      synopsis: resolved.synopsis ?? item.synopsis,
      shortDescription: resolved.shortDescription,
      artwork,
      seasons,
      locale,
      availableLocales: resolved.availableLocales,
      localization: resolved,
    };
  }

  async localizeSeriesContext<T extends {
    series: { id: string; title: string };
    season: { id: string; title: string | null };
    episode: LocalizableEpisode;
    nextEpisode: (LocalizableEpisode & { seasonNumber?: number }) | null;
  }>(context: T, requestedLocale?: string | null) {
    const locale = normalizeCatalogLocale(requestedLocale);
    const [seriesRows, seasonRows, episodeRows] = await Promise.all([
      this.database.client.seriesLocalization.findMany({ where: { seriesId: context.series.id } }),
      this.database.client.seriesSeasonLocalization.findMany({ where: { seasonId: context.season.id } }),
      this.database.client.seriesEpisodeLocalization.findMany({
        where: {
          episodeId: {
            in: [context.episode.id, ...(context.nextEpisode ? [context.nextEpisode.id] : [])],
          },
        },
      }),
    ]);
    const seriesCopy = resolveCatalogCopy(locale, { title: context.series.title }, seriesRows);
    const seasonCopy = resolveCatalogCopy(locale, { title: context.season.title }, seasonRows);
    const episodeById = groupBy(episodeRows, (row) => row.episodeId);
    const localizeEpisode = <E extends LocalizableEpisode>(episode: E) => {
      const copy = resolveCatalogCopy(
        locale,
        {
          title: episode.title,
          synopsis: episode.synopsis,
          shortDescription: compactDescription(episode.synopsis),
        },
        episodeById.get(episode.id) ?? [],
      );
      return {
        ...episode,
        title: copy.title ?? episode.title,
        synopsis: copy.synopsis ?? episode.synopsis,
        shortDescription: copy.shortDescription,
      };
    };
    return {
      ...context,
      series: { ...context.series, title: seriesCopy.title ?? context.series.title },
      season: { ...context.season, title: seasonCopy.title },
      episode: localizeEpisode(context.episode),
      nextEpisode: context.nextEpisode ? localizeEpisode(context.nextEpisode) : null,
      locale,
    };
  }

  async list(entityType: CatalogEntityType, entityId: string) {
    await this.assertEntity(entityType, entityId);
    switch (entityType) {
      case "MOVIE":
        return this.database.client.movieLocalization.findMany({
          where: { movieId: entityId },
          orderBy: { locale: "asc" },
        });
      case "SERIES":
        return this.database.client.seriesLocalization.findMany({
          where: { seriesId: entityId },
          orderBy: { locale: "asc" },
        });
      case "SEASON":
        return this.database.client.seriesSeasonLocalization.findMany({
          where: { seasonId: entityId },
          orderBy: { locale: "asc" },
        });
      case "EPISODE":
        return this.database.client.seriesEpisodeLocalization.findMany({
          where: { episodeId: entityId },
          orderBy: { locale: "asc" },
        });
    }
  }

  async upsert(
    entityType: CatalogEntityType,
    entityId: string,
    localeRaw: string,
    input: CatalogLocalizationInput,
  ) {
    await this.assertEntity(entityType, entityId);
    const locale = this.requireLocale(localeRaw);
    const data = {
      title: cleanNullable(input.title, 200),
      synopsis: cleanNullable(input.synopsis, 20_000),
      shortDescription: cleanNullable(input.shortDescription, 500),
    };
    if (entityType === "MOVIE" || entityType === "SERIES") {
      await this.assertArtworkOverride(input.posterMediaAssetId);
      await this.assertArtworkOverride(input.backdropMediaAssetId);
    }
    switch (entityType) {
      case "MOVIE":
        return this.database.client.movieLocalization.upsert({
          where: { movieId_locale: { movieId: entityId, locale } },
          update: {
            ...data,
            posterMediaAssetId: input.posterMediaAssetId ?? null,
            backdropMediaAssetId: input.backdropMediaAssetId ?? null,
          },
          create: {
            movieId: entityId,
            locale,
            ...data,
            posterMediaAssetId: input.posterMediaAssetId ?? null,
            backdropMediaAssetId: input.backdropMediaAssetId ?? null,
          },
        });
      case "SERIES":
        return this.database.client.seriesLocalization.upsert({
          where: { seriesId_locale: { seriesId: entityId, locale } },
          update: {
            ...data,
            posterMediaAssetId: input.posterMediaAssetId ?? null,
            backdropMediaAssetId: input.backdropMediaAssetId ?? null,
          },
          create: {
            seriesId: entityId,
            locale,
            ...data,
            posterMediaAssetId: input.posterMediaAssetId ?? null,
            backdropMediaAssetId: input.backdropMediaAssetId ?? null,
          },
        });
      case "SEASON":
        if (data.synopsis) {
          throw localizationError(400, "SEASON_SYNOPSIS_UNSUPPORTED", "Season localization does not store a synopsis.");
        }
        return this.database.client.seriesSeasonLocalization.upsert({
          where: { seasonId_locale: { seasonId: entityId, locale } },
          update: { title: data.title, shortDescription: data.shortDescription },
          create: {
            seasonId: entityId,
            locale,
            title: data.title,
            shortDescription: data.shortDescription,
          },
        });
      case "EPISODE":
        return this.database.client.seriesEpisodeLocalization.upsert({
          where: { episodeId_locale: { episodeId: entityId, locale } },
          update: data,
          create: { episodeId: entityId, locale, ...data },
        });
    }
  }

  async remove(entityType: CatalogEntityType, entityId: string, localeRaw: string) {
    await this.assertEntity(entityType, entityId);
    const locale = this.requireLocale(localeRaw);
    switch (entityType) {
      case "MOVIE":
        await this.database.client.movieLocalization.deleteMany({ where: { movieId: entityId, locale } });
        break;
      case "SERIES":
        await this.database.client.seriesLocalization.deleteMany({ where: { seriesId: entityId, locale } });
        break;
      case "SEASON":
        await this.database.client.seriesSeasonLocalization.deleteMany({ where: { seasonId: entityId, locale } });
        break;
      case "EPISODE":
        await this.database.client.seriesEpisodeLocalization.deleteMany({ where: { episodeId: entityId, locale } });
        break;
    }
    return { removed: true, entityType, entityId, locale };
  }

  private async localizeMovieFromRows<T extends LocalizableMovie>(
    item: T,
    rows: Array<CatalogLocalizationCopy & {
      posterMediaAssetId?: string | null;
      backdropMediaAssetId?: string | null;
    }>,
    requestedLocale?: string | null,
  ) {
    const resolved = resolveCatalogCopy(
      requestedLocale,
      {
        title: item.title,
        synopsis: item.synopsis ?? null,
        shortDescription: compactDescription(item.synopsis),
      },
      rows,
    );
    const requestedRow = findLocale(rows, resolved.locale);
    const englishRow = findLocale(rows, CATALOG_GLOBAL_FALLBACK_LOCALE);
    const readyAssets = await this.readyAssets(
      [
        requestedRow?.posterMediaAssetId,
        requestedRow?.backdropMediaAssetId,
        englishRow?.posterMediaAssetId,
        englishRow?.backdropMediaAssetId,
      ].filter((value): value is string => Boolean(value)),
    );
    return {
      ...item,
      title: resolved.title ?? item.title,
      ...(item.synopsis !== undefined ? { synopsis: resolved.synopsis ?? item.synopsis } : {}),
      shortDescription: resolved.shortDescription,
      poster: this.pickArtwork(
        requestedRow?.posterMediaAssetId,
        item.poster ?? null,
        englishRow?.posterMediaAssetId,
        readyAssets,
        resolved.title,
      ),
      backdrop: this.pickArtwork(
        requestedRow?.backdropMediaAssetId,
        item.backdrop ?? null,
        englishRow?.backdropMediaAssetId,
        readyAssets,
        resolved.title,
      ),
      locale: resolved.locale,
      availableLocales: resolved.availableLocales,
      localization: resolved,
    };
  }

  private async readyAssets(ids: string[]) {
    if (!ids.length) return new Map<string, ReadyAsset>();
    const assets = await this.database.client.mediaAsset.findMany({
      where: {
        id: { in: [...new Set(ids)] },
        removedAt: null,
        status: "VALIDATED",
        mimeType: { startsWith: "image/", mode: "insensitive" },
      },
      select: {
        id: true,
        r2ObjectKey: true,
        mimeType: true,
        width: true,
        height: true,
      },
    });
    return new Map(assets.map((asset) => [asset.id, asset]));
  }

  private pickArtwork(
    requestedId: string | null | undefined,
    primary: PublicArtwork | null,
    englishId: string | null | undefined,
    assets: Map<string, ReadyAsset>,
    title: string | null,
  ): PublicArtwork | null {
    const requested = requestedId ? assets.get(requestedId) : null;
    if (requested) return toPublicAsset(requested, title);
    if (primary) return primary;
    const english = englishId ? assets.get(englishId) : null;
    return english ? toPublicAsset(english, title) : null;
  }

  private replaceSeriesArtwork(
    artwork: Array<PublicArtwork & { type: string }>,
    type: "POSTER" | "BACKDROP",
    replacement: PublicArtwork | null,
  ) {
    if (!replacement) return;
    const next = { ...replacement, type };
    const index = artwork.findIndex((item) => item.type === type);
    if (index >= 0) artwork[index] = next;
    else artwork.push(next);
  }

  private requireLocale(localeRaw: string) {
    const raw = localeRaw.trim().replace(/_/g, "-").toLowerCase();
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(raw)) {
      throw localizationError(400, "INVALID_CATALOG_LOCALE", "Catalog locale is invalid.");
    }
    return raw;
  }

  private async assertArtworkOverride(assetId?: string | null) {
    if (!assetId) return;
    if (!(await this.catalogMedia.getArtworkAsset(assetId))) {
      throw localizationError(
        400,
        "LOCALIZED_ARTWORK_NOT_READY",
        "Localized artwork must reference a validated, non-removed image MediaAsset.",
      );
    }
  }

  private async assertEntity(entityType: CatalogEntityType, entityId: string) {
    const exists =
      entityType === "MOVIE"
        ? await this.database.client.movie.findUnique({ where: { id: entityId }, select: { id: true } })
        : entityType === "SERIES"
          ? await this.database.client.series.findUnique({ where: { id: entityId }, select: { id: true } })
          : entityType === "SEASON"
            ? await this.database.client.seriesSeason.findUnique({ where: { id: entityId }, select: { id: true } })
            : await this.database.client.seriesEpisode.findUnique({ where: { id: entityId }, select: { id: true } });
    if (!exists) throw localizationError(404, "CATALOG_ENTITY_NOT_FOUND", "Catalog entity was not found.");
  }
}

function cleanNullable(value: string | null | undefined, maxLength: number) {
  if (value === undefined || value === null) return null;
  const clean = value.trim();
  if (!clean) return null;
  if (clean.length > maxLength) {
    throw localizationError(400, "LOCALIZED_FIELD_TOO_LONG", `Localized field exceeds ${maxLength} characters.`);
  }
  return clean;
}

function findLocale<T extends { locale: string }>(rows: T[], locale: string) {
  return rows.find((row) => normalizeCatalogLocale(row.locale) === locale);
}

function groupBy<T, K>(items: T[], key: (item: T) => K) {
  const result = new Map<K, T[]>();
  for (const item of items) {
    const value = key(item);
    const current = result.get(value) ?? [];
    current.push(item);
    result.set(value, current);
  }
  return result;
}

function toPublicAsset(asset: ReadyAsset, title: string | null): PublicArtwork {
  return {
    mediaAssetId: asset.id,
    objectKey: asset.r2ObjectKey,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    altText: title,
  };
}

function localizationError(status: number, code: string, message: string) {
  return new HttpException({ error: { code, message } }, status);
}
