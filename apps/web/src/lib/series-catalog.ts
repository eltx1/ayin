import type { Metadata } from "next";

import { apiBaseUrl } from "@/lib/api";
import { mediaAssetUrl } from "@/lib/channel";
import { absoluteUrl, metadataRobots, seoDescription } from "@/lib/seo";

export interface PublicSeriesEpisode {
  id: string;
  episodeNumber: number;
  title: string;
  synopsis: string;
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
  sortOrder: number;
  artwork: Array<{ type: string; altText: string | null; objectKey: string }>;
  episodes: PublicSeriesEpisode[];
}

export interface PublicSeries {
  id: string;
  title: string;
  slug: string;
  synopsis: string;
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

export async function getPublicSeries(slug: string): Promise<PublicSeries | null> {
  const response = await fetch(`${apiBaseUrl}/public/series/${encodeURIComponent(slug)}`, {
    next: { revalidate: 60 },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { series: PublicSeries };
  return body.series;
}

export function buildSeriesMetadata(series: PublicSeries): Metadata {
  const canonical = absoluteUrl(`/series/${series.slug}`);
  const description = seoDescription(series.synopsis, `${series.title} on AYIN.`);
  const poster = series.artwork.find((item) => item.type === "POSTER");
  const backdrop = series.artwork.find((item) => item.type === "BACKDROP");
  const image = mediaAssetUrl(poster?.objectKey) ?? mediaAssetUrl(backdrop?.objectKey);
  return {
    title: `${series.title}${series.releaseYear ? ` (${series.releaseYear})` : ""} | AYIN`,
    description,
    alternates: { canonical },
    robots: metadataRobots(true),
    openGraph: {
      type: "website",
      url: canonical,
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

export function buildSeriesJsonLd(series: PublicSeries) {
  const canonical = absoluteUrl(`/series/${series.slug}`);
  const poster = series.artwork.find((item) => item.type === "POSTER");
  const image = mediaAssetUrl(poster?.objectKey);
  return {
    "@context": "https://schema.org",
    "@type": "TVSeries",
    "@id": `${canonical}#series`,
    url: canonical,
    name: series.title,
    description: series.synopsis,
    inLanguage: series.originalLanguage,
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
      numberOfEpisodes: season.episodes.length,
      episode: season.episodes.map((episode) => ({
        "@type": "TVEpisode",
        episodeNumber: episode.episodeNumber,
        name: episode.title,
        description: episode.synopsis,
        url: absoluteUrl(`/watch/${episode.video.slug}`),
        potentialAction: {
          "@type": "WatchAction",
          target: absoluteUrl(`/watch/${episode.video.slug}`),
        },
      })),
    })),
  };
}
