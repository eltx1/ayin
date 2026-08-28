import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import type { CSSProperties } from "react";

import { OwnerChannelActions } from "@/components/channel/owner-channel-actions";
import styles from "@/components/channel/public-channel.module.css";
import { apiBaseUrl } from "@/lib/api";
import {
  channelTabs,
  mediaAssetUrl,
  type PublicChannelResponse,
  resolveChannelTab,
} from "@/lib/channel";

export default async function PublicChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const [{ handle }, query] = await Promise.all([params, searchParams]);
  const response = await fetch(`${apiBaseUrl}/public/channels/${encodeURIComponent(handle)}`, {
    cache: "no-store",
  });
  if (response.status === 404) notFound();
  if (!response.ok) {
    throw new Error("This channel could not be loaded right now.");
  }

  const data = (await response.json()) as PublicChannelResponse;
  if (data.redirectedFrom && data.canonicalHandle !== handle) {
    permanentRedirect(`/c/${encodeURIComponent(data.canonicalHandle)}`);
  }

  const activeTab = resolveChannelTab(query.tab, data.features);
  const tabs = channelTabs(data.features);
  const avatarUrl = mediaAssetUrl(data.appearance.avatar?.objectKey);
  const bannerUrl = mediaAssetUrl(data.appearance.banner?.objectKey);
  const accent = data.appearance.accentColor ?? "#63D1CC";
  const initial = data.channel.name.trim().charAt(0).toUpperCase() || "A";

  return (
    <main
      className={styles.page}
      style={{ "--channel-accent": accent } as CSSProperties}
    >
      <div
        className={styles.banner}
        style={bannerUrl ? { backgroundImage: `url("${bannerUrl}")` } : undefined}
        aria-label={`${data.channel.name} channel banner`}
      />

      <section className={styles.identity} aria-labelledby="channel-name">
        <div
          className={styles.avatar}
          style={avatarUrl ? { backgroundImage: `url("${avatarUrl}")` } : undefined}
          aria-label={`${data.channel.name} avatar`}
        >
          {avatarUrl ? null : initial}
        </div>

        <div className={styles.identityCopy}>
          <h1 id="channel-name">{data.channel.name}</h1>
          <p className={styles.handle}>@{data.channel.handle}</p>
          {data.channel.description ? (
            <p className={styles.summary}>{shorten(data.channel.description, 220)}</p>
          ) : null}
        </div>

        <div className={styles.actions}>
          <button
            className={styles.subscribe}
            type="button"
            disabled
            aria-disabled="true"
            title="Channel subscriptions are not enabled yet."
          >
            Subscribe
          </button>
          <OwnerChannelActions handle={data.channel.handle} />
        </div>
      </section>

      <nav aria-label="Channel sections" className={styles.tabs}>
        {tabs.map((tab) => (
          <Link
            className={`${styles.tab} ${activeTab === tab.id ? styles.activeTab : ""}`}
            href={tab.id === "home" ? `/c/${data.channel.handle}` : `/c/${data.channel.handle}?tab=${tab.id}`}
            key={tab.id}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className={styles.content}>
        {activeTab === "home" ? (
          <>
            <CreatorTvSection data={data} />
            <VideoSection data={data} limit={8} />
            <PlaylistSection data={data} limit={4} />
          </>
        ) : null}
        {activeTab === "videos" ? <VideoSection data={data} /> : null}
        {activeTab === "tv" ? <CreatorTvSection data={data} /> : null}
        {activeTab === "playlists" ? <PlaylistSection data={data} /> : null}
        {activeTab === "about" ? <AboutSection data={data} /> : null}
        {activeTab === "shorts" || activeTab === "posts" ? (
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <h2>{activeTab === "shorts" ? "Shorts" : "Posts"}</h2>
            </div>
            <p className={styles.empty}>Nothing has been published here yet.</p>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function CreatorTvSection({ data }: { data: PublicChannelResponse }) {
  return (
    <section className={styles.section} aria-labelledby="creator-tv-title">
      <div className={styles.sectionHeading}>
        <h2 id="creator-tv-title">Creator TV</h2>
      </div>
      {data.creatorTv ? (
        <div className={styles.tvCard}>
          <div>
            <span className={styles.tvEyebrow}>AYIN Creator TV</span>
            <h3>{data.creatorTv.name}</h3>
            <p className={styles.summary}>
              The channel&apos;s automatic television destination, built from eligible published
              videos.
            </p>
          </div>
          <span className={styles.status}>{formatTvStatus(data.creatorTv.status)}</span>
        </div>
      ) : (
        <p className={styles.empty}>This channel&apos;s Creator TV is not available.</p>
      )}
    </section>
  );
}

function VideoSection({
  data,
  limit,
}: {
  data: PublicChannelResponse;
  limit?: number;
}) {
  const videos = limit ? data.videos.slice(0, limit) : data.videos;
  return (
    <section className={styles.section} aria-labelledby="channel-videos-title">
      <div className={styles.sectionHeading}>
        <h2 id="channel-videos-title">Videos</h2>
        <p>{videos.length === 0 ? "No published videos yet" : "Published on AYIN"}</p>
      </div>
      {videos.length > 0 ? (
        <div className={styles.videoGrid}>
          {videos.map((video) => {
            const thumbnail = mediaAssetUrl(video.thumbnail?.objectKey);
            return (
              <article className={styles.videoCard} key={video.id}>
                <div
                  className={styles.thumbnail}
                  style={thumbnail ? { backgroundImage: `url("${thumbnail}")` } : undefined}
                >
                  {video.durationMs ? (
                    <span className={styles.duration}>{formatDuration(video.durationMs)}</span>
                  ) : null}
                </div>
                <h3>{video.title}</h3>
                <p className={styles.meta}>{formatDate(video.publishedAt)}</p>
              </article>
            );
          })}
        </div>
      ) : (
        <p className={styles.empty}>Published videos from this creator will appear here.</p>
      )}
    </section>
  );
}

function PlaylistSection({
  data,
  limit,
}: {
  data: PublicChannelResponse;
  limit?: number;
}) {
  const playlists = limit ? data.playlists.slice(0, limit) : data.playlists;
  return (
    <section className={styles.section} aria-labelledby="channel-playlists-title">
      <div className={styles.sectionHeading}>
        <h2 id="channel-playlists-title">Playlists</h2>
      </div>
      {playlists.length > 0 ? (
        <div className={styles.playlistGrid}>
          {playlists.map((playlist) => (
            <article className={styles.playlistCard} key={playlist.id}>
              <h3>{playlist.name}</h3>
              <p>{playlist.description || "A public collection from this channel."}</p>
              <p className={styles.meta}>
                {playlist.itemCount} {playlist.itemCount === 1 ? "video" : "videos"}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>Public playlists from this creator will appear here.</p>
      )}
    </section>
  );
}

function AboutSection({ data }: { data: PublicChannelResponse }) {
  return (
    <section className={styles.about} aria-labelledby="channel-about-title">
      <h2 id="channel-about-title">About</h2>
      <p>{data.channel.description || "This creator has not added a channel description yet."}</p>
      <dl>
        <dt>Handle</dt>
        <dd>@{data.channel.handle}</dd>
        <dt>Joined AYIN</dt>
        <dd>{formatDate(data.channel.createdAt)}</dd>
      </dl>
    </section>
  );
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
  if (!value) return "Recently published";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}

function formatTvStatus(status: "ACTIVE" | "OFF_AIR" | "DISABLED"): string {
  if (status === "ACTIVE") return "On AYIN";
  if (status === "OFF_AIR") return "Off air";
  return "Unavailable";
}

function shorten(value: string, length: number): string {
  if (value.length <= length) return value;
  return `${value.slice(0, length - 1).trimEnd()}…`;
}
