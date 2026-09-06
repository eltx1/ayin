import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";

import styles from "@/components/playlist/public-playlist.module.css";
import { apiBaseUrl } from "@/lib/api";
import { mediaAssetUrl } from "@/lib/channel";
import type { PublicPlaylistResponse } from "@/lib/playlist";
import { getSeoPlaylist } from "@/lib/seo-content";
import {
  absoluteUrl,
  AYIN_DEFAULT_IMAGE,
  isoDuration,
  mediaSeoUrl,
  metadataRobots,
  seoDescription,
  serializeJsonLd,
} from "@/lib/seo";

interface PublicPlaylistPageProperties {
  params: Promise<{ handle: string; slug: string }>;
}

export async function generateMetadata({
  params,
}: PublicPlaylistPageProperties): Promise<Metadata> {
  const { handle, slug } = await params;
  const playlist = await getSeoPlaylist(handle, slug);
  if (!playlist) {
    return { title: "Playlist unavailable", robots: metadataRobots(false) };
  }

  const canonical = absoluteUrl(
    `/c/${encodeURIComponent(playlist.channel.handle)}/playlists/${encodeURIComponent(playlist.slug)}`,
  );
  const description = seoDescription(
    playlist.description,
    `Watch ${playlist.name}, a video playlist from ${playlist.channel.name}, on AYIN.`,
  );
  const image = mediaSeoUrl(playlist.items[0]?.video.thumbnail?.objectKey) ?? AYIN_DEFAULT_IMAGE;
  const indexable = playlist.visibility === "PUBLIC" && playlist.items.length > 0;

  return {
    title: playlist.name,
    description,
    alternates: { canonical },
    robots: metadataRobots(indexable),
    openGraph: {
      type: "website",
      siteName: "AYIN",
      title: playlist.name,
      description,
      url: canonical,
      images: [{ url: image, alt: playlist.name }],
    },
    twitter: {
      card: "summary_large_image",
      title: playlist.name,
      description,
      images: [image],
    },
  };
}

export default async function PublicPlaylistPage({ params }: PublicPlaylistPageProperties) {
  const { handle, slug } = await params;
  const [response, seoPlaylist] = await Promise.all([
    fetch(
      `${apiBaseUrl}/public/channels/${encodeURIComponent(handle)}/playlists/${encodeURIComponent(slug)}`,
      { cache: "no-store" },
    ),
    getSeoPlaylist(handle, slug),
  ]);
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("This playlist could not be loaded right now.");

  const data = (await response.json()) as PublicPlaylistResponse;
  if (data.redirectedFrom && data.canonicalHandle !== handle) {
    permanentRedirect(
      `/c/${encodeURIComponent(data.canonicalHandle)}/playlists/${encodeURIComponent(data.playlist.slug)}`,
    );
  }

  const structuredData = seoPlaylist ? buildPlaylistStructuredData(seoPlaylist) : null;

  return (
    <main className={styles.page}>
      {structuredData ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
        />
      ) : null}
      <section className={styles.hero} aria-labelledby="playlist-title">
        <p className={styles.eyebrow}>
          {data.playlist.systemKey === "UPLOADS" ? "Channel uploads" : "AYIN playlist"}
        </p>
        <h1 id="playlist-title">{data.playlist.name}</h1>
        {data.playlist.description ? (
          <p className={styles.description}>{data.playlist.description}</p>
        ) : null}
        <div className={styles.metaRow}>
          <Link href={`/c/${data.channel.handle}`}>{data.channel.name}</Link>
          <span>
            {data.items.length} {data.items.length === 1 ? "video" : "videos"}
          </span>
          {data.playlist.visibility === "UNLISTED" ? <span>Unlisted</span> : null}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="playlist-videos-title">
        <div className={styles.sectionHeading}>
          <h2 id="playlist-videos-title">Videos</h2>
          <p>Ordered by the creator</p>
        </div>
        {data.items.length > 0 ? (
          <div className={styles.grid}>
            {data.items.map((item) => {
              const thumbnail = mediaAssetUrl(item.video.thumbnail?.objectKey);
              return (
                <Link
                  className={styles.videoCard}
                  href={`/watch/${encodeURIComponent(item.video.slug)}`}
                  key={item.id}
                >
                  <div
                    className={styles.thumbnail}
                    style={thumbnail ? { backgroundImage: `url("${thumbnail}")` } : undefined}
                  >
                    {item.video.durationMs ? (
                      <span className={styles.duration}>
                        {formatDuration(item.video.durationMs)}
                      </span>
                    ) : null}
                  </div>
                  <h3>{item.video.title}</h3>
                  <p>{formatDate(item.video.publishedAt)}</p>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className={styles.empty}>This playlist has no public videos yet.</p>
        )}
      </section>
    </main>
  );
}

function buildPlaylistStructuredData(
  playlist: NonNullable<Awaited<ReturnType<typeof getSeoPlaylist>>>,
) {
  const canonical = absoluteUrl(
    `/c/${encodeURIComponent(playlist.channel.handle)}/playlists/${encodeURIComponent(playlist.slug)}`,
  );
  const channelUrl = absoluteUrl(`/c/${encodeURIComponent(playlist.channel.handle)}`);
  const description = seoDescription(
    playlist.description,
    `Watch ${playlist.name}, a video playlist from ${playlist.channel.name}, on AYIN.`,
    500,
  );

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${canonical}#collection`,
        url: canonical,
        name: playlist.name,
        description,
        dateCreated: playlist.createdAt,
        dateModified: playlist.updatedAt,
        creator: {
          "@type": "Person",
          name: playlist.channel.name,
          alternateName: `@${playlist.channel.handle}`,
          url: channelUrl,
        },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: playlist.items.length,
          itemListOrder: "https://schema.org/ItemListOrderAscending",
          itemListElement: playlist.items.map((item, index) => {
            const videoUrl = absoluteUrl(`/watch/${encodeURIComponent(item.video.slug)}`);
            const thumbnail = mediaSeoUrl(item.video.thumbnail?.objectKey);
            return {
              "@type": "ListItem",
              position: index + 1,
              url: videoUrl,
              item: {
                "@type": "VideoObject",
                name: item.video.title,
                url: videoUrl,
                ...(item.video.description
                  ? { description: seoDescription(item.video.description, item.video.title, 500) }
                  : {}),
                ...(thumbnail ? { thumbnailUrl: [thumbnail] } : {}),
                ...(item.video.publishedAt ? { uploadDate: item.video.publishedAt } : {}),
                ...(isoDuration(item.video.durationMs)
                  ? { duration: isoDuration(item.video.durationMs) }
                  : {}),
              },
            };
          }),
        },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${canonical}#breadcrumbs`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "AYIN", item: absoluteUrl("/") },
          {
            "@type": "ListItem",
            position: 2,
            name: playlist.channel.name,
            item: channelUrl,
          },
          { "@type": "ListItem", position: 3, name: playlist.name, item: canonical },
        ],
      },
    ],
  };
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatDate(value: string | null): string {
  if (!value) return "Published on AYIN";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}
