import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { mediaAssetUrl } from "@/lib/channel";
import { translateCatalogDetail } from "@/lib/i18n/catalog-detail";
import { formatNumber } from "@/lib/i18n/format";
import { localizePath } from "@/lib/i18n/routing";
import { getRequestLocale } from "@/lib/i18n/server";
import { buildSeriesJsonLd, buildSeriesMetadata, getPublicSeries } from "@/lib/series-catalog";
import { serializeJsonLd } from "@/lib/seo";
import { trustedApiRegionHeaders } from "@/lib/trusted-region";
import styles from "./series.module.css";

type SeriesPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ season?: string }>;
};

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

export async function generateMetadata({ params }: SeriesPageProps): Promise<Metadata> {
  const [{ slug: requested }, locale] = await Promise.all([params, getRequestLocale()]);
  const slug = normalizeSlug(requested);
  if (!slug)
    return {
      title: translateCatalogDetail(locale, "series.notFound"),
      robots: { index: false, follow: false },
    };
  const series = await getPublicSeries(slug, locale, await trustedApiRegionHeaders());
  return series
    ? buildSeriesMetadata(series, locale)
    : {
        title: translateCatalogDetail(locale, "series.notFound"),
        robots: { index: false, follow: false },
      };
}

export default async function SeriesPage({ params, searchParams }: SeriesPageProps) {
  const [{ slug: requested }, query, locale] = await Promise.all([
    params,
    searchParams,
    getRequestLocale(),
  ]);
  const t = (
    key: Parameters<typeof translateCatalogDetail>[1],
    values?: Parameters<typeof translateCatalogDetail>[2],
  ) => translateCatalogDetail(locale, key, values);
  const canonicalSlug = normalizeSlug(requested);
  if (!canonicalSlug) notFound();
  if (requested !== canonicalSlug) redirect(localizePath(`/series/${canonicalSlug}`, locale));
  const series = await getPublicSeries(canonicalSlug, locale, await trustedApiRegionHeaders());
  if (!series) notFound();

  const requestedSeason = Number(query.season);
  const selectedSeason =
    series.seasons.find((season) => season.seasonNumber === requestedSeason) ?? series.seasons[0];
  if (!selectedSeason) notFound();
  const poster = series.artwork.find((item) => item.type === "POSTER");
  const backdrop = series.artwork.find((item) => item.type === "BACKDROP");
  const posterUrl = mediaAssetUrl(poster?.objectKey);
  const backdropUrl = mediaAssetUrl(backdrop?.objectKey);
  const jsonLd = buildSeriesJsonLd(series, locale);

  return (
    <main className={styles.page}>
      {backdropUrl ? (
        <div className={styles.backdrop} aria-hidden="true">
          <Image alt="" fill priority sizes="100vw" src={backdropUrl} />
          <div className={styles.scrim} />
        </div>
      ) : null}
      <section className={styles.hero}>
        <div className={styles.posterWrap}>
          {posterUrl ? (
            <Image
              alt={poster?.altText ?? t("catalog.poster", { title: series.title })}
              className={styles.poster}
              fill
              priority
              sizes="(max-width: 760px) 42vw, 300px"
              src={posterUrl}
            />
          ) : (
            <div className={styles.posterFallback}>AYIN</div>
          )}
        </div>
        <div className={styles.details}>
          <span className={styles.eyebrow}>{t("series.eyebrow")}</span>
          <h1 dir="auto">{series.title}</h1>
          <p className={styles.meta}>
            {series.releaseYear
              ? formatNumber(series.releaseYear, locale, { useGrouping: false })
              : t("series.original")}{" "}
            · {series.maturityRating} ·{" "}
            {t(series.episodeCount === 1 ? "series.oneEpisode" : "series.episodeCount", {
              count: formatNumber(series.episodeCount, locale),
            })}{" "}
            · {series.originalLanguage.toUpperCase()}
          </p>
          <p className={styles.genres} dir="auto">
            {series.genres.join(" · ")}
          </p>
          <p className={styles.synopsis} dir="auto">
            {series.synopsis}
          </p>
          {series.firstEpisode ? (
            <Link
              data-tv-focusable="true"
              className={styles.primaryAction}
              href={localizePath(series.firstEpisode.video.href, locale)}
            >
              {t("series.start")}
            </Link>
          ) : null}
        </div>
      </section>

      <section className={styles.catalog}>
        <nav className={styles.seasonSelector} aria-label={t("series.seasonSelector")}>
          {series.seasons.map((season) => (
            <Link
              data-tv-focusable="true"
              aria-current={season.id === selectedSeason.id ? "page" : undefined}
              className={season.id === selectedSeason.id ? styles.seasonActive : styles.seasonLink}
              href={`${localizePath(`/series/${series.slug}`, locale)}?season=${season.seasonNumber}`}
              key={season.id}
            >
              {season.title ??
                t("series.season", { count: formatNumber(season.seasonNumber, locale) })}
            </Link>
          ))}
        </nav>
        <h2 dir="auto">
          {selectedSeason.title ??
            t("series.season", { count: formatNumber(selectedSeason.seasonNumber, locale) })}
        </h2>
        <div className={styles.episodes}>
          {selectedSeason.episodes.map((episode) => (
            <article className={styles.episode} key={episode.id}>
              <div>
                <span className={styles.episodeNumber}>
                  {t("series.episode", { count: formatNumber(episode.episodeNumber, locale) })}
                </span>
                <h3 dir="auto">{episode.title}</h3>
                <p dir="auto">{episode.synopsis}</p>
              </div>
              <Link
                data-tv-focusable="true"
                className={styles.watchLink}
                href={localizePath(episode.video.href, locale)}
              >
                {t("series.watch")}
              </Link>
            </article>
          ))}
        </div>
      </section>
      <script
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        type="application/ld+json"
      />
    </main>
  );
}
