"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { trackAnalyticsEvent } from "../../../lib/analytics";
import { apiBaseUrl } from "../../../lib/api";
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

async function socialMutation(path: string, method: "PUT" | "DELETE", body?: unknown) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401 || response.status === 403) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    return null;
  }
  return response.ok ? response.json() : null;
}

function persistWatchProgress(clip: ClipItem, video: HTMLVideoElement) {
  const durationMs = Number.isFinite(video.duration)
    ? Math.max(1, Math.round(video.duration * 1000))
    : (clip.durationMs ?? undefined);
  void fetch(`${apiBaseUrl}/watch/progress/${clip.id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      positionMs: Math.max(0, Math.round(video.currentTime * 1000)),
      ...(durationMs ? { durationMs } : {}),
    }),
  }).catch(() => undefined);
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
  const activeId = useRef<string | null>(null);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [subscribed, setSubscribed] = useState<Record<string, boolean>>({});
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((item) => [item.id, item._count.reactions])),
  );

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
            if (activeId.current && activeId.current !== videoId) {
              trackAnalyticsEvent("CLIP_SWIPE", {
                videoId,
                ...(channelId ? { channelId } : {}),
                metadata: { fromVideoId: activeId.current },
              });
            }
            activeId.current = videoId;
            trackAnalyticsEvent("CLIP_IMPRESSION", {
              videoId,
              ...(channelId ? { channelId } : {}),
            });
            if (autoplayEnabled && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
              void video
                .play()
                .then(() =>
                  trackAnalyticsEvent("CLIP_PLAY", {
                    videoId,
                    ...(channelId ? { channelId } : {}),
                  }),
                )
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

  async function toggleLike(clip: ClipItem) {
    const next = !liked[clip.id];
    const result = await socialMutation(
      `/social/videos/${clip.id}/reaction`,
      next ? "PUT" : "DELETE",
      next ? { type: "LIKE" } : undefined,
    );
    if (!result) return;
    setLiked((current) => ({ ...current, [clip.id]: next }));
    setLikeCounts((current) => ({
      ...current,
      [clip.id]: result.likeCount ?? current[clip.id] ?? 0,
    }));
    if (next) trackAnalyticsEvent("LIKE", { videoId: clip.id, channelId: clip.channel.id });
  }

  async function toggleSubscription(clip: ClipItem) {
    const next = !subscribed[clip.channel.id];
    const result = await socialMutation(
      `/social/channels/${clip.channel.id}/subscription`,
      next ? "PUT" : "DELETE",
      next ? {} : undefined,
    );
    if (!result) return;
    setSubscribed((current) => ({ ...current, [clip.channel.id]: next }));
    if (next) {
      trackAnalyticsEvent("SUBSCRIBE", { videoId: clip.id, channelId: clip.channel.id });
    }
  }

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
              onPause={(event) => persistWatchProgress(clip, event.currentTarget)}
              onEnded={(event) => {
                persistWatchProgress(clip, event.currentTarget);
                trackAnalyticsEvent("CLIP_COMPLETE", {
                  videoId: clip.id,
                  channelId: clip.channel.id,
                });
              }}
            />
            <div className={styles.overlay}>
              <div>
                <Link href={`/c/${clip.channel.handle}`}>@{clip.channel.handle}</Link>
                <h2>{clip.title}</h2>
                {clip.description ? <p>{clip.description}</p> : null}
              </div>
              <nav className={styles.actions} aria-label={`Actions for ${clip.title}`}>
                <button type="button" onClick={() => void toggleLike(clip)}>
                  {liked[clip.id] ? "♥" : "♡"} {likeCounts[clip.id] ?? clip._count.reactions}
                </button>
                <Link href={`/watch/${clip.slug}#comments`}>💬 {clip._count.comments}</Link>
                <button type="button" onClick={() => void toggleSubscription(clip)}>
                  {subscribed[clip.channel.id] ? "Subscribed" : "Subscribe"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const url = `${window.location.origin}/watch/${clip.slug}`;
                    trackAnalyticsEvent("CLIP_SHARE", {
                      videoId: clip.id,
                      channelId: clip.channel.id,
                    });
                    trackAnalyticsEvent("SHARE", {
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
