import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import type { CSSProperties } from "react";

import { OwnerChannelActions } from "@/components/channel/owner-channel-actions";
import { SubscribeButton } from "@/components/social/subscribe-button";
import styles from "@/components/channel/public-channel.module.css";
import { apiBaseUrl } from "@/lib/api";
import {
  channelTabs,
  mediaAssetUrl,
  type PublicChannelResponse,
  resolveChannelTab,
} from "@/lib/channel";
import type { Locale } from "@/lib/i18n/config";
import { formatDate, formatNumber } from "@/lib/i18n/format";
import { localizePath } from "@/lib/i18n/routing";
import { getRequestLocale } from "@/lib/i18n/server";
import { translate, type TranslationKey, type TranslationValues } from "@/lib/i18n/translator";
import { getSeoChannel } from "@/lib/seo-content";
import {
  absoluteUrl,
  AYIN_DEFAULT_IMAGE,
  mediaSeoUrl,
  metadataRobots,
  seoDescription,
  serializeJsonLd,
} from "@/lib/seo";

interface PublicChannelPageProperties {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}

export async function generateMetadata({ params }: PublicChannelPageProperties): Promise<Metadata> {
  const [{ handle }, locale] = await Promise.all([params, getRequestLocale()]);
  const channel = await getSeoChannel(handle);
  if (!channel) return { title: translate(locale, "channel.unavailable"), robots: metadataRobots(false) };

  const canonical = absoluteUrl(localizePath(`/c/${encodeURIComponent(channel.handle)}`, locale));
  const description = seoDescription(
    channel.description,
    locale === "ar"
      ? `شاهد فيديوهات ${channel.name} وقوائم التشغيل والبث على AYIN.`
      : `Watch videos, playlists and streaming from ${channel.name} (@${channel.handle}) on AYIN.`,
  );
  const image = mediaSeoUrl(channel.banner?.objectKey) ?? mediaSeoUrl(channel.avatar?.objectKey) ?? AYIN_DEFAULT_IMAGE;

  return {
    title: channel.name,
    description,
    alternates: { canonical },
    robots: metadataRobots(true),
    openGraph: {
      type: "profile",
      siteName: "AYIN",
      title: `${channel.name} (@${channel.handle})`,
      description,
      url: canonical,
      images: [{ url: image, alt: `${channel.name} on AYIN` }],
    },
    twitter: { card: "summary_large_image", title: `${channel.name} (@${channel.handle})`, description, images: [image] },
  };
}

