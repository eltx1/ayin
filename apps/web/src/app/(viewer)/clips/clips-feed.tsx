"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

import { trackAnalyticsEvent } from "../../../lib/analytics";
import styles from "./clips.module.css";

export interface ClipItem {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  durationMs: number | null;
  channel: { id: string; handle: string; name: string };
  mediaAssets: Array<{ kind: "SOURCE_VIDEO" | "THUMBNAIL"; r2ObjectKey: string }>;
  _count: { reactions: number; comments: number };
}

function mediaUrl(key: string) {
  const base = process.env.NEXT_PUBLIC_MEDIA_BASE_URL?.replace(/\/$/, "") ?? "";
  return base ? `${base}/${key}` : key;
}

export function ClipsFeed({
  items,
  autoplayEnabled,
  adPolicy,
}: {
  items: ClipItem[];
  autoplayEnabled: boolean;
  adPolicy: { enabled: boolean; minimumOrganicClips: number };
}) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = root.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const article = entry.target as HTMLElement;
          const video = article.querySelector("video");
          const videoId = article.dataset.videoId;
          const channelId = article.dataset.channelId;
          if (!video || !videoId) continue;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.7) {
            trackAnalyticsEvent("CLIP_IMPRESSION", { videoId, channelId });
            if (autoplayEnabled && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
              void video
                .play()
                .then(() => trackAnalyticsEvent("CLIP_PLAY", { videoId, channelId }))
                .catch(() => undefined);
            }
          } else {
            video.pause();
          }
        }
      },
      { root: container, threshold: [0.7] },
    );
    container.querySelectorAll("article").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [autoplayEnabled]);

  return (
    <div ref={root} className={styles.feed} aria-label="AYIN Clips feed">
      {items.map((clip, index) => {
        const source = clip.mediaAssets.find((asset) => asset.kind === "SOURCE_VIDEO");
        if (!source) return null;
        return (
          <article
            className={styles.clip}
            key={clip.id}
            data-video-id={clip.id}
            data-channel-id={clip.channel.id}
            tabIndex={0}
          >
            <video
              className={styles.video}
              src={mediaUrl(source.r2ObjectKey)}
              playsInline
              muted
              controls
              preload="metadata"
              onEnded={() =>
                trackAnalyticsEvent("CLIP_COMPLETE", {
                  videoId: clip.id,
                  channelId: clip.channel.id,
                })
              }
            />
            <div className={styles.overlay}>
              <div>
                <Link href={`/c/${clip.channel.handle}`}>@{clip.channel.handle}</Link>
                <h2>{clip.title}</h2>
                {clip.description ? <p>{clip.description}</p> : null}
              </div>
              <nav className={styles.actions} aria-label={`Actions for ${clip.title}`}>
                <Link href={`/watch/${clip.slug}`}>♡ {clip._count.reactions}</Link>
                <Link href={`/watch/${clip.slug}#comments`}>💬 {clip._count.comments}</Link>
                <Link href={`/c/${clip.channel.handle}`}>Subscribe</Link>
                <button
                  type="button"
                  onClick={() => {
                    const url = `${window.location.origin}/watch/${clip.slug}`;
                    trackAnalyticsEvent("CLIP_SHARE", {
                      videoId: clip.id,
                      channelId: clip.channel.id,
                    });
                    void (navigator.share
                      ? navigator.share({ title: clip.title, url })
                      : navigator.clipboard.writeText(url));
                  }}
                >
                  Share
                </button>
              </nav>
            </div>
            {adPolicy.enabled && (index + 1) % adPolicy.minimumOrganicClips === 0 ? (
              <span className={styles.adBoundary} aria-label="Clip ad opportunity boundary">
                Ad opportunity
              </span>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
