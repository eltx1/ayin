import type { Metadata } from "next";

import { apiBaseUrl } from "@/lib/api";
import { mediaAssetUrl } from "@/lib/channel";
import type { Locale } from "@/lib/i18n/config";
import { localizePath } from "@/lib/i18n/routing";
import { localizedEntityAlternates } from "@/lib/i18n/seo";
import { absoluteUrl, metadataRobots, seoDescription } from "@/lib/seo";

export interface PublicMovie {
  id: string;
  title: string;
  slug: string;
  synopsis: string;
  shortDescription: string | null;
  locale: string;
  availableLocales: string[];
  releaseDate: string | null;
  releaseYear: number;
  runtimeMinutes: number;
  maturityRating: string;
  originalLanguage: string;
  genres: Array<{ name: string; slug: string }>;
  poster: MovieArtwork | null;
  backdrop: MovieArtwork | null;
  primaryVideo: { id: string; slug: string; durationMs: number | null } | null;
  trailerVideo: { id: string; slug: string; durationMs: number | null } | null;
  localizations: Array<{
    locale: string;
    title: string | null;
    synopsis: string | null;
    shortDescription?: string | null;
  }>;
}

export interface MovieArtwork {
  mediaAssetId: string;
  objectKey: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  altText: string | null;
}

export async function getPublicMovie(slug: string, locale: Locale): Promise<PublicMovie | null> {
  const params = new URLSearchParams({ locale });
  const response = await fetch(
    `${apiBaseUrl}/public/movies/${encodeURIComponent(slug)}?${params.toString()}`,
    { next: { revalidate: 60 } },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { movie: PublicMovie | null };
  return body.movie;
}

export function buildMovieMetadata(movie: PublicMovie, locale: Locale): Metadata {
  const path = `/movies/${movie.slug}`;
  const alternates = localizedEntityAlternates(path, locale, movie.availableLocales);
  const description = seoDescription(
    movie.shortDescription ?? movie.synopsis,
    `${movie.title} on AYIN.`,
  );
  const image = mediaAssetUrl(movie.poster?.objectKey) ?? mediaAssetUrl(movie.backdrop?.objectKey);
  return {
    title: `${movie.title} (${movie.releaseYear}) | AYIN`,
    description,
    alternates,
    robots: metadataRobots(true),
    openGraph: {
      type: "video.movie",
      url: alternates.canonical,
      title: movie.title,
      description,
      ...(image ? { images: [{ url: image, alt: movie.poster?.altText ?? movie.title }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: movie.title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export function buildMovieJsonLd(movie: PublicMovie, locale: Locale) {
  const path = `/movies/${movie.slug}`;
  const alternates = localizedEntityAlternates(path, locale, movie.availableLocales);
  const canonical = alternates.canonical;
  const poster = mediaAssetUrl(movie.poster?.objectKey) ?? mediaAssetUrl(movie.backdrop?.objectKey);
  const watchUrl = movie.primaryVideo
    ? absoluteUrl(localizePath(`/watch/${movie.primaryVideo.slug}`, locale))
    : null;
  return {
    "@context": "https://schema.org",
    "@type": "Movie",
    "@id": `${canonical}#movie`,
    url: canonical,
    name: movie.title,
    description: movie.shortDescription ?? movie.synopsis,
    dateCreated: movie.releaseDate ?? String(movie.releaseYear),
    duration: `PT${movie.runtimeMinutes}M`,
    contentRating: movie.maturityRating,
    inLanguage: movie.locale,
    genre: movie.genres.map((genre) => genre.name),
    ...(poster ? { image: poster } : {}),
    ...(watchUrl
      ? {
          potentialAction: {
            "@type": "WatchAction",
            target: watchUrl,
          },
        }
      : {}),
    ...(movie.trailerVideo
      ? {
          trailer: {
            "@type": "VideoObject",
            name: `${movie.title} trailer`,
            url: absoluteUrl(localizePath(`/watch/${movie.trailerVideo.slug}`, locale)),
          },
        }
      : {}),
  };
}
