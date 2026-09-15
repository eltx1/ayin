import type { Metadata } from "next";

import { apiBaseUrl } from "@/lib/api";
import { mediaAssetUrl } from "@/lib/channel";
import type { Locale } from "@/lib/i18n/config";
import { localizePath } from "@/lib/i18n/routing";
import { localizedEntityAlternates } from "@/lib/i18n/seo";
import { absoluteUrl, metadataRobots, seoDescription } from "@/lib/seo";

export interface PublicSeriesEpisode {
  id: string;
  episodeNumber: number;
  title: string;
  synopsis: string;
  shortDescription?: string | null;
  sortOrder: number;
  releaseDate: string | null;
  publishedAt: string | null;
  video: {
    id: string;
    slug: string;
    title: string;
    durationMs: number | null;
    href: string;
  };
}

export interface PublicSeriesSeason {
  id: string;
  seasonNumber: number;
  title: string | null;
  shortDescription?: string | null;
  sortOrder: number;
  artwork: Array<{ type: string; altText: string | null; objectKey: string }>;
  episodes: PublicSeriesEpisode[];
}

export interface PublicSeries {
  id: string;
  title: string;
  slug: string;
  synopsis: string;
  shortDescription: string | null;
  locale: string;
  availableLocales: string[];
  releaseYear: number | null;
  maturityRating: string;
  originalLanguage: string;
  publishedAt: string | null;
  updatedAt: string;
  genres: string[];
  artwork: Array<{
    type: string;
    altText: string | null;
    objectKey: string;
    width: number | null;
    height: number | null;
  }>;
  seasons: PublicSeriesSeason[];
  episodeCount: number;
  firstEpisode: PublicSeriesEpisode | null;
}

export async function getPublicSeries(slug: string, locale: Locale): Promise<PublicSeries | null> {
  const params = new URLSearchParams({ locale });
  const response = await fetch(
    `${apiBaseUrl}/public/series/${encodeURIComponent(slug)}?${params.toString()}`,
    { next: { revalidate: 60 } },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { series: PublicSeries };
  return body.series;
}

export function buildSeriesMetadata(series: PublicSeries, locale: Locale): Metadata {
  const path = `/series/${series.slug}`;
  const alternates = localizedEntityAlternates(path, locale, series.availableLocales);
  const description = seoDescription(
    series.shortDescription ?? series.synopsis,
    `${series.title} on AYIN.`,
  );
  const poster = series.artwork.find((item) => item.type === "POSTER");
  const backdrop = series.artwork.find((item) => item.type === "BACKDROP");
  const image = mediaAssetUrl(poster?.objectKey) ?? mediaAssetUrl(backdrop?.objectKey);
  return {
    title: `${series.title}${series.releaseYear ? ` (${series.releaseYear})` : ""} | AYIN`,
    description,
    alternates,
    robots: metadataRobots(true),
    openGraph: {
      type: "website",
      url: alternates.canonical,
      title: series.title,
      description,
      ...(image ? { images: [{ url: image, alt: poster?.altText ?? series.title }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: series.title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export function buildSeriesJsonLd(series: PublicSeries, locale: Locale) {
  const path = `/series/${series.slug}`;
  const alternates = localizedEntityAlternates(path, locale, series.availableLocales);
  const canonical = alternates.canonical;
  const poster = series.artwork.find((item) => item.type === "POSTER");
  const image = mediaAssetUrl(poster?.objectKey);
  return {
    "@context": "https://schema.org",
    "@type": "TVSeries",
    "@id": `${canonical}#series`,
    url: canonical,
    name: series.title,
    description: series.shortDescription ?? series.synopsis,
    inLanguage: series.locale,
    contentRating: series.maturityRating,
    genre: series.genres,
    numberOfEpisodes: series.episodeCount,
    numberOfSeasons: series.seasons.length,
    ...(series.releaseYear ? { dateCreated: String(series.releaseYear) } : {}),
    ...(image ? { image } : {}),
    containsSeason: series.seasons.map((season) => ({
      "@type": "TVSeason",
      seasonNumber: season.seasonNumber,
      name: season.title ?? `Season ${season.seasonNumber}`,
      ...(season.shortDescription ? { description: season.shortDescription } : {}),
      numberOfEpisodes: season.episodes.length,
      episode: season.episodes.map((episode) => ({
        "@type": "TVEpisode",
        episodeNumber: episode.episodeNumber,
        name: episode.title,
        description: episode.shortDescription ?? episode.synopsis,
        url: absoluteUrl(localizePath(`/watch/${episode.video.slug}`, locale)),
        potentialAction: {
          "@type": "WatchAction",
          target: absoluteUrl(localizePath(`/watch/${episode.video.slug}`, locale)),
        },
      })),
    })),
  };
}
