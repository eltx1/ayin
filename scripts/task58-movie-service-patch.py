from pathlib import Path

path = Path("apps/api/src/movie-catalog/movie-catalog.service.ts")
text = path.read_text()


def rep(old: str, new: str, count: int = 1):
    global text
    if old not in text:
        raise SystemExit(f"movie marker missing: {old[:120]!r}")
    text = text.replace(old, new, count)

rep(
    'import { DatabaseService } from "../database/database.service.js";\n',
    'import { CatalogAdminMediaService } from "../admin/catalog-admin-media.service.js";\nimport { DatabaseService } from "../database/database.service.js";\n',
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
    '''    const scalar = this.normalizePatch(current, patch);
    const artwork = patch.artwork ? this.normalizeArtwork(patch.artwork) : undefined;
    const availability = patch.availability
      ? this.normalizeAvailability(patch.availability)
      : undefined;''',
    '''    const scalar = this.normalizePatch(current, patch);
    const artwork = patch.artwork ? this.normalizeArtwork(patch.artwork) : undefined;
    const availability = patch.availability
      ? this.normalizeAvailability(patch.availability)
      : undefined;
    this.assertPublishedPatchSafe(current, patch, artwork, availability);''',
)
rep(
    '''  async publish(movieId: string) {
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
    }''',
    '''  async publish(movieId: string) {
    const movie = await this.getAdminById(movieId);
    if (!movie.validation.publishable) {
      throw movieError(409, "MOVIE_NOT_PUBLISHABLE", "Movie is missing required publish data.", {
        issues: movie.validation.issues,
      });
    }''',
)
rep(
    '''  async archive(movieId: string) {
    await this.requireMovie(movieId);
    await this.database.client.movie.update({''',
    '''  async archive(movieId: string) {
    const movie = await this.requireMovie(movieId);
    if (movie.status === "PUBLISHED") {
      throw movieError(409, "UNPUBLISH_BEFORE_ARCHIVE", "Unpublish the movie before archiving it.");
    }
    await this.database.client.movie.update({''',
)
rep(
    '''  async listAdmin(limit = 50) {
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
  }''',
    '''  async listAdmin(
    limit = 50,
    search?: string,
    status?: "DRAFT" | "PUBLISHED" | "ARCHIVED",
  ) {
    const q = search?.trim();
    const rows = await this.database.client.movie.findMany({
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
      take: Math.min(Math.max(limit, 1), 100),
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: {
        genres: { include: { genre: true } },
        artwork: true,
        availability: true,
        localizations: true,
      },
    });
    return Promise.all(rows.map(async (row) => this.adminShape(await this.hydrate(row))));
  }

  async getAdminById(movieId: string) {
    const row = await this.getAdminRow(movieId);
    if (!row) throw movieError(404, "MOVIE_NOT_FOUND", "This movie does not exist.");
    return this.adminShape(await this.hydrate(row));
  }''',
)
rep(
    '''  private async assertReferencedMedia(
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
    });''',
    '''  private assertPublishedPatchSafe(
    current: MovieWithRelations,
    patch: MovieCatalogPatch,
    artwork: ReturnType<MovieCatalogService["normalizeArtwork"]> | undefined,
    availability: ReturnType<MovieCatalogService["normalizeAvailability"]> | undefined,
  ) {
    if (current.status !== "PUBLISHED") return;
    if (patch.primaryVideoId === null) {
      throw movieError(409, "PUBLISHED_MOVIE_PRIMARY_REQUIRED", "Unpublish before removing primary playback.");
    }
    if (patch.genres && uniqueTrimmed(patch.genres).length === 0) {
      throw movieError(409, "PUBLISHED_MOVIE_GENRE_REQUIRED", "Published movies must keep at least one genre.");
    }
    if (artwork && !artwork.some((item) => item.type === "POSTER")) {
      throw movieError(409, "PUBLISHED_MOVIE_POSTER_REQUIRED", "Published movies must keep poster artwork.");
    }
    if (availability && !hasActiveAllow(availability)) {
      throw movieError(409, "PUBLISHED_MOVIE_AVAILABILITY_REQUIRED", "Published movies must keep an active ALLOW availability rule.");
    }
  }

  private async assertReferencedMedia(
    primaryVideoId: string | null,
    trailerVideoId: string | null,
    artwork: MovieArtworkInput[],
  ) {
    for (const [role, videoId] of [
      ["PRIMARY", primaryVideoId],
      ["TRAILER", trailerVideoId],
    ] as const) {
      if (videoId && !(await this.catalogMedia.getPlayableVideo(videoId))) {
        throw movieError(
          400,
          `${role}_VIDEO_NOT_PLAYABLE`,
          `${role === "PRIMARY" ? "Primary playback" : "Trailer"} must reference an accessible published public Video with validated playback media.`,
        );
      }
    }
    for (const item of artwork) {
      if (!(await this.catalogMedia.getArtworkAsset(item.mediaAssetId))) {
        throw movieError(
          400,
          "ARTWORK_ASSET_NOT_READY",
          "Artwork must reference a validated, non-removed image MediaAsset.",
        );
      }
    }
  }

  private async adminShape(movie: HydratedMovie) {
    const issues = moviePublishIssues({
      ...movie,
      artwork: movie.artwork.map((item) => ({
        type: item.type,
        assetReady: Boolean(
          item.asset?.status === "VALIDATED" &&
            !item.asset.removedAt &&
            item.asset.mimeType.toLowerCase().startsWith("image/"),
        ),
      })),
    });
    if (movie.primaryVideoId && !(await this.catalogMedia.getPlayableVideo(movie.primaryVideoId))) {
      issues.push("PRIMARY_VIDEO_UNAVAILABLE");
    }
    if (movie.trailerVideoId && !(await this.catalogMedia.getPlayableVideo(movie.trailerVideoId))) {
      issues.push("TRAILER_VIDEO_UNAVAILABLE");
    }
    const uniqueIssues = [...new Set(issues)];
    return {
      ...movie,
      validation: {
        status: uniqueIssues.length ? ("BLOCKED" as const) : ("READY" as const),
        publishable: uniqueIssues.length === 0,
        issues: uniqueIssues,
      },
    };
  }

  private async requireMovie(movieId: string) {
    const movie = await this.database.client.movie.findUnique({
      where: { id: movieId },
      select: { id: true, status: true },
    });''',
)
rep(
    '''function uniqueTrimmed(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}''',
    '''function uniqueTrimmed(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function hasActiveAllow(items: MovieAvailabilityInput[], now = new Date()) {
  return items.some(
    (item) =>
      item.rule === "ALLOW" &&
      (!item.startsAt || item.startsAt <= now) &&
      (!item.endsAt || item.endsAt > now),
  );
}''',
)

path.write_text(text)
