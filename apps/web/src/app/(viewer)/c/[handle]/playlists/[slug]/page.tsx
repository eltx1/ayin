import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import styles from "@/components/playlist/public-playlist.module.css";
import { ActionLink, DataBadge, PageHeader } from "@/components/ui/design-system";
import { MediaCard } from "@/components/viewer/media-card";
import { EmptyState, ErrorState } from "@/components/viewer/view-states";
import { apiBaseUrl } from "@/lib/api";
import { mediaAssetUrl } from "@/lib/channel";
import { formatDate, formatNumber } from "@/lib/i18n/format";
import { translatePublicCreator } from "@/lib/i18n/public-creator";
import { localizePath } from "@/lib/i18n/routing";
import { getRequestLocale } from "@/lib/i18n/server";
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
  const [{ handle, slug }, locale] = await Promise.all([params, getRequestLocale()]);
  const playlist = await getSeoPlaylist(handle, slug);
  if (!playlist) {
    return {
      title: translatePublicCreator(locale, "playlist.unavailable"),
      robots: metadataRobots(false),
    };
  }

  const canonicalPath = localizePath(
    `/c/${encodeURIComponent(playlist.channel.handle)}/playlists/${encodeURIComponent(playlist.slug)}`,
    locale,
  );
  const canonical = absoluteUrl(canonicalPath);
  const description = seoDescription(
    playlist.description,
    translatePublicCreator(locale, "playlist.metaFallback", {
      playlist: playlist.name,
      channel: playlist.channel.name,
    }),
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
  const [{ handle, slug }, locale] = await Promise.all([params, getRequestLocale()]);
  const t = (
    key: Parameters<typeof translatePublicCreator>[1],
    values: Parameters<typeof translatePublicCreator>[2] = {},
  ) => translatePublicCreator(locale, key, values);
  const response = await fetch(
    `${apiBaseUrl}/public/channels/${encodeURIComponent(handle)}/playlists/${encodeURIComponent(slug)}`,
    { cache: "no-store" },
  );
  if (response.status === 404) notFound();
  if (!response.ok) {
    return (
      <main className={styles.page}>
        <ErrorState
          title={t("playlist.loadErrorTitle")}
          description={t("playlist.loadErrorDescription")}
          action={
            <div className={styles.errorActions}>
              <ActionLink
                data-tv-focusable="true"
                data-tv-focus-id="playlist-retry"
                href={localizePath(
                  `/c/${encodeURIComponent(handle)}/playlists/${encodeURIComponent(slug)}`,
                  locale,
                )}
              >
                {t("playlist.retry")}
              </ActionLink>
              <ActionLink
                tone="quiet"
                data-tv-focusable="true"
                data-tv-focus-id="playlist-channel"
                href={localizePath(`/c/${encodeURIComponent(handle)}`, locale)}
              >
                {t("playlist.openChannel")}
              </ActionLink>
            </div>
          }
        />
      </main>
    );
  }

  const data = (await response.json()) as PublicPlaylistResponse;
  if (data.redirectedFrom && data.canonicalHandle !== handle) {
    permanentRedirect(
      localizePath(
        `/c/${encodeURIComponent(data.canonicalHandle)}/playlists/${encodeURIComponent(data.playlist.slug)}`,
        locale,
      ),
    );
  }

  const seoPlaylist = await getSeoPlaylist(data.canonicalHandle, data.playlist.slug);
  const structuredData = seoPlaylist ? buildPlaylistStructuredData(seoPlaylist, locale) : null;
  const videoCount =
    data.items.length === 1
      ? t("playlist.video")
      : t("playlist.videoCount", { count: formatNumber(data.items.length, locale) });

  return (
    <main className={styles.page}>
      {structuredData ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
        />
      ) : null}

      <PageHeader
        {...(styles.hero ? { className: styles.hero } : {})}
        eyebrow={
          data.playlist.systemKey === "UPLOADS"
            ? t("playlist.channelUploads")
            : t("playlist.ayinPlaylist")
        }
        title={data.playlist.name}
        description={data.playlist.description ?? undefined}
        actions={
          <ActionLink
            data-tv-focusable="true"
            data-tv-focus-id="playlist-open-channel"
            href={localizePath(`/c/${data.channel.handle}`, locale)}
          >
            {t("playlist.openChannel")}
          </ActionLink>
        }
      >
        <div className={styles.metaRow}>
          <DataBadge>{videoCount}</DataBadge>
          {data.playlist.visibility === "UNLISTED" ? (
            <DataBadge tone="warning">{t("playlist.unlisted")}</DataBadge>
          ) : null}
        </div>
      </PageHeader>

      <section className={styles.section} aria-labelledby="playlist-videos-title">
        <PageHeader
          level={2}
          title={t("playlist.videos")}
          description={t("playlist.orderedByCreator")}
        />
        {data.items.length > 0 ? (
          <div className={styles.grid}>
            {data.items.map((item, index) => {
              const thumbnail = mediaAssetUrl(item.video.thumbnail?.objectKey);
              return (
                <MediaCard
                  {...(thumbnail ? { artworkUrl: thumbnail } : {})}
                  {...(item.video.durationMs
                    ? { badge: formatDuration(item.video.durationMs) }
                    : {})}
                  href={localizePath(
                    `/watch/${encodeURIComponent(item.video.slug)}`,
                    locale,
                  )}
                  key={item.id}
                  meta={
                    item.video.publishedAt
                      ? formatDate(item.video.publishedAt, locale, { dateStyle: "medium" })
                      : t("playlist.publishedOnAyin")
                  }
                  title={item.video.title}
                  tone={((index % 5) + 1) as 1 | 2 | 3 | 4 | 5}
                  variant="landscape"
                />
              );
            })}
          </div>
        ) : (
          <EmptyState
            title={t("playlist.emptyTitle")}
            description={t("playlist.emptyDescription")}
          />
        )}
      </section>
    </main>
  );
}

function buildPlaylistStructuredData(
  playlist: NonNullable<Awaited<ReturnType<typeof getSeoPlaylist>>>,
  locale: Awaited<ReturnType<typeof getRequestLocale>>,
) {
  const canonicalPath = localizePath(
    `/c/${encodeURIComponent(playlist.channel.handle)}/playlists/${encodeURIComponent(playlist.slug)}`,
    locale,
  );
  const canonical = absoluteUrl(canonicalPath);
  const channelUrl = absoluteUrl(
    localizePath(`/c/${encodeURIComponent(playlist.channel.handle)}`, locale),
  );
  const description = seoDescription(
    playlist.description,
    translatePublicCreator(locale, "playlist.metaFallback", {
      playlist: playlist.name,
      channel: playlist.channel.name,
    }),
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
            const videoUrl = absoluteUrl(
              localizePath(`/watch/${encodeURIComponent(item.video.slug)}`, locale),
            );
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
