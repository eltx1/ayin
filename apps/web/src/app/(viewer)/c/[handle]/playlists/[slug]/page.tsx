import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";

import styles from "@/components/playlist/public-playlist.module.css";
import { apiBaseUrl } from "@/lib/api";
import { mediaAssetUrl } from "@/lib/channel";
import type { PublicPlaylistResponse } from "@/lib/playlist";

export default async function PublicPlaylistPage({
  params,
}: {
  params: Promise<{ handle: string; slug: string }>;
}) {
  const { handle, slug } = await params;
  const response = await fetch(
    `${apiBaseUrl}/public/channels/${encodeURIComponent(handle)}/playlists/${encodeURIComponent(slug)}`,
    { cache: "no-store" },
  );
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("This playlist could not be loaded right now.");

  const data = (await response.json()) as PublicPlaylistResponse;
  if (data.redirectedFrom && data.canonicalHandle !== handle) {
    permanentRedirect(
      `/c/${encodeURIComponent(data.canonicalHandle)}/playlists/${encodeURIComponent(data.playlist.slug)}`,
    );
  }

  return (
    <main className={styles.page}>
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
                <article className={styles.videoCard} key={item.id}>
                  <div
                    className={styles.thumbnail}
                    style={thumbnail ? { backgroundImage: `url("${thumbnail}")` } : undefined}
                  >
                    {item.video.durationMs ? (
                      <span className={styles.duration}>{formatDuration(item.video.durationMs)}</span>
                    ) : null}
                  </div>
                  <h3>{item.video.title}</h3>
                  <p>{formatDate(item.video.publishedAt)}</p>
                </article>
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
