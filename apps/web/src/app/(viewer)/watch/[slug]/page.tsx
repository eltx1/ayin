import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, ActionLink } from "@/components/ui/design-system";
import { notFound } from "next/navigation";

import { PageAdSlot } from "@/components/ads/page-ad-slot";
import { CommentsPanel } from "@/components/comments/comments-panel";
import { AnalyticsAyinPlayer } from "@/components/player/analytics-ayin-player";
import { VideoSocialActions } from "@/components/social/video-social-actions";
import { apiBaseUrl } from "@/lib/api";
import { type PublicPlaybackResponse } from "@/lib/ayin-player";
import { mediaAssetUrl } from "@/lib/channel";
import { localizePath } from "@/lib/i18n/routing";
import { getRequestLocale } from "@/lib/i18n/server";
import { formatNumber } from "@/lib/i18n/format";
import { translateCatalogDetail } from "@/lib/i18n/catalog-detail";
import { translate } from "@/lib/i18n/translator";
import { getSeoVideo } from "@/lib/seo-content";
import { trustedApiRegionHeaders } from "@/lib/trusted-region";
import {
  absoluteUrl,
  AYIN_DEFAULT_IMAGE,
  isoDuration,
  mediaSeoUrl,
  metadataRobots,
  seoDescription,
  serializeJsonLd,
} from "@/lib/seo";

import styles from "./page.module.css";

interface WatchPageProperties {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ kids?: string | string[] }>;
}

export async function generateMetadata({
  params,
  searchParams,
}: WatchPageProperties): Promise<Metadata> {
  const [{ slug }, query, locale] = await Promise.all([params, searchParams, getRequestLocale()]);
  const kidsMode = query.kids === "1";
  const regionHeaders = await trustedApiRegionHeaders();
  if (kidsMode) {
    const eligibility = await fetch(
      `${apiBaseUrl}/public/videos/${encodeURIComponent(slug)}/playback?kids=1`,
      { cache: "no-store", headers: regionHeaders },
    );
    if (eligibility.status === 404)
      return { title: translate(locale, "watch.unavailable"), robots: metadataRobots(false) };
    if (!eligibility.ok) throw new Error(translate(locale, "watch.loadError"));
  }
  const video = await getSeoVideo(slug, regionHeaders);
  if (!video) {
    return { title: translate(locale, "watch.unavailable"), robots: metadataRobots(false) };
  }

  const canonical = absoluteUrl(localizePath(`/watch/${encodeURIComponent(video.slug)}`, locale));
  const description = seoDescription(
    video.description,
    locale === "ar"
      ? `شاهد ${video.title} من ${video.channel.name} على AYIN.`
      : `Watch ${video.title} from ${video.channel.name} on AYIN.`,
  );
  const image = mediaSeoUrl(video.thumbnail?.objectKey) ?? AYIN_DEFAULT_IMAGE;
  const contentUrl = mediaSeoUrl(video.source.objectKey);
  const indexable = !kidsMode && video.visibility === "PUBLIC";

  return {
    title: video.title,
    description,
    alternates: { canonical },
    robots: metadataRobots(indexable),
    openGraph: {
      type: "video.other",
      siteName: "AYIN",
      title: video.title,
      description,
      url: canonical,
      images: [{ url: image, alt: video.title }],
      ...(contentUrl ? { videos: [{ url: contentUrl, type: video.source.mimeType }] } : {}),
    },
    twitter: { card: "summary_large_image", title: video.title, description, images: [image] },
  };
}

