import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { mediaAssetUrl } from "@/lib/channel";
import { localizePath } from "@/lib/i18n/routing";
import { getRequestLocale } from "@/lib/i18n/server";
import { buildMovieJsonLd, buildMovieMetadata, getPublicMovie } from "@/lib/movie-catalog";
import { serializeJsonLd } from "@/lib/seo";
import styles from "./movie.module.css";

type MoviePageProps = { params: Promise<{ slug: string }> };

function normalizeSlug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 160)
    .replace(/-+$/g, "");
}

export async function generateMetadata({ params }: MoviePageProps): Promise<Metadata> {
  const [{ slug: requested }, locale] = await Promise.all([params, getRequestLocale()]);
  const slug = normalizeSlug(requested);
  if (!slug) return { title: "Movie not found | AYIN", robots: { index: false, follow: false } };
  const movie = await getPublicMovie(slug, locale);
  return movie
    ? buildMovieMetadata(movie, locale)
    : { title: "Movie not found | AYIN", robots: { index: false, follow: false } };
}

export default async function MoviePage({ params }: MoviePageProps) {
  const [{ slug: requested }, locale] = await Promise.all([params, getRequestLocale()]);
  const canonicalSlug = normalizeSlug(requested);
  if (!canonicalSlug) notFound();
  if (requested !== canonicalSlug) redirect(localizePath(`/movies/${canonicalSlug}`, locale));

  const movie = await getPublicMovie(canonicalSlug, locale);
  if (!movie) notFound();

  const poster = mediaAssetUrl(movie.poster?.objectKey);
  const backdrop = mediaAssetUrl(movie.backdrop?.objectKey);
  const jsonLd = buildMovieJsonLd(movie, locale);

  return (
    <main className={styles.page}>
      {backdrop ? (
        <div className={styles.backdrop} aria-hidden="true">
          <Image alt="" fill priority sizes="100vw" src={backdrop} />
          <div className={styles.scrim} />
        </div>
      ) : null}
      <section className={styles.hero}>
        <div className={styles.posterWrap}>
          {poster ? (
            <Image
              alt={movie.poster?.altText ?? `${movie.title} poster`}
              className={styles.poster}
              fill
              priority
              sizes="(max-width: 760px) 42vw, 300px"
              src={poster}
            />
          ) : (
            <div className={styles.posterFallback}>AYIN</div>
          )}
        </div>
        <div className={styles.details}>
          <span className={styles.eyebrow}>Movie</span>
          <h1>{movie.title}</h1>
          <p className={styles.meta}>
            {movie.releaseYear} · {movie.runtimeMinutes} min · {movie.maturityRating} ·{" "}
            {movie.originalLanguage.toUpperCase()}
          </p>
          <p className={styles.genres}>{movie.genres.map((genre) => genre.name).join(" · ")}</p>
          <p className={styles.synopsis}>{movie.synopsis}</p>
          <div className={styles.actions}>
            {movie.primaryVideo ? (
              <Link
                className={styles.primaryAction}
                href={localizePath(`/watch/${movie.primaryVideo.slug}`, locale)}
              >
                Watch movie
              </Link>
            ) : null}
            {movie.trailerVideo ? (
              <Link
                className={styles.secondaryAction}
                href={localizePath(`/watch/${movie.trailerVideo.slug}`, locale)}
              >
                Watch trailer
              </Link>
            ) : null}
          </div>
        </div>
      </section>
      <script
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        type="application/ld+json"
      />
    </main>
  );
}
