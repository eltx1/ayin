import { apiBaseUrl } from "./api";
import type { DiscoveryItem } from "./discovery";
import type { Locale } from "./i18n/config";
import { translate } from "./i18n/translator";

export const directorySections = ["movies", "series", "tv", "creators"] as const;
export type DirectorySection = (typeof directorySections)[number];
export const isDirectorySection = (value: string): value is DirectorySection =>
  directorySections.some((section) => section === value);
export const isDirectoryCursor = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

interface DirectoryResponse<T> {
  items: T[];
  nextCursor: string | null;
}
interface MovieCard {
  id: string;
  title: string;
  slug: string;
  releaseYear: number;
  runtimeMinutes: number;
  poster: { objectKey: string } | null;
}
interface SeriesCard {
  id: string;
  title: string;
  slug: string;
  releaseYear: number | null;
  episodeCount: number;
  artwork: Array<{ type: string; objectKey: string }>;
}

export async function fetchPublicDirectory(
  section: DirectorySection,
  locale: Locale,
  cursor?: string,
  trustedHeaders: Record<string, string> = {},
): Promise<DirectoryResponse<DiscoveryItem>> {
  const params = new URLSearchParams({ locale, limit: "24" });
  if (cursor) params.set("cursor", cursor);
  const path =
    section === "movies" || section === "series"
      ? `/public/${section}/directory`
      : `/public/discovery/${section}`;
  const response = await fetch(`${apiBaseUrl}${path}?${params}`, {
    cache: "no-store",
    headers: trustedHeaders,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Directory request failed (${response.status}).`);
  const page = (await response.json()) as DirectoryResponse<MovieCard | SeriesCard | DiscoveryItem>;
  if (
    !Array.isArray(page.items) ||
    (page.nextCursor !== null && !isDirectoryCursor(page.nextCursor))
  ) {
    throw new Error("Invalid directory response.");
  }
  return {
    nextCursor: page.nextCursor,
    items: page.items.map((item) => {
      if (section === "movies") {
        const movie = item as MovieCard;
        return {
          id: movie.id,
          title: movie.title,
          type: "VIDEO" as const,
          href: `/movies/${encodeURIComponent(movie.slug)}`,
          kicker: translate(locale, "nav.movies"),
          meta: `${movie.releaseYear} · ${translate(locale, "browse.minutes", { count: movie.runtimeMinutes })}`,
          artworkObjectKey: movie.poster?.objectKey ?? null,
        };
      }
      if (section === "series") {
        const series = item as SeriesCard;
        return {
          id: series.id,
          title: series.title,
          type: "SERIES" as const,
          href: `/series/${encodeURIComponent(series.slug)}`,
          kicker: translate(locale, "nav.series"),
          meta: [
            series.releaseYear,
            translate(locale, "browse.episodes", { count: series.episodeCount }),
          ]
            .filter(Boolean)
            .join(" · "),
          artworkObjectKey: series.artwork.find((art) => art.type === "POSTER")?.objectKey ?? null,
        };
      }
      const entry = item as DiscoveryItem;
      // Directory links are local product routes, never arbitrary provider URLs.
      if (!/^\/c\/[^/?#]+(?:\/tv)?$/.test(entry.href))
        throw new Error("Invalid creator destination.");
      return { ...entry, kicker: translate(locale, section === "tv" ? "nav.tv" : "nav.creators") };
    }),
  };
}
