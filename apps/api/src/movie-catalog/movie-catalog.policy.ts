export const MOVIE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type MovieAvailabilityRuleValue = "ALLOW" | "BLOCK";
export type MovieArtworkTypeValue = "POSTER" | "BACKDROP" | "LOGO";

export interface MovieAvailabilityWindowLike {
  territoryCode: string;
  rule: MovieAvailabilityRuleValue;
  startsAt: Date | null;
  endsAt: Date | null;
}

export interface MoviePublishCandidate {
  title: string;
  slug: string;
  synopsis: string;
  releaseYear: number;
  runtimeMinutes: number;
  maturityRating: string;
  originalLanguage: string;
  primaryVideo: { status: string; visibility: string } | null;
  genres: readonly unknown[];
  artwork: readonly { type: MovieArtworkTypeValue; assetReady?: boolean }[];
  availability: readonly MovieAvailabilityWindowLike[];
}

export function normalizeMovieSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "")
    .slice(0, 160)
    .replace(/-+$/g, "");
}

export function isSafeMovieSlug(value: string): boolean {
  return value.length > 0 && value.length <= 160 && MOVIE_SLUG_PATTERN.test(value);
}

export function normalizeTerritoryCode(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  if (normalized === "*") return "*";
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

export function isMovieAvailableInTerritory(
  windows: readonly MovieAvailabilityWindowLike[],
  territoryCode: string | null | undefined,
  now = new Date(),
): boolean {
  const active = windows.filter(
    (window) =>
      (!window.startsAt || window.startsAt <= now) && (!window.endsAt || window.endsAt > now),
  );
  const territory = territoryCode ? normalizeTerritoryCode(territoryCode) : null;

  if (territory && territory !== "*") {
    const exact = active.filter((window) => window.territoryCode === territory);
    if (exact.length > 0) return exact.some((window) => window.rule === "ALLOW") && !exact.some((window) => window.rule === "BLOCK");
  }

  const global = active.filter((window) => window.territoryCode === "*");
  return global.some((window) => window.rule === "ALLOW") && !global.some((window) => window.rule === "BLOCK");
}

export function moviePublishIssues(candidate: MoviePublishCandidate, now = new Date()): string[] {
  const issues: string[] = [];
  if (!candidate.title.trim()) issues.push("TITLE_REQUIRED");
  if (!isSafeMovieSlug(candidate.slug)) issues.push("SAFE_SLUG_REQUIRED");
  if (!candidate.synopsis.trim()) issues.push("SYNOPSIS_REQUIRED");
  if (candidate.releaseYear < 1888 || candidate.releaseYear > 2200) issues.push("RELEASE_YEAR_INVALID");
  if (candidate.runtimeMinutes <= 0 || candidate.runtimeMinutes > 1440) issues.push("RUNTIME_INVALID");
  if (!candidate.maturityRating.trim()) issues.push("MATURITY_REQUIRED");
  if (!candidate.originalLanguage.trim()) issues.push("ORIGINAL_LANGUAGE_REQUIRED");
  if (candidate.genres.length === 0) issues.push("GENRE_REQUIRED");
  if (!candidate.artwork.some((item) => item.type === "POSTER" && item.assetReady !== false)) issues.push("POSTER_REQUIRED");
  if (!candidate.primaryVideo) issues.push("PRIMARY_VIDEO_REQUIRED");
  else {
    if (candidate.primaryVideo.status !== "PUBLISHED") issues.push("PRIMARY_VIDEO_NOT_PUBLISHED");
    if (candidate.primaryVideo.visibility !== "PUBLIC") issues.push("PRIMARY_VIDEO_NOT_PUBLIC");
  }
  const activeAllow = candidate.availability.some(
    (window) =>
      window.rule === "ALLOW" &&
      (!window.startsAt || window.startsAt <= now) &&
      (!window.endsAt || window.endsAt > now),
  );
  if (!activeAllow) issues.push("ACTIVE_RIGHTS_REQUIRED");
  return issues;
}
