import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { mediaAssetUrl } from "@/lib/channel";
import { buildSeriesJsonLd, buildSeriesMetadata, getPublicSeries } from "@/lib/series-catalog";
import { serializeJsonLd } from "@/lib/seo";
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
    .replace(/-{2,}/g, "")
    .slice(0, 160)
    .replace(/-+$/g, "");
}

export async function generateMetadata({ params }: SeriesPageProps): Promise<Metadata> {
  const { slug: requested } = await params;
  const slug = normalizeSlug(requested);
  if (!slug) return { title: "Series not found | AYIN", robots: { index: false, follow: false } };
  const series = await getPublicSeries(slug);
  return series
    ? buildSeriesMetadata(series)
    : { title: "Series not found | AYIN", robots: { index: false, follow: false } };
}

export default async function SeriesPage({ params, searchParams }: SeriesPageProps) {
  const [{ slug: requested }, query] = await Promise.all([params, searchParams]);
  const canonicalSlug = normalizeSlug(requested);
  if (!canonicalSlug) notFound();
  if (requested !== canonicalSlug) redirect(`/series/${canonicalSlug}`);
  const series = await getPublicSeries(canonicalSlug);
  if (!series) notFound();

  const requestedSeason = Number(query.season);
  const selectedSeason =
    series.seasons.find((season) => season.seasonNumber === requestedSeason) ?? series.seasons[0];
  if (!selectedSeason) notFound();
  const poster = series.artwork.find((item) => item.type === "POSTER");
  const backdrop = series.artwork.find((item) => item.type === "BACKDROP");
  const posterUrl = mediaAssetUrl(poster?.objectKey);
  const backdropUrl = mediaAssetUrl(backdrop?.objectKey);
  const jsonLd = buildSeriesJsonLd(series);

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
              alt={poster?.altText ?? `${series.title} poster`}
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
          <span className={styles.eyebrow}>Series</span>
          <h1>{series.title}</h1>
          <p className={styles.meta}>
            {series.releaseYear ?? "AYIN Original"} · {series.maturityRating} ·{" "}
            {series.episodeCount} episodes · {series.originalLanguage.toUpperCase()}
          </p>
          <p className={styles.genres}>{series.genres.join(" · ")}</p>
          <p className={styles.synopsis}>{series.synopsis}</p>
          {series.firstEpisode ? (
            <Link className={styles.primaryAction} href={series.firstEpisode.video.href}>
              Start watching
            </Link>
          ) : null}
        </div>
      </section>

      <section className={styles.catalog}>
        <nav className={styles.seasonSelector} aria-label="Season selector">
          {series.seasons.map((season) => (
            <Link
              aria-current={season.id === selectedSeason.id ? "page" : undefined}
              className={season.id === selectedSeason.id ? styles.seasonActive : styles.seasonLink}
              href={`/series/${series.slug}?season=${season.seasonNumber}`}
              key={season.id}
            >
              {season.title ?? `Season ${season.seasonNumber}`}
            </Link>
          ))}
        </nav>
        <h2>{selectedSeason.title ?? `Season ${selectedSeason.seasonNumber}`}</h2>
        <div className={styles.episodes}>
          {selectedSeason.episodes.map((episode) => (
            <article className={styles.episode} key={episode.id}>
              <div>
                <span className={styles.episodeNumber}>Episode {episode.episodeNumber}</span>
                <h3>{episode.title}</h3>
                <p>{episode.synopsis}</p>
              </div>
              <Link className={styles.watchLink} href={episode.video.href}>
                Watch
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
