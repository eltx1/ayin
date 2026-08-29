import Link from "next/link";
import { notFound } from "next/navigation";

import { AyinPlayer } from "@/components/player/ayin-player";
import { apiBaseUrl } from "@/lib/api";
import { type PublicPlaybackResponse } from "@/lib/ayin-player";
import { mediaAssetUrl } from "@/lib/channel";

import styles from "./page.module.css";

export default async function WatchPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const response = await fetch(`${apiBaseUrl}/public/videos/${encodeURIComponent(slug)}/playback`, {
    cache: "no-store",
  });
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("This video could not be loaded right now.");

  const data = (await response.json()) as PublicPlaybackResponse;
  const sourceUrl = mediaAssetUrl(data.video.source.objectKey);
  if (!sourceUrl) {
    throw new Error("AYIN media delivery is not configured for this client.");
  }
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

  return (
    <main className={styles.page}>
      <AyinPlayer
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
          <div className={styles.actions} aria-label="Content actions">
            <button disabled={!data.detail.saveHook.available} type="button">
              Save for later
            </button>
            <button type="button">Share</button>
          </div>
        </div>
        <Link
          className={styles.channel}
          href={`/c/${encodeURIComponent(data.video.channel.handle)}`}
        >
          {data.video.channel.name} · @{data.video.channel.handle}
        </Link>
      </section>
      <section
        className={styles.reservedSlot}
        data-ad-placement="watch_below_player"
        aria-label="Reserved advertising placement"
      />
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
      <section className={styles.commentsSlot} aria-label="Comments">
        <h2>Comments</h2>
        <p>
          {data.detail.commentsSlot.enabled
            ? "Comments will appear here when conversations launch."
            : "Comments are disabled for this video."}
        </p>
      </section>
    </main>
  );
}
