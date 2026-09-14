import { HttpException, Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { VideoPolicyService } from "../video-policy/video-policy.service.js";
import {
  isMovieAvailableInTerritory,
  isSafeMovieSlug,
  moviePublishIssues,
  normalizeMovieSlug,
  normalizeTerritoryCode,
  type MovieArtworkTypeValue,
  type MovieAvailabilityRuleValue,
} from "./movie-catalog.policy.js";

export interface MovieArtworkInput {
  type: MovieArtworkTypeValue;
  mediaAssetId: string;
  altText?: string | null;
}

export interface MovieAvailabilityInput {
  territoryCode: string;
  rule: MovieAvailabilityRuleValue;
  startsAt?: Date | null;
  endsAt?: Date | null;
  note?: string | null;
}

export interface MovieLocalizationInput {
  locale: string;
  title?: string | null;
  synopsis?: string | null;
}

export interface MovieCatalogInput {
  title: string;
  slug?: string;
  synopsis: string;
  releaseDate?: Date | null;
  releaseYear: number;
  runtimeMinutes: number;
  maturityRating: string;
  originalLanguage: string;
  primaryVideoId?: string | null;
  trailerVideoId?: string | null;
  genres: string[];
  artwork: MovieArtworkInput[];
  availability: MovieAvailabilityInput[];
  localizations?: MovieLocalizationInput[];
}

export interface MovieCatalogPatch extends Partial<
  Omit<MovieCatalogInput, "genres" | "artwork" | "availability" | "localizations">
> {
  genres?: string[];
  artwork?: MovieArtworkInput[];
  availability?: MovieAvailabilityInput[];
  localizations?: MovieLocalizationInput[];
}

@Injectable()
export class MovieCatalogService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,
  ) {}

  async create(input: MovieCatalogInput) {
    const normalized = this.normalizeInput(input);
    await this.assertReferencedMedia(
      normalized.primaryVideoId,
      normalized.trailerVideoId,
      normalized.artwork,
    );

    try {
      const movie = await this.database.client.$transaction(async (tx) => {
        const genres = [];
        for (const name of normalized.genres) {
          const slug = normalizeMovieSlug(name);
          if (!slug)
            throw movieError(400, "INVALID_GENRE", "Every genre must contain a safe name.");
          genres.push(
            await tx.movieGenre.upsert({
              where: { slug },
              update: { name },
              create: { slug, name },
            }),
          );
        }
        return tx.movie.create({
          data: {
            title: normalized.title,
            slug: normalized.slug,
            synopsis: normalized.synopsis,
            releaseDate: normalized.releaseDate,
            releaseYear: normalized.releaseYear,
            runtimeMinutes: normalized.runtimeMinutes,
            maturityRating: normalized.maturityRating,
            originalLanguage: normalized.originalLanguage,
            primaryVideoId: normalized.primaryVideoId,
            trailerVideoId: normalized.trailerVideoId,
            genres: {
              create: genres.map((genre, position) => ({ genreId: genre.id, position })),
            },
            artwork: { create: normalized.artwork },
            availability: { create: normalized.availability },
            localizations: { create: normalized.localizations },
          },
        });
      });
      return this.getAdminById(movie.id);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isUniqueConstraint(error))
        throw movieError(409, "MOVIE_SLUG_CONFLICT", "That movie slug is already in use.");
      throw error;
    }
  }

  async update(movieId: string, patch: MovieCatalogPatch) {
    const current = await this.getAdminRow(movieId);
    if (!current) throw movieError(404, "MOVIE_NOT_FOUND", "This movie does not exist.");
    if (current.status === "ARCHIVED")
      throw movieError(409, "MOVIE_ARCHIVED", "Archived movies cannot be edited.");

    const scalar = this.normalizePatch(current, patch);
    const artwork = patch.artwork ? this.normalizeArtwork(patch.artwork) : undefined;
    const availability = patch.availability
      ? this.normalizeAvailability(patch.availability)
      : undefined;
    const localizations = patch.localizations
      ? this.normalizeLocalizations(patch.localizations)
      : undefined;
    await this.assertReferencedMedia(
      scalar.primaryVideoId ?? current.primaryVideoId,
      scalar.trailerVideoId ?? current.trailerVideoId,
      artwork ??
        current.artwork.map((item) => ({
          type: item.type,
          mediaAssetId: item.mediaAssetId,
          altText: item.altText,
        })),
    );

    try {
      await this.database.client.$transaction(async (tx) => {
        await tx.movie.update({ where: { id: movieId }, data: scalar });
        if (patch.genres) {
          await tx.movieGenreAssignment.deleteMany({ where: { movieId } });
          let position = 0;
          for (const nameRaw of uniqueTrimmed(patch.genres)) {
            const slug = normalizeMovieSlug(nameRaw);
            if (!slug)
              throw movieError(400, "INVALID_GENRE", "Every genre must contain a safe name.");
            const genre = await tx.movieGenre.upsert({
              where: { slug },
              update: { name: nameRaw },
              create: { slug, name: nameRaw },
            });
            await tx.movieGenreAssignment.create({
              data: { movieId, genreId: genre.id, position },
            });
            position += 1;
          }
        }
        if (artwork) {
          await tx.movieArtwork.deleteMany({ where: { movieId } });
          if (artwork.length)
            await tx.movieArtwork.createMany({
              data: artwork.map((item) => ({ movieId, ...item })),
            });
        }
        if (availability) {
          await tx.movieAvailability.deleteMany({ where: { movieId } });
          if (availability.length)
            await tx.movieAvailability.createMany({
              data: availability.map((item) => ({ movieId, ...item })),
            });
        }
        if (localizations) {
          await tx.movieLocalization.deleteMany({ where: { movieId } });
          if (localizations.length)
            await tx.movieLocalization.createMany({
              data: localizations.map((item) => ({ movieId, ...item })),
            });
        }
      });
      return this.getAdminById(movieId);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isUniqueConstraint(error))
        throw movieError(409, "MOVIE_SLUG_CONFLICT", "That movie slug is already in use.");
      throw error;
    }
  }

  async publish(movieId: string) {
    const movie = await this.getAdminById(movieId);
    const issues = moviePublishIssues({
      ...movie,
      artwork: movie.artwork.map((item) => ({
        type: item.type,
        assetReady: item.asset?.status === "VALIDATED" && !item.asset.removedAt,
      })),
    });
    if (issues.length) {
      throw movieError(409, "MOVIE_NOT_PUBLISHABLE", "Movie is missing required publish data.", {
        issues,
      });
    }
    await this.database.client.movie.update({
      where: { id: movieId },
      data: { status: "PUBLISHED", publishedAt: movie.publishedAt ?? new Date() },
    });
    return this.getAdminById(movieId);
  }

  async unpublish(movieId: string) {
    await this.requireMovie(movieId);
    await this.database.client.movie.update({
      where: { id: movieId },
      data: { status: "DRAFT", publishedAt: null },
    });
    return this.getAdminById(movieId);
  }

  async archive(movieId: string) {
    await this.requireMovie(movieId);
    await this.database.client.movie.update({
      where: { id: movieId },
      data: { status: "ARCHIVED", publishedAt: null },
    });
    return this.getAdminById(movieId);
  }

  async listAdmin(limit = 50) {
    const rows = await this.database.client.movie.findMany({
      take: Math.min(Math.max(limit, 1), 100),
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: {
        genres: { include: { genre: true } },
        artwork: true,
        availability: true,
        localizations: true,
      },
    });
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async getAdminById(movieId: string) {
    const row = await this.getAdminRow(movieId);
    if (!row) throw movieError(404, "MOVIE_NOT_FOUND", "This movie does not exist.");
    return this.hydrate(row);
  }

  async getPublicBySlug(slugRaw: string, countryCode?: string | null) {
    if (!isSafeMovieSlug(slugRaw)) return null;
    const row = await this.database.client.movie.findUnique({
      where: { slug: slugRaw },
      include: {
        genres: { include: { genre: true } },
        artwork: true,
        availability: true,
        localizations: true,
      },
    });
    if (!row || row.status !== "PUBLISHED" || !row.primaryVideoId) return null;
    const hydrated = await this.hydrate(row);
    if (!this.isPubliclyAvailable(hydrated, countryCode)) return null;
    const videoDecision = await this.videoPolicy.decide(row.primaryVideoId, {
      countryCode: countryCode ?? undefined,
    });
    if (!videoDecision.allowed) return null;
    return toPublicMovie(hydrated);
  }

  async listPublic(countryCode?: string | null, limit = 24) {
    const rows = await this.database.client.movie.findMany({
      where: { status: "PUBLISHED", primaryVideoId: { not: null } },
      take: Math.min(Math.max(limit * 3, limit), 72),
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      include: {
        genres: { include: { genre: true } },
        artwork: true,
        availability: true,
        localizations: true,
      },
    });
    const hydrated = await Promise.all(rows.map((row) => this.hydrate(row)));
    const rightsVisible = hydrated.filter((movie) => this.isPubliclyAvailable(movie, countryCode));
    const ids = rightsVisible
      .map((movie) => movie.primaryVideoId)
      .filter((value): value is string => Boolean(value));
    const videoDecisions = await this.videoPolicy.decideMany(ids, {
      countryCode: countryCode ?? undefined,
    });
    return rightsVisible
      .filter((movie) => movie.primaryVideoId && videoDecisions.get(movie.primaryVideoId)?.allowed)
      .slice(0, limit)
      .map(toPublicMovieCard);
  }

  private async getAdminRow(movieId: string) {
    return this.database.client.movie.findUnique({
      where: { id: movieId },
      include: {
        genres: { include: { genre: true } },
        artwork: true,
        availability: true,
        localizations: true,
      },
    });
  }

  private async hydrate<T extends Awaited<ReturnType<MovieCatalogService["getAdminRow"]>>>(
    row: NonNullable<T>,
  ) {
    const videoIds = [row.primaryVideoId, row.trailerVideoId].filter((value): value is string =>
      Boolean(value),
    );
    const assetIds = row.artwork.map((item) => item.mediaAssetId);
    const [videos, assets] = await Promise.all([
      videoIds.length
        ? this.database.client.video.findMany({
            where: { id: { in: videoIds } },
            select: {
              id: true,
              slug: true,
              title: true,
              status: true,
              visibility: true,
              durationMs: true,
            },
          })
        : [],
      assetIds.length
        ? this.database.client.mediaAsset.findMany({
            where: { id: { in: assetIds } },
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
    ]);
    const videosById = new Map(videos.map((video) => [video.id, video]));
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    return {
      ...row,
      primaryVideo: row.primaryVideoId ? (videosById.get(row.primaryVideoId) ?? null) : null,
      trailerVideo: row.trailerVideoId ? (videosById.get(row.trailerVideoId) ?? null) : null,
      genres: row.genres.sort((a, b) => a.position - b.position).map((item) => item.genre),
      artwork: row.artwork.map((item) => ({
        ...item,
        asset: assetsById.get(item.mediaAssetId) ?? null,
      })),
    };
  }

  private isPubliclyAvailable(
    movie: Awaited<ReturnType<MovieCatalogService["getAdminById"]>>,
    countryCode?: string | null,
  ) {
    return Boolean(
      movie.primaryVideo?.status === "PUBLISHED" &&
      movie.primaryVideo.visibility === "PUBLIC" &&
      isMovieAvailableInTerritory(movie.availability, countryCode),
    );
  }

  private normalizeInput(input: MovieCatalogInput) {
    const slug = normalizeMovieSlug(input.slug?.trim() || input.title);
    if (!isSafeMovieSlug(slug))
      throw movieError(400, "INVALID_MOVIE_SLUG", "A safe ASCII movie slug is required.");
    return {
      title: requiredText(input.title, "title", 200),
      slug,
      synopsis: requiredText(input.synopsis, "synopsis", 20_000),
      releaseDate: input.releaseDate ?? null,
      releaseYear: checkedInteger(input.releaseYear, "releaseYear", 1888, 2200),
      runtimeMinutes: checkedInteger(input.runtimeMinutes, "runtimeMinutes", 1, 1440),
      maturityRating: requiredText(input.maturityRating, "maturityRating", 32),
      originalLanguage: requiredText(input.originalLanguage, "originalLanguage", 16).toLowerCase(),
      primaryVideoId: input.primaryVideoId ?? null,
      trailerVideoId: input.trailerVideoId ?? null,
      genres: uniqueTrimmed(input.genres),
      artwork: this.normalizeArtwork(input.artwork),
      availability: this.normalizeAvailability(input.availability),
      localizations: this.normalizeLocalizations(input.localizations ?? []),
    };
  }

  private normalizePatch(current: { title: string; slug: string }, patch: MovieCatalogPatch) {
    const data: Record<string, unknown> = {};
    if (patch.title !== undefined) data.title = requiredText(patch.title, "title", 200);
    if (patch.slug !== undefined) {
      const slug = normalizeMovieSlug(patch.slug);
      if (!isSafeMovieSlug(slug))
        throw movieError(400, "INVALID_MOVIE_SLUG", "A safe ASCII movie slug is required.");
      data.slug = slug;
    }
    if (patch.synopsis !== undefined)
      data.synopsis = requiredText(patch.synopsis, "synopsis", 20_000);
    if (patch.releaseDate !== undefined) data.releaseDate = patch.releaseDate;
    if (patch.releaseYear !== undefined)
      data.releaseYear = checkedInteger(patch.releaseYear, "releaseYear", 1888, 2200);
    if (patch.runtimeMinutes !== undefined)
      data.runtimeMinutes = checkedInteger(patch.runtimeMinutes, "runtimeMinutes", 1, 1440);
    if (patch.maturityRating !== undefined)
      data.maturityRating = requiredText(patch.maturityRating, "maturityRating", 32);
    if (patch.originalLanguage !== undefined)
      data.originalLanguage = requiredText(
        patch.originalLanguage,
        "originalLanguage",
        16,
      ).toLowerCase();
    if (patch.primaryVideoId !== undefined) data.primaryVideoId = patch.primaryVideoId;
    if (patch.trailerVideoId !== undefined) data.trailerVideoId = patch.trailerVideoId;
    void current;
    return data;
  }

  private normalizeArtwork(items: MovieArtworkInput[]) {
    const seen = new Set<string>();
    return items.map((item) => {
      if (seen.has(item.type))
        throw movieError(400, "DUPLICATE_ARTWORK_TYPE", `Artwork type ${item.type} is duplicated.`);
      seen.add(item.type);
      return {
        type: item.type,
        mediaAssetId: item.mediaAssetId,
        altText: item.altText?.trim() || null,
      };
    });
  }

  private normalizeAvailability(items: MovieAvailabilityInput[]) {
    return items.map((item) => {
      const territoryCode = normalizeTerritoryCode(item.territoryCode);
      if (!territoryCode)
        throw movieError(
          400,
          "INVALID_TERRITORY",
          "Territory must be a two-letter country code or '*'.",
        );
      if (item.startsAt && item.endsAt && item.endsAt <= item.startsAt)
        throw movieError(
          400,
          "INVALID_RIGHTS_WINDOW",
          "Rights window end must be after its start.",
        );
      return {
        territoryCode,
        rule: item.rule,
        startsAt: item.startsAt ?? null,
        endsAt: item.endsAt ?? null,
        note: item.note?.trim() || null,
      };
    });
  }

  private normalizeLocalizations(items: MovieLocalizationInput[]) {
    const seen = new Set<string>();
    return items.map((item) => {
      const locale = item.locale.trim().replace(/_/g, "-");
      if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) || seen.has(locale.toLowerCase()))
        throw movieError(
          400,
          "INVALID_MOVIE_LOCALE",
          "Movie localization locale is invalid or duplicated.",
        );
      seen.add(locale.toLowerCase());
      return { locale, title: item.title?.trim() || null, synopsis: item.synopsis?.trim() || null };
    });
  }

  private async assertReferencedMedia(
    primaryVideoId: string | null,
    trailerVideoId: string | null,
    artwork: MovieArtworkInput[],
  ) {
    const videoIds = [
      ...new Set(
        [primaryVideoId, trailerVideoId].filter((value): value is string => Boolean(value)),
      ),
    ];
    if (videoIds.length) {
      const count = await this.database.client.video.count({ where: { id: { in: videoIds } } });
      if (count !== videoIds.length)
        throw movieError(
          400,
          "VIDEO_REFERENCE_NOT_FOUND",
          "One or more referenced videos do not exist.",
        );
    }
    const assetIds = [...new Set(artwork.map((item) => item.mediaAssetId))];
    if (assetIds.length) {
      const count = await this.database.client.mediaAsset.count({
        where: { id: { in: assetIds }, removedAt: null },
      });
      if (count !== assetIds.length)
        throw movieError(
          400,
          "ARTWORK_ASSET_NOT_FOUND",
          "One or more artwork MediaAssets do not exist.",
        );
    }
  }

  private async requireMovie(movieId: string) {
    const movie = await this.database.client.movie.findUnique({
      where: { id: movieId },
      select: { id: true },
    });
    if (!movie) throw movieError(404, "MOVIE_NOT_FOUND", "This movie does not exist.");
    return movie;
  }
}