export default async function PublicChannelPage({ params, searchParams }: PublicChannelPageProperties) {
  const [{ handle }, query, locale] = await Promise.all([params, searchParams, getRequestLocale()]);
  const t = (key: TranslationKey, values?: TranslationValues) => translate(locale, key, values);
  const [response, seoChannel] = await Promise.all([
    fetch(`${apiBaseUrl}/public/channels/${encodeURIComponent(handle)}`, { cache: "no-store" }),
    getSeoChannel(handle),
  ]);
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error(t("channel.loadError"));

  const data = (await response.json()) as PublicChannelResponse;
  if (data.redirectedFrom && data.canonicalHandle !== handle) {
    permanentRedirect(localizePath(`/c/${encodeURIComponent(data.canonicalHandle)}`, locale));
  }

  const activeTab = resolveChannelTab(query.tab, data.features);
  const tabs = channelTabs(data.features);
  const avatarUrl = mediaAssetUrl(data.appearance.avatar?.objectKey);
  const bannerUrl = mediaAssetUrl(data.appearance.banner?.objectKey);
  const accent = data.appearance.accentColor ?? "#63D1CC";
  const initial = data.channel.name.trim().charAt(0).toUpperCase() || "A";
  const structuredData = seoChannel ? buildChannelStructuredData(seoChannel) : null;

  return (
    <main className={styles.page} style={{ "--channel-accent": accent } as CSSProperties}>
      {structuredData ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} /> : null}
      <div
        className={styles.banner}
        style={bannerUrl ? { backgroundImage: `url("${bannerUrl}")` } : undefined}
        aria-label={t("channel.bannerAria", { name: data.channel.name })}
      />

      <section className={styles.identity} aria-labelledby="channel-name">
        <div
          className={styles.avatar}
          style={avatarUrl ? { backgroundImage: `url("${avatarUrl}")` } : undefined}
          aria-label={t("channel.avatarAria", { name: data.channel.name })}
        >
          {avatarUrl ? null : initial}
        </div>

        <div className={styles.identityCopy}>
          <h1 dir="auto" id="channel-name">{data.channel.name}</h1>
          <p className={styles.handle} dir="ltr">@{data.channel.handle}</p>
          {data.channel.description ? <p className={styles.summary} dir="auto">{shorten(data.channel.description, 220)}</p> : null}
        </div>

        <div className={styles.actions}>
          <SubscribeButton channelId={data.channel.id} className={styles.subscribe} initialCount={data.subscription.subscriberCount} />
          <OwnerChannelActions handle={data.channel.handle} />
        </div>
      </section>

      <nav aria-label={t("channel.sections")} className={styles.tabs}>
        {tabs.map((tab) => (
          <Link
            className={`${styles.tab} ${activeTab === tab.id ? styles.activeTab : ""}`}
            href={localizePath(tab.id === "home" ? `/c/${data.channel.handle}` : `/c/${data.channel.handle}?tab=${tab.id}`, locale)}
            key={tab.id}
          >
            {channelTabLabel(tab.id, tab.label, locale)}
          </Link>
        ))}
      </nav>

      <div className={styles.content}>
        {activeTab === "home" ? <><CreatorTvSection data={data} locale={locale} /><VideoSection data={data} limit={8} locale={locale} /><PlaylistSection data={data} limit={4} locale={locale} /></> : null}
        {activeTab === "videos" ? <VideoSection data={data} locale={locale} /> : null}
        {activeTab === "tv" ? <CreatorTvSection data={data} locale={locale} /> : null}
        {activeTab === "playlists" ? <PlaylistSection data={data} locale={locale} /> : null}
        {activeTab === "about" ? <AboutSection data={data} locale={locale} /> : null}
        {activeTab === "shorts" || activeTab === "posts" ? (
          <section className={styles.section}>
            <div className={styles.sectionHeading}><h2>{activeTab === "shorts" ? t("channel.tab.shorts") : t("channel.tab.posts")}</h2></div>
            <p className={styles.empty}>{t("channel.emptySection")}</p>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function CreatorTvSection({ data, locale }: { data: PublicChannelResponse; locale: Locale }) {
  const t = (key: TranslationKey, values?: TranslationValues) => translate(locale, key, values);
  return (
    <section className={styles.section} aria-labelledby="creator-tv-title">
      <div className={styles.sectionHeading}><h2 id="creator-tv-title">{t("channel.creatorTv")}</h2></div>
      {data.creatorTv ? (
        <div className={styles.tvCard}>
          <div>
            <span className={styles.tvEyebrow}>{t("channel.creatorTvEyebrow")}</span>
            <h3 dir="auto">{data.creatorTv.name}</h3>
            <p className={styles.summary}>{t("channel.creatorTvDescription")}</p>
          </div>
          <Link className={styles.status} href={localizePath(`/c/${data.channel.handle}/tv`, locale)}>
            {t("channel.watch")} · {formatTvStatus(data.creatorTv.status, locale)}
          </Link>
        </div>
      ) : <p className={styles.empty}>{t("channel.creatorTvUnavailable")}</p>}
    </section>
  );
}

function VideoSection({ data, limit, locale }: { data: PublicChannelResponse; limit?: number; locale: Locale }) {
  const t = (key: TranslationKey) => translate(locale, key);
  const videos = limit ? data.videos.slice(0, limit) : data.videos;
  return (
    <section className={styles.section} aria-labelledby="channel-videos-title">
      <div className={styles.sectionHeading}>
        <h2 id="channel-videos-title">{t("channel.videos")}</h2>
        <p>{videos.length === 0 ? t("channel.noPublishedVideos") : t("channel.publishedOnAyin")}</p>
      </div>
      {videos.length > 0 ? (
        <div className={styles.videoGrid}>
          {videos.map((video) => {
            const thumbnail = mediaAssetUrl(video.thumbnail?.objectKey);
            return (
              <Link className={styles.videoCard} href={localizePath(`/watch/${encodeURIComponent(video.slug)}`, locale)} key={video.id}>
                <div className={styles.thumbnail} style={thumbnail ? { backgroundImage: `url("${thumbnail}")` } : undefined}>
                  {video.durationMs ? <span className={styles.duration} dir="ltr">{formatDuration(video.durationMs)}</span> : null}
                </div>
                <h3 dir="auto">{video.title}</h3>
                <p className={styles.meta}>{formatPublishedDate(video.publishedAt, locale)}</p>
              </Link>
            );
          })}
        </div>
      ) : <p className={styles.empty}>{t("channel.videosEmpty")}</p>}
    </section>
  );
}

function PlaylistSection({ data, limit, locale }: { data: PublicChannelResponse; limit?: number; locale: Locale }) {
  const t = (key: TranslationKey, values?: TranslationValues) => translate(locale, key, values);
  const playlists = limit ? data.playlists.slice(0, limit) : data.playlists;
  return (
    <section className={styles.section} aria-labelledby="channel-playlists-title">
      <div className={styles.sectionHeading}><h2 id="channel-playlists-title">{t("channel.playlists")}</h2></div>
      {playlists.length > 0 ? (
        <div className={styles.playlistGrid}>
          {playlists.map((playlist) => (
            <Link className={styles.playlistCard} href={localizePath(`/c/${data.channel.handle}/playlists/${playlist.slug}`, locale)} key={playlist.id}>
              <h3 dir="auto">{playlist.name}</h3>
              <p dir="auto">{playlist.description || t("channel.publicCollection")}</p>
              <p className={styles.meta}>{playlist.itemCount === 1 ? t("channel.oneVideo") : t("channel.videoCount", { count: formatNumber(playlist.itemCount, locale) })}</p>
            </Link>
          ))}
        </div>
      ) : <p className={styles.empty}>{t("channel.playlistsEmpty")}</p>}
    </section>
  );
}

function AboutSection({ data, locale }: { data: PublicChannelResponse; locale: Locale }) {
  const t = (key: TranslationKey) => translate(locale, key);
  return (
    <section className={styles.about} aria-labelledby="channel-about-title">
      <h2 id="channel-about-title">{t("channel.about")}</h2>
      <p dir="auto">{data.channel.description || t("channel.noDescription")}</p>
      <dl>
        <dt>{t("channel.handle")}</dt><dd dir="ltr">@{data.channel.handle}</dd>
        <dt>{t("channel.joined")}</dt><dd>{formatPublishedDate(data.channel.createdAt, locale)}</dd>
      </dl>
    </section>
  );
}

function channelTabLabel(id: string, fallback: string, locale: Locale) {
  const keys: Record<string, TranslationKey> = {
    home: "channel.tab.home", videos: "channel.tab.videos", shorts: "channel.tab.shorts", posts: "channel.tab.posts",
    playlists: "channel.tab.playlists", tv: "channel.tab.tv", about: "channel.tab.about",
  };
  return keys[id] ? translate(locale, keys[id]) : fallback;
}

function buildChannelStructuredData(channel: NonNullable<Awaited<ReturnType<typeof getSeoChannel>>>) {
  const canonical = absoluteUrl(`/c/${encodeURIComponent(channel.handle)}`);
  const image = mediaSeoUrl(channel.avatar?.objectKey) ?? mediaSeoUrl(channel.banner?.objectKey);
  const description = seoDescription(channel.description, `Watch videos, playlists and streaming from ${channel.name} (@${channel.handle}) on AYIN.`, 500);
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "ProfilePage", "@id": `${canonical}#profile`, url: canonical, dateCreated: channel.createdAt, dateModified: channel.updatedAt,
        mainEntity: { "@type": "Person", "@id": `${canonical}#creator`, name: channel.name, alternateName: `@${channel.handle}`, description, url: canonical, ...(image ? { image } : {}) } },
      { "@type": "BreadcrumbList", "@id": `${canonical}#breadcrumbs`, itemListElement: [
        { "@type": "ListItem", position: 1, name: "AYIN", item: absoluteUrl("/") },
        { "@type": "ListItem", position: 2, name: channel.name, item: canonical },
      ] },
    ],
  };
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}` : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatPublishedDate(value: string | null, locale: Locale): string {
  return value ? formatDate(value, locale, { dateStyle: "medium" }) : translate(locale, "channel.recentlyPublished");
}

function formatTvStatus(status: "ACTIVE" | "OFF_AIR" | "DISABLED", locale: Locale): string {
  if (status === "ACTIVE") return translate(locale, "channel.tvActive");
  if (status === "OFF_AIR") return translate(locale, "channel.tvOffAir");
  return translate(locale, "channel.tvUnavailable");
}

function shorten(value: string, length: number): string {
  if (value.length <= length) return value;
  return `${value.slice(0, length - 1).trimEnd()}…`;
}