export default async function WatchPage({ params, searchParams }: WatchPageProperties) {
  const [{ slug }, query, locale] = await Promise.all([params, searchParams, getRequestLocale()]);
  const kidsMode = query.kids === "1";
  const t = (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) =>
    translate(locale, key, values);
  const regionHeaders = await trustedApiRegionHeaders();
  const playbackQuery = new URLSearchParams({ locale, ...(kidsMode ? { kids: "1" } : {}) });
  const [response, seoVideo] = await Promise.all([
    fetch(`${apiBaseUrl}/public/videos/${encodeURIComponent(slug)}/playback?${playbackQuery}`, {
      cache: "no-store",
      headers: regionHeaders,
    }),
    getSeoVideo(slug, regionHeaders),
  ]);
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error(t("watch.loadError"));
  const data = (await response.json()) as PublicPlaybackResponse;
  const seriesContext =
    !kidsMode && data.detail.contentType === "SERIES_EPISODE" ? data.detail.seriesContext : null;
  const catalogText = (
    key: Parameters<typeof translateCatalogDetail>[1],
    values?: Parameters<typeof translateCatalogDetail>[2],
  ) => translateCatalogDetail(locale, key, values);
  const episodePosition = (seasonNumber: number, episodeNumber: number) =>
    `${catalogText("series.season", { count: formatNumber(seasonNumber, locale) })} · ${catalogText("series.episode", { count: formatNumber(episodeNumber, locale) })}`;
  const displayTitle = seriesContext?.episode.title ?? data.video.title;
  const displayDescription = seriesContext?.episode.synopsis || data.video.description;
  const sourceUrl = mediaAssetUrl(data.video.source.objectKey);
  if (!sourceUrl) throw new Error(t("watch.deliveryError"));
  const adaptiveSourceUrl = data.video.adaptiveSource
    ? mediaAssetUrl(data.video.adaptiveSource.objectKey)
    : null;
  const captions = data.video.captions.flatMap((track) => {
    const src = mediaAssetUrl(track.objectKey);
    return src
      ? [
          {
            id: track.id,
            src,
            label: track.label,
            language: track.language,
            kind: track.kind,
            default: track.default,
          },
        ]
      : [];
  });

  const structuredData = !kidsMode && seoVideo ? buildVideoStructuredData(seoVideo) : null;

  return (
    <main className={styles.page}>
      {structuredData ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
        />
      ) : null}
      <AnalyticsAyinPlayer
        key={`${data.video.id}:${kidsMode}`}
        advertisingEnabled={!kidsMode}
        adaptiveSourceUrl={adaptiveSourceUrl}
        autoPlay
        className={styles.playerFrame}
        captions={captions}
        chapters={data.video.chapters}
        durationMs={data.video.durationMs}
        progressPolicy={data.playerPolicy}
        sourceUrl={sourceUrl}
        title={displayTitle}
        videoId={data.video.id}
      />
      <section className={styles.details}>
        {seriesContext ? (
          <nav
            className={styles.seriesNavigation}
            aria-label={catalogText("series.episodeNavigation")}
          >
            <ActionLink
              tone="secondary"
              href={localizePath(
                `/series/${encodeURIComponent(seriesContext.series.slug)}?season=${seriesContext.season.seasonNumber}`,
                locale,
              )}
              data-tv-focusable="true"
            >
              <span dir="auto">{seriesContext.series.title}</span>
              <span>{catalogText("series.allEpisodes")}</span>
            </ActionLink>
            <p dir="auto">
              {episodePosition(
                seriesContext.season.seasonNumber,
                seriesContext.episode.episodeNumber,
              )}
              {seriesContext.season.title ? ` · ${seriesContext.season.title}` : ""}
            </p>
            {seriesContext.nextEpisode ? (
              <ActionLink
                href={localizePath(
                  `/watch/${encodeURIComponent(seriesContext.nextEpisode.video.slug)}`,
                  locale,
                )}
                data-tv-focusable="true"
                data-tv-focus-id="watch-next-episode"
              >
                <span>{catalogText("series.nextEpisode")}</span>
                <span dir="auto">
                  {episodePosition(
                    seriesContext.nextEpisode.seasonNumber,
                    seriesContext.nextEpisode.episodeNumber,
                  )}{" "}
                  · {seriesContext.nextEpisode.title}
                </span>
              </ActionLink>
            ) : (
              <p>{catalogText("series.lastAvailableEpisode")}</p>
            )}
          </nav>
        ) : null}
        <PageHeader
          eyebrow={t("watch.eyebrow")}
          title={displayTitle}
          {...(displayDescription ? { description: displayDescription } : {})}
          {...(!kidsMode
            ? {
                actions: (
                  <ActionLink
                    tone="secondary"
                    data-tv-focusable="true"
                    data-tv-focus-id="watch-channel"
                    href={localizePath(
                      `/c/${encodeURIComponent(data.video.channel.handle)}`,
                      locale,
                    )}
                  >
                    <span dir="auto">{data.video.channel.name}</span> ·{" "}
                    <bdi dir="ltr">@{data.video.channel.handle}</bdi>
                  </ActionLink>
                ),
              }
            : {})}
        >
          {kidsMode ? (
            <p dir="auto">{data.video.channel.name}</p>
          ) : (
            <VideoSocialActions className={styles.actions} videoId={data.video.id} />
          )}
        </PageHeader>
      </section>
      {!kidsMode ? <PageAdSlot placementKey="watch_below_player" /> : null}
      {data.detail.related.length > 0 ? (
        <section className={styles.related}>
          <h2 dir="auto">{t("watch.moreFrom", { name: data.video.channel.name })}</h2>
          <div>
            {data.detail.related.map((item) => (
              <Link data-tv-focusable="true" href={localizePath(item.href, locale)} key={item.id}>
                <strong dir="auto">{item.title}</strong>
                {item.durationMs ? (
                  <span>{t("watch.minutes", { count: Math.ceil(item.durationMs / 60_000) })}</span>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      {!kidsMode ? (
        <CommentsPanel enabled={data.detail.commentsSlot.enabled} videoId={data.video.id} />
      ) : null}
    </main>
  );
}

function buildVideoStructuredData(video: NonNullable<Awaited<ReturnType<typeof getSeoVideo>>>) {
  const canonical = absoluteUrl(`/watch/${encodeURIComponent(video.slug)}`);
  const channelUrl = absoluteUrl(`/c/${encodeURIComponent(video.channel.handle)}`);
  const image = mediaSeoUrl(video.thumbnail?.objectKey) ?? AYIN_DEFAULT_IMAGE;
  const contentUrl = mediaSeoUrl(video.source.objectKey);
  const description = seoDescription(
    video.description,
    `Watch ${video.title} from ${video.channel.name} on AYIN.`,
    500,
  );

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "VideoObject",
        "@id": `${canonical}#video`,
        name: video.title,
        description,
        thumbnailUrl: [image],
        uploadDate: video.publishedAt ?? video.updatedAt,
        dateModified: video.updatedAt,
        ...(isoDuration(video.durationMs) ? { duration: isoDuration(video.durationMs) } : {}),
        ...(contentUrl ? { contentUrl } : {}),
        url: canonical,
        mainEntityOfPage: canonical,
        isAccessibleForFree: true,
        author: {
          "@type": "Person",
          name: video.channel.name,
          alternateName: `@${video.channel.handle}`,
          url: channelUrl,
        },
        publisher: { "@id": absoluteUrl("/#organization") },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${canonical}#breadcrumbs`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "AYIN", item: absoluteUrl("/") },
          { "@type": "ListItem", position: 2, name: video.channel.name, item: channelUrl },
          { "@type": "ListItem", position: 3, name: video.title, item: canonical },
        ],
      },
    ],
  };
}
