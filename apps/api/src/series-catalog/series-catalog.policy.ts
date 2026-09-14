export type SeriesArtworkTypeValue = "POSTER" | "BACKDROP" | "LOGO";

export interface OrderedEpisode {
  id: string;
  seasonId: string;
  seasonNumber: number;
  seasonSortOrder: number;
  episodeNumber: number;
  sortOrder: number;
  videoId: string | null;
  status: string;
  releaseDate?: Date | null | undefined;
}

export interface SeriesPublishCandidate {
  title: string;
  slug: string;
  synopsis: string;
  maturityRating: string;
  originalLanguage: string;
  genres: unknown[];
  artwork: Array<{ type: string; assetReady: boolean }>;
  episodes: Array<{
    status: string;
    video: { status: string; visibility: string } | null;
    releaseDate?: Date | null | undefined;
  }>;
}

export function normalizeSeriesSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 160)
    .replaceAll(/-+$/g, "");
}

export function isSafeSeriesSlug(value: string): boolean {
  return value.length > 0 && value.length <= 160 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function compareCatalogEpisodes(a: OrderedEpisode, b: OrderedEpisode): number {
  return (
    a.seasonSortOrder - b.seasonSortOrder ||
    a.seasonNumber - b.seasonNumber ||
    a.sortOrder - b.sortOrder ||
    a.episodeNumber - b.episodeNumber ||
    a.id.localeCompare(b.id)
  );
}

export function nextCatalogEpisode(
  episodes: OrderedEpisode[],
  currentEpisodeId: string,
  now = new Date(),
): OrderedEpisode | null {
  const ordered = episodes
    .filter(
      (episode) =>
        episode.status === "PUBLISHED" &&
        Boolean(episode.videoId) &&
        (!episode.releaseDate || episode.releaseDate <= now),
    )
    .toSorted(compareCatalogEpisodes);
  const index = ordered.findIndex((episode) => episode.id === currentEpisodeId);
  if (index < 0 || index + 1 >= ordered.length) return null;
  return ordered[index + 1] ?? null;
}

export function seriesPublishIssues(candidate: SeriesPublishCandidate, now = new Date()): string[] {
  const issues: string[] = [];
  if (!candidate.title.trim()) issues.push("TITLE_REQUIRED");
  if (!isSafeSeriesSlug(candidate.slug)) issues.push("INVALID_SLUG");
  if (!candidate.synopsis.trim()) issues.push("SYNOPSIS_REQUIRED");
  if (!candidate.maturityRating.trim()) issues.push("MATURITY_REQUIRED");
  if (!candidate.originalLanguage.trim()) issues.push("LANGUAGE_REQUIRED");
  if (candidate.genres.length === 0) issues.push("GENRE_REQUIRED");
  if (!candidate.artwork.some((item) => item.type === "POSTER" && item.assetReady)) {
    issues.push("POSTER_REQUIRED");
  }
  const playableEpisode = candidate.episodes.some(
    (episode) =>
      episode.status === "PUBLISHED" &&
      Boolean(episode.video) &&
      episode.video?.status === "PUBLISHED" &&
      episode.video.visibility === "PUBLIC" &&
      (!episode.releaseDate || episode.releaseDate <= now),
  );
  if (!playableEpisode) issues.push("PUBLISHED_EPISODE_REQUIRED");
  return issues;
}