function toPublicMovie(movie: Awaited<ReturnType<MovieCatalogService["getAdminById"]>>) {
  return {
    ...toPublicMovieCard(movie),
    synopsis: movie.synopsis,
    releaseDate: movie.releaseDate,
    maturityRating: movie.maturityRating,
    originalLanguage: movie.originalLanguage,
    primaryVideo: movie.primaryVideo
      ? {
          id: movie.primaryVideo.id,
          slug: movie.primaryVideo.slug,
          durationMs: movie.primaryVideo.durationMs,
        }
      : null,
    trailerVideo:
      movie.trailerVideo?.status === "PUBLISHED" && movie.trailerVideo.visibility === "PUBLIC"
        ? {
            id: movie.trailerVideo.id,
            slug: movie.trailerVideo.slug,
            durationMs: movie.trailerVideo.durationMs,
          }
        : null,
    localizations: movie.localizations.map((item) => ({
      locale: item.locale,
      title: item.title,
      synopsis: item.synopsis,
    })),
  };
}

function toPublicMovieCard(movie: Awaited<ReturnType<MovieCatalogService["getAdminById"]>>) {
  return {
    id: movie.id,
    title: movie.title,
    slug: movie.slug,
    releaseYear: movie.releaseYear,
    runtimeMinutes: movie.runtimeMinutes,
    genres: movie.genres.map((genre) => ({ name: genre.name, slug: genre.slug })),
    poster: publicArtwork(movie.artwork.find((item) => item.type === "POSTER") ?? null),
    backdrop: publicArtwork(movie.artwork.find((item) => item.type === "BACKDROP") ?? null),
  };
}

function publicArtwork(
  item: Awaited<ReturnType<MovieCatalogService["getAdminById"]>>["artwork"][number] | null,
) {
  if (!item?.asset || item.asset.status !== "VALIDATED" || item.asset.removedAt) return null;
  return {
    mediaAssetId: item.mediaAssetId,
    objectKey: item.asset.r2ObjectKey,
    mimeType: item.asset.mimeType,
    width: item.asset.width,
    height: item.asset.height,
    altText: item.altText,
  };
}

function requiredText(value: string, field: string, maxLength: number) {
  const result = value.trim();
  if (!result || result.length > maxLength)
    throw movieError(
      400,
      "INVALID_MOVIE_FIELD",
      `${field} is required and must be at most ${maxLength} characters.`,
    );
  return result;
}

function checkedInteger(value: number, field: string, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw movieError(
      400,
      "INVALID_MOVIE_FIELD",
      `${field} must be an integer between ${min} and ${max}.`,
    );
  return value;
}

function uniqueTrimmed(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isUniqueConstraint(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002",
  );
}

function movieError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
) {
  return new HttpException({ error: { code, message, ...extra } }, status);
}
