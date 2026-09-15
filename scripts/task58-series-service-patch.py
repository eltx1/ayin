from pathlib import Path

path = Path("apps/api/src/series-catalog/series-catalog.service.ts")
text = path.read_text()


def rep(old: str, new: str, count: int = 1):
    global text
    if old not in text:
        raise SystemExit(f"series marker missing: {old[:140]!r}")
    text = text.replace(old, new, count)

rep(
    'import { DatabaseService } from "../database/database.service.js";\n',
    'import { CatalogAdminMediaService } from "../admin/catalog-admin-media.service.js";\nimport { DatabaseService } from "../database/database.service.js";\n',
)
rep(
    '''export interface SeriesCatalogInput {
  title: string;
  slug?: string | undefined;
  synopsis: string;
  releaseYear?: number | null | undefined;
  maturityRating: string;
  originalLanguage: string;
  genres: string[];
  artwork: SeriesArtworkInput[];
}''',
    '''export interface SeriesAvailabilityInput {
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
}''',
)
rep(
    '''export interface SeriesCatalogPatch {
  title?: string | undefined;
  slug?: string | undefined;
  synopsis?: string | undefined;
  releaseYear?: number | null | undefined;
  maturityRating?: string | undefined;
  originalLanguage?: string | undefined;
  genres?: string[] | undefined;
  artwork?: SeriesArtworkInput[] | undefined;
}''',
    '''export interface SeriesCatalogPatch {
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
}''',
)
rep(
    '''const seriesInclude = {
  genres: { include: { genre: true }, orderBy: { position: "asc" } },
  artwork: true,
  seasons:''',
    '''const seriesInclude = {
  genres: { include: { genre: true }, orderBy: { position: "asc" } },
  artwork: true,
  availability: true,
  seasons:''',
)
rep(
    '''  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,
  ) {}''',
    '''  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,
    @Inject(CatalogAdminMediaService) private readonly catalogMedia: CatalogAdminMediaService,
  ) {}''',
)
rep(
    '''    const normalized = this.normalizeSeries(input);
    await this.assertArtwork(normalized.artwork);
    try {''',
    '''    const normalized = this.normalizeSeries(input);
    await this.assertArtwork(normalized.artwork);
    await this.assertPlayableVideo(normalized.trailerVideoId, "TRAILER_VIDEO_NOT_PLAYABLE", "Trailer");
    try {''',
)
rep(
    '''            maturityRating: normalized.maturityRating,
            originalLanguage: normalized.originalLanguage,
          },
        });
        await this.replaceGenres(tx, series.id, normalized.genres);
        if (normalized.artwork.length) {''',
    '''            maturityRating: normalized.maturityRating,
            originalLanguage: normalized.originalLanguage,
            trailerVideoId: normalized.trailerVideoId,
            availability: { create: normalized.availability },
          },
        });
        await this.replaceGenres(tx, series.id, normalized.genres);
        if (normalized.artwork.length) {''',
)
rep(
    '''    const artwork = patch.artwork ? this.normalizeArtwork(patch.artwork) : undefined;
    if (artwork) await this.assertArtwork(artwork);
    const title = patch.title?.trim();''',
    '''    const artwork = patch.artwork ? this.normalizeArtwork(patch.artwork) : undefined;
    if (artwork) await this.assertArtwork(artwork);
    const availability = patch.availability
      ? this.normalizeAvailability(patch.availability)
      : undefined;
    if (patch.trailerVideoId !== undefined) {
      await this.assertPlayableVideo(patch.trailerVideoId, "TRAILER_VIDEO_NOT_PLAYABLE", "Trailer");
    }
    this.assertPublishedSeriesPatchSafe(current, patch, artwork, availability);
    const title = patch.title?.trim();''',
)
rep(
    '''            ...(patch.originalLanguage !== undefined
              ? { originalLanguage: patch.originalLanguage.trim().toLowerCase() }
              : {}),
          },
        });''',
    '''            ...(patch.originalLanguage !== undefined
              ? { originalLanguage: patch.originalLanguage.trim().toLowerCase() }
              : {}),
            ...(patch.trailerVideoId !== undefined
              ? { trailerVideoId: patch.trailerVideoId }
              : {}),
          },
        });''',
)
rep(
    '''        if (artwork) {
          await tx.seriesArtwork.deleteMany({ where: { seriesId } });
          if (artwork.length) {
            await tx.seriesArtwork.createMany({
              data: artwork.map((item) => ({ seriesId, ...item })),
            });
          }
        }
      });''',
    '''        if (artwork) {
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
      });''',
    1,
)
rep(
    '''    const sortOrder = input.sortOrder ?? (await this.nextSeasonSortOrder(seriesId));
    try {''',
    '''    const sortOrder = input.sortOrder ?? (await this.nextSeasonSortOrder(seriesId));
    await this.assertSeasonSortOrderAvailable(seriesId, sortOrder);
    try {''',
)
rep(
    '''    const artwork = patch.artwork ? this.normalizeArtwork(patch.artwork) : undefined;
    if (artwork) await this.assertArtwork(artwork);
    try {''',
    '''    const artwork = patch.artwork ? this.normalizeArtwork(patch.artwork) : undefined;
    if (artwork) await this.assertArtwork(artwork);
    if (patch.sortOrder !== undefined) {
      await this.assertSeasonSortOrderAvailable(season.seriesId, patch.sortOrder, seasonId);
    }
    try {''',
    1,
)
rep(
    '''    const existing = await this.database.client.seriesSeason.findMany({
      where: { seriesId },
      select: { id: true },
    });''',
    '''    const existing = await this.database.client.seriesSeason.findMany({
      where: { seriesId },
      select: { id: true, sortOrder: true },
    });''',
)
rep(
    '''    await this.database.client.$transaction(
      orderedIds.map((id, index) =>
        this.database.client.seriesSeason.update({
          where: { id },
          data: { sortOrder: index * 10 },
        }),
      ),
    );''',
    '''    const maxOrder = existing.reduce((max, item) => Math.max(max, item.sortOrder), 0);
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
    });''',
    1,
)
rep(
    '''    await this.assertEditableSeries(season.seriesId);
    await this.assertVideoExists(input.videoId ?? null);
    const sortOrder = input.sortOrder ?? (await this.nextEpisodeSortOrder(seasonId));''',
    '''    await this.assertEditableSeries(season.seriesId);
    await this.assertPlayableVideo(input.videoId ?? null, "EPISODE_VIDEO_NOT_PLAYABLE", "Episode playback");
    const sortOrder = input.sortOrder ?? (await this.nextEpisodeSortOrder(seasonId));
    await this.assertEpisodeSortOrderAvailable(seasonId, sortOrder);''',
)
rep(
    '''    await this.assertEditableSeries(episode.season.seriesId);
    if (patch.videoId !== undefined) await this.assertVideoExists(patch.videoId);
    try {''',
    '''    await this.assertEditableSeries(episode.season.seriesId);
    if (episode.status === "PUBLISHED" && patch.videoId === null) {
      throw catalogError(409, "PUBLISHED_EPISODE_VIDEO_REQUIRED", "Unpublish the episode before removing its playable Video.");
    }
    if (patch.videoId !== undefined) {
      await this.assertPlayableVideo(patch.videoId, "EPISODE_VIDEO_NOT_PLAYABLE", "Episode playback");
    }
    if (patch.sortOrder !== undefined) {
      await this.assertEpisodeSortOrderAvailable(episode.seasonId, patch.sortOrder, episodeId);
    }
    try {''',
)
rep(
    '''    const existing = await this.database.client.seriesEpisode.findMany({
      where: { seasonId },
      select: { id: true },
    });''',
    '''    const existing = await this.database.client.seriesEpisode.findMany({
      where: { seasonId },
      select: { id: true, sortOrder: true },
    });''',
)
rep(
    '''    await this.database.client.$transaction(
      orderedIds.map((id, index) =>
        this.database.client.seriesEpisode.update({
          where: { id },
          data: { sortOrder: index * 10 },
        }),
      ),
    );''',
    '''    const maxOrder = existing.reduce((max, item) => Math.max(max, item.sortOrder), 0);
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
    });''',
    1,
)
rep(
    '''    const video = await this.getVideo(episode.videoId);
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
    }''',
    '''    if (!(await this.catalogMedia.getPlayableVideo(episode.videoId))) {
      throw catalogError(
        409,
        "EPISODE_VIDEO_NOT_PLAYABLE",
        "The assigned video must be accessible, public, published and have validated playback media.",
      );
    }''',
)
rep(
    '''  async unpublishEpisode(episodeId: string) {
    return this.database.client.seriesEpisode.update({
      where: { id: episodeId },
      data: { status: "DRAFT", publishedAt: null },
    });
  }''',
    '''  async unpublishEpisode(episodeId: string) {
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
  }''',
)
rep(
    '''  async publishSeries(seriesId: string) {
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
    }''',
    '''  async publishSeries(seriesId: string) {
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
    }''',
)
rep(
    '''  async archiveSeries(seriesId: string) {
    await this.database.client.series.update({''',
    '''  async archiveSeries(seriesId: string) {
    const current = await this.database.client.series.findUnique({
      where: { id: seriesId },
      select: { status: true },
    });
    if (!current) throw catalogError(404, "SERIES_NOT_FOUND", "This series does not exist.");
    if (current.status === "PUBLISHED") {
      throw catalogError(409, "UNPUBLISH_BEFORE_ARCHIVE", "Unpublish the Series before archiving it.");
    }
    await this.database.client.series.update({''',
)
rep(
    '''  async listAdmin(limit = 50) {
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
  }''',
    '''  async listAdmin(
    limit = 50,
    search?: string,
    status?: "DRAFT" | "PUBLISHED" | "ARCHIVED",
  ) {
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
  }''',
)
rep(
    '''  private async publicShape(hydrated: HydratedSeries, countryCode?: string) {
    if (hydrated.status !== "PUBLISHED") return null;
    const now = new Date();''',
    '''  private async publicShape(hydrated: HydratedSeries, countryCode?: string) {
    if (hydrated.status !== "PUBLISHED") return null;
    const now = new Date();
    if (!isSeriesAvailableInTerritory(hydrated.availability, countryCode, now)) return null;''',
)
rep(
    '''    return {
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
      seasons,''',
    '''    const trailer = hydrated.trailerVideoId
      ? hydrated.videoById.get(hydrated.trailerVideoId) ?? null
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
          ? { id: trailer.id, title: trailer.title, slug: trailer.slug, durationMs: trailer.durationMs }
          : null,
      availability: hydrated.availability,
      seasons,''',
)
rep(
    '''  private adminShape(hydrated: HydratedSeries) {
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
  }''',
    '''  private async adminShape(hydrated: HydratedSeries) {
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
  }''',
)
rep(
    '''    const videoIds = row.seasons.flatMap((season) =>
      season.episodes.flatMap((episode) => (episode.videoId ? [episode.videoId] : [])),
    );''',
    '''    const videoIds = [
      ...(row.trailerVideoId ? [row.trailerVideoId] : []),
      ...row.seasons.flatMap((season) =>
        season.episodes.flatMap((episode) => (episode.videoId ? [episode.videoId] : [])),
      ),
    ];''',
)
rep(
    '''      originalLanguage: input.originalLanguage.trim().toLowerCase(),
      genres: uniqueTrimmed(input.genres),
      artwork: this.normalizeArtwork(input.artwork),
    };''',
    '''      originalLanguage: input.originalLanguage.trim().toLowerCase(),
      trailerVideoId: input.trailerVideoId ?? null,
      genres: uniqueTrimmed(input.genres),
      artwork: this.normalizeArtwork(input.artwork),
      availability: this.normalizeAvailability(input.availability ?? []),
    };''',
)
rep(
    '''  private async assertArtwork(artwork: SeriesArtworkInput[]) {
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
  }''',
    '''  private async assertArtwork(artwork: SeriesArtworkInput[]) {
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
  }''',
)
rep(
    '''  private async assertEditableSeries(seriesId: string) {''',
    '''  private assertPublishedSeriesPatchSafe(
    current: SeriesWithRelations,
    patch: SeriesCatalogPatch,
    artwork: ReturnType<SeriesCatalogService["normalizeArtwork"]> | undefined,
    availability: ReturnType<SeriesCatalogService["normalizeAvailability"]> | undefined,
  ) {
    if (current.status !== "PUBLISHED") return;
    if (patch.genres && uniqueTrimmed(patch.genres).length === 0) {
      throw catalogError(409, "PUBLISHED_SERIES_GENRE_REQUIRED", "Published Series must keep at least one genre.");
    }
    if (artwork && !artwork.some((item) => item.type === "POSTER")) {
      throw catalogError(409, "PUBLISHED_SERIES_POSTER_REQUIRED", "Published Series must keep poster artwork.");
    }
    if (availability && availability.length > 0 && !hasActiveSeriesAllow(availability)) {
      throw catalogError(409, "PUBLISHED_SERIES_AVAILABILITY_REQUIRED", "Explicit Series availability must include an active ALLOW rule.");
    }
  }

  private normalizeAvailability(items: SeriesAvailabilityInput[]) {
    return items.map((item) => {
      const territoryCode = normalizeSeriesTerritory(item.territoryCode);
      if (!territoryCode) {
        throw catalogError(400, "INVALID_TERRITORY", "Territory must be a two-letter country code or '*'.");
      }
      if (item.startsAt && item.endsAt && item.endsAt <= item.startsAt) {
        throw catalogError(400, "INVALID_RIGHTS_WINDOW", "Availability end must be after its start.");
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

  private async assertSeasonSortOrderAvailable(seriesId: string, sortOrder: number, excludeId?: string) {
    const conflict = await this.database.client.seriesSeason.findFirst({
      where: { seriesId, sortOrder, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (conflict) throw catalogError(409, "SEASON_ORDER_CONFLICT", "Another season already uses that catalog order.");
  }

  private async assertEpisodeSortOrderAvailable(seasonId: string, sortOrder: number, excludeId?: string) {
    const conflict = await this.database.client.seriesEpisode.findFirst({
      where: { seasonId, sortOrder, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (conflict) throw catalogError(409, "EPISODE_ORDER_CONFLICT", "Another episode already uses that catalog order.");
  }

  private async assertEditableSeries(seriesId: string) {''',
)
rep(
    '''function isReadyAsset(asset?: AssetRecord) {
  return Boolean(asset && !asset.removedAt && ["UPLOADED", "VALIDATED"].includes(asset.status));
}''',
    '''function isReadyAsset(asset?: AssetRecord) {
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
      return exact.some((item) => item.rule === "ALLOW") && !exact.some((item) => item.rule === "BLOCK");
    }
  }
  const global = active.filter((item) => item.territoryCode === "*");
  return global.some((item) => item.rule === "ALLOW") && !global.some((item) => item.rule === "BLOCK");
}''',
)

path.write_text(text)
