import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageAdSlot } from "@/components/ads/page-ad-slot";
import { CommentsPanel } from "@/components/comments/comments-panel";
import { AnalyticsAyinPlayer } from "@/components/player/analytics-ayin-player";
import { VideoSocialActions } from "@/components/social/video-social-actions";
import { apiBaseUrl } from "@/lib/api";
import { type PublicPlaybackResponse } from "@/lib/ayin-player";
import { mediaAssetUrl } from "@/lib/channel";
import { getSeoVideo } from "@/lib/seo-content";
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
}

export async function generateMetadata({ params }: WatchPageProperties): Promise<Metadata> {
  const { slug } = await params;
  const video = await getSeoVideo(slug);
  if (!video) {
    return { title: "Video unavailable", robots: metadataRobots(false) };
  }

  const canonical = absoluteUrl(`/watch/${encodeURIComponent(video.slug)}`);
  const description = seoDescription(
    video.description,
    `Watch ${video.title} from ${video.channel.name} on AYIN.`,
  );
  const image = mediaSeoUrl(video.thumbnail?.objectKey) ?? AYIN_DEFAULT_IMAGE;
  const contentUrl = mediaSeoUrl(video.source.objectKey);
  const indexable = video.visibility === "PUBLIC";

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
    twitter: {
      card: "summary_large_image",
      title: video.title,
      description,
      images: [image],
    },
  };
}

export default async function WatchPage({ params }: WatchPageProperties) {
  const { slug } = await params;
  const [response, seoVideo] = await Promise.all([
    fetch(`${apiBaseUrl}/public/videos/${encodeURIComponent(slug)}/playback`, {
      cache: "no-store",
    }),
    getSeoVideo(slug),
  ]);
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("This video could not be loaded right now.");
  const data = (await response.json()) as PublicPlaybackResponse;
  const sourceUrl = mediaAssetUrl(data.video.source.objectKey);
  if (!sourceUrl) throw new Error("AYIN media delivery is not configured for this client.");
  const captions = data.video.captions.flatMap((track) => {
    const src = mediaAssetUrl(track.objectKey);
    return src
      ? [
          {
            id: track.id,
            src,
            label: track.label,
            language: track.language,
            default: track.default,
          },
        ]
      : [];
  });

  const structuredData = seoVideo ? buildVideoStructuredData(seoVideo) : null;

  return (
    <main className={styles.page}>
      {structuredData ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
        />
      ) : null}
      <AnalyticsAyinPlayer
        autoPlay
        className={styles.playerFrame}
        captions={captions}
        chapters={data.video.chapters}
        durationMs={data.video.durationMs}
        progressPolicy={data.playerPolicy}
        sourceUrl={sourceUrl}
        title={data.video.title}
        videoId={data.video.id}
      />
      <section className={styles.details}>
        <div>
          <p className={styles.eyebrow}>AYIN video</p>
          <h1>{data.video.title}</h1>
          {data.video.description ? <p>{data.video.description}</p> : null}
          <VideoSocialActions className={styles.actions} videoId={data.video.id} />
        </div>
        <Link
          className={styles.channel}
          href={`/c/${encodeURIComponent(data.video.channel.handle)}`}
        >
          {data.video.channel.name} · @{data.video.channel.handle}
        </Link>
      </section>
      <PageAdSlot placementKey="watch_below_player" />
      {data.detail.related.length > 0 ? (
        <section className={styles.related}>
          <h2>More from {data.video.channel.name}</h2>
          <div>
            {data.detail.related.map((item) => (
              <Link data-tv-focusable="true" href={item.href} key={item.id}>
                <strong>{item.title}</strong>
                {item.durationMs ? <span>{Math.ceil(item.durationMs / 60_000)} min</span> : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      <CommentsPanel enabled={data.detail.commentsSlot.enabled} videoId={data.video.id} />
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
          {
            "@type": "ListItem",
            position: 1,
            name: "AYIN",
            item: absoluteUrl("/"),
          },
          {
            "@type": "ListItem",
            position: 2,
            name: video.channel.name,
            item: channelUrl,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: video.title,
            item: canonical,
          },
        ],
      },
    ],
  };
}
