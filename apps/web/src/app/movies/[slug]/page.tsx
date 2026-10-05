import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { mediaAssetUrl } from "@/lib/channel";
import { translateCatalogDetail } from "@/lib/i18n/catalog-detail";
import { formatNumber } from "@/lib/i18n/format";
import { localizePath } from "@/lib/i18n/routing";
import { getRequestLocale } from "@/lib/i18n/server";
import { buildMovieJsonLd, buildMovieMetadata, getPublicMovie } from "@/lib/movie-catalog";
import { serializeJsonLd } from "@/lib/seo";
import { trustedApiRegionHeaders } from "@/lib/trusted-region";
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
  if (!slug)
    return {
      title: translateCatalogDetail(locale, "movie.notFound"),
      robots: { index: false, follow: false },
    };
  const movie = await getPublicMovie(slug, locale, await trustedApiRegionHeaders());
  return movie
    ? buildMovieMetadata(movie, locale)
    : {
        title: translateCatalogDetail(locale, "movie.notFound"),
        robots: { index: false, follow: false },
      };
}

export default async function MoviePage({ params }: MoviePageProps) {
  const [{ slug: requested }, locale] = await Promise.all([params, getRequestLocale()]);
  const t = (
    key: Parameters<typeof translateCatalogDetail>[1],
    values?: Parameters<typeof translateCatalogDetail>[2],
  ) => translateCatalogDetail(locale, key, values);
  const canonicalSlug = normalizeSlug(requested);
  if (!canonicalSlug) notFound();
  if (requested !== canonicalSlug) redirect(localizePath(`/movies/${canonicalSlug}`, locale));

  const movie = await getPublicMovie(canonicalSlug, locale, await trustedApiRegionHeaders());
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
              alt={movie.poster?.altText ?? t("catalog.poster", { title: movie.title })}
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
          <span className={styles.eyebrow}>{t("movie.eyebrow")}</span>
          <h1 dir="auto">{movie.title}</h1>
          <p className={styles.meta}>
            {formatNumber(movie.releaseYear, locale, { useGrouping: false })} ·{" "}
            {t("catalog.minutes", { count: formatNumber(movie.runtimeMinutes, locale) })} ·{" "}
            {movie.maturityRating} · {movie.originalLanguage.toUpperCase()}
          </p>
          <p className={styles.genres} dir="auto">
            {movie.genres.map((genre) => genre.name).join(" · ")}
          </p>
          <p className={styles.synopsis} dir="auto">
            {movie.synopsis}
          </p>
          <div className={styles.actions}>
            {movie.primaryVideo ? (
              <Link
                data-tv-focusable="true"
                className={styles.primaryAction}
                href={localizePath(`/watch/${movie.primaryVideo.slug}`, locale)}
              >
                {t("movie.watch")}
              </Link>
            ) : null}
            {movie.trailerVideo ? (
              <Link
                data-tv-focusable="true"
                className={styles.secondaryAction}
                href={localizePath(`/watch/${movie.trailerVideo.slug}`, locale)}
              >
                {t("movie.trailer")}
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
