"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { ActionButton, StatusNotice } from "@/components/ui/design-system";
import { trackAnalyticsEvent } from "@/lib/analytics";
import { apiBaseUrl } from "@/lib/api";
import { mediaAssetUrl } from "@/lib/channel";
import { mergeClipItems, parseClipsPage, type ClipItem, type ClipsPage } from "@/lib/clips";
import { translateClips } from "@/lib/i18n/clips";
import {
  parseChannelSocialState,
  parseVideoSocialState,
  type ChannelSocialState,
  type VideoSocialState,
} from "@/lib/social-action-contracts";

import styles from "./clips.module.css";

type ActionMode = "loading" | "ready" | "signedOut" | "error" | "uncertain";

interface ActionSnapshot {
  mode: ActionMode;
  video: VideoSocialState;
  channel: ChannelSocialState;
}

function initialActions(clip: ClipItem): ActionSnapshot {
  return {
    mode: "loading",
    video: {
      reaction: null,
      likeCount: clip._count.reactions,
      watchLater: false,
      myList: false,
    },
    channel: { subscribed: false, subscriberCount: 0 },
  };
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

function ClipActions({ clip }: { clip: ClipItem }) {
  const router = useRouter();
  const { locale, href, formatNumber } = useI18n();
  const t = useCallback(
    (key: Parameters<typeof translateClips>[1], values = {}) => translateClips(locale, key, values),
    [locale],
  );
  const [snapshot, setSnapshot] = useState<ActionSnapshot>(() => initialActions(clip));
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<"like" | "subscribe" | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const requestedVideoId = clip.id;
    const requestedChannelId = clip.channel.id;

    void Promise.all([
      fetch(`${apiBaseUrl}/social/videos/${requestedVideoId}`, {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      }),
      fetch(`${apiBaseUrl}/social/channels/${requestedChannelId}`, {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      }),
    ])
      .then(async ([videoResponse, channelResponse]) => {
        if (videoResponse.status === 401 || channelResponse.status === 401) {
          return { ...initialActions(clip), mode: "signedOut" as const };
        }
        if (!videoResponse.ok || !channelResponse.ok) throw new Error("CLIP_ACTIONS_UNAVAILABLE");
        return {
          mode: "ready" as const,
          video: parseVideoSocialState(await videoResponse.json()),
          channel: parseChannelSocialState(await channelResponse.json()),
        };
      })
      .then((value) => {
        if (!controller.signal.aborted) setSnapshot(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSnapshot((current) => ({ ...current, mode: "error" }));
        }
      });

    return () => controller.abort();
  }, [attempt, clip.channel.id, clip.id]);

  function signIn() {
    router.push(href("/login"));
  }

  function refresh() {
    if (pending) return;
    setSnapshot((current) => ({ ...current, mode: "loading" }));
    setAttempt((value) => value + 1);
  }

  async function toggleLike() {
    if (snapshot.mode === "signedOut") {
      signIn();
      return;
    }
    if (snapshot.mode !== "ready" || pending) return;

    const removing = snapshot.video.reaction === "LIKE";
    setPending("like");
    try {
      const response = await fetch(`${apiBaseUrl}/social/videos/${clip.id}/reaction`, {
        method: removing ? "DELETE" : "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        ...(removing ? {} : { body: JSON.stringify({ type: "LIKE" }) }),
      });
      if (response.status === 401) {
        setSnapshot((current) => ({ ...current, mode: "signedOut" }));
        signIn();
        return;
      }
      if (!response.ok) throw new Error("CLIP_LIKE_UNCONFIRMED");
      const video = parseVideoSocialState(await response.json());
      setSnapshot((current) => ({ ...current, mode: "ready", video }));
      if (!removing) {
        trackAnalyticsEvent("LIKE", { videoId: clip.id, channelId: clip.channel.id });
      }
    } catch {
      setSnapshot((current) => ({ ...current, mode: "uncertain" }));
    } finally {
      setPending(null);
    }
  }

  async function toggleSubscription() {
    if (snapshot.mode === "signedOut") {
      signIn();
      return;
    }
    if (snapshot.mode !== "ready" || pending) return;

    const removing = snapshot.channel.subscribed;
    setPending("subscribe");
    try {
      const response = await fetch(
        `${apiBaseUrl}/social/channels/${clip.channel.id}/subscription`,
        {
          method: removing ? "DELETE" : "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          ...(removing ? {} : { body: "{}" }),
        },
      );
      if (response.status === 401) {
        setSnapshot((current) => ({ ...current, mode: "signedOut" }));
        signIn();
        return;
      }
      if (!response.ok) throw new Error("CLIP_SUBSCRIPTION_UNCONFIRMED");
      const channel = parseChannelSocialState(await response.json());
      setSnapshot((current) => ({ ...current, mode: "ready", channel }));
      if (!removing) {
        trackAnalyticsEvent("SUBSCRIBE", { videoId: clip.id, channelId: clip.channel.id });
      }
    } catch {
      setSnapshot((current) => ({ ...current, mode: "uncertain" }));
    } finally {
      setPending(null);
    }
  }

  async function share() {
    const url = `${window.location.origin}${href(`/watch/${clip.slug}`)}`;
    try {
      if (navigator.share) await navigator.share({ title: clip.title, url });
      else await navigator.clipboard.writeText(url);
      trackAnalyticsEvent("CLIP_SHARE", { videoId: clip.id, channelId: clip.channel.id });
      trackAnalyticsEvent("SHARE", { videoId: clip.id, channelId: clip.channel.id });
    } catch {
      // Closing a share sheet or unavailable clipboard is a normal non-mutation outcome.
    }
  }

  const mutationDisabled =
    snapshot.mode === "loading" || snapshot.mode === "error" || snapshot.mode === "uncertain";
  const feedback =
    snapshot.mode === "loading"
      ? t("clips.actionsLoading")
      : snapshot.mode === "error"
        ? t("clips.actionsUnavailable")
        : snapshot.mode === "uncertain"
          ? t("clips.actionsUncertain")
          : null;

  return (
    <div className={styles.actionWorkspace}>
      <nav className={styles.actions} aria-label={t("clips.actions", { title: clip.title })}>
        <ActionButton
          className={styles.clipAction}
          tone="quiet"
          type="button"
          aria-pressed={snapshot.video.reaction === "LIKE"}
          data-tv-focusable="true"
          data-tv-focus-id={`clip-${clip.id}-like`}
          disabled={mutationDisabled || Boolean(pending)}
          pending={pending === "like"}
          onClick={() => void toggleLike()}
        >
          {snapshot.video.reaction === "LIKE" ? t("clips.liked") : t("clips.like")} ·{" "}
          {formatNumber(snapshot.video.likeCount)}
        </ActionButton>
        <ActionButton
          className={styles.clipAction}
          tone="quiet"
          type="button"
          aria-pressed={snapshot.channel.subscribed}
          data-tv-focusable="true"
          data-tv-focus-id={`clip-${clip.id}-subscribe`}
          disabled={mutationDisabled || Boolean(pending)}
          pending={pending === "subscribe"}
          onClick={() => void toggleSubscription()}
        >
          {snapshot.channel.subscribed ? t("clips.subscribed") : t("clips.subscribe")}
        </ActionButton>
        <ActionButton
          className={styles.clipAction}
          tone="quiet"
          type="button"
          data-tv-focusable="true"
          data-tv-focus-id={`clip-${clip.id}-share`}
          onClick={() => void share()}
        >
          {t("clips.share")}
        </ActionButton>
      </nav>
      {feedback ? (
        <StatusNotice
          className={styles.actionFeedback}
          tone={
            snapshot.mode === "uncertain"
              ? "warning"
              : snapshot.mode === "error"
                ? "danger"
                : "info"
          }
          announce={snapshot.mode === "loading" ? "polite" : "assertive"}
        >
          {feedback}
          {snapshot.mode === "error" || snapshot.mode === "uncertain" ? (
            <div className={styles.feedbackActions}>
              <ActionButton
                type="button"
                tone="secondary"
                data-tv-focusable="true"
                data-tv-focus-id={`clip-${clip.id}-actions-refresh`}
                onClick={refresh}
              >
                {t("clips.refreshActions")}
              </ActionButton>
            </div>
          ) : null}
        </StatusNotice>
      ) : null}
    </div>
  );
}

export function ClipsFeed({ initialPage }: { initialPage: ClipsPage }) {
  const { locale, href } = useI18n();
  const t = useCallback(
    (key: Parameters<typeof translateClips>[1]) => translateClips(locale, key),
    [locale],
  );
  const root = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(initialPage.items[0]?.id ?? null);
  const impressed = useRef(new Set<string>());
  const [activeId, setActiveId] = useState<string | null>(initialPage.items[0]?.id ?? null);
  const [items, setItems] = useState<ClipItem[]>(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [autoplayEnabled, setAutoplayEnabled] = useState(initialPage.autoplayEnabled);
  const [adPolicy, setAdPolicy] = useState(initialPage.adPolicy);
  const [loadMorePending, setLoadMorePending] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);

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
            if (activeIdRef.current && activeIdRef.current !== videoId) {
              trackAnalyticsEvent("CLIP_SWIPE", {
                videoId,
                ...(channelId ? { channelId } : {}),
                metadata: { fromVideoId: activeIdRef.current },
              });
            }
            activeIdRef.current = videoId;
            setActiveId(videoId);
            if (!impressed.current.has(videoId)) {
              impressed.current.add(videoId);
              trackAnalyticsEvent("CLIP_IMPRESSION", {
                videoId,
                ...(channelId ? { channelId } : {}),
              });
            }
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
    container
      .querySelectorAll<HTMLElement>("[data-clip-item='true']")
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [autoplayEnabled, items.length]);

  async function loadMore() {
    if (!nextCursor || loadMorePending) return;
    setLoadMorePending(true);
    setLoadMoreError(false);
    try {
      const response = await fetch(
        `/api/clips?${new URLSearchParams({ cursor: nextCursor }).toString()}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("CLIPS_CONTINUATION_UNAVAILABLE");
      const page = parseClipsPage(await response.json());
      if (!page.enabled) throw new Error("CLIPS_DISABLED");
      setItems((current) => mergeClipItems(current, page.items));
      setNextCursor(page.nextCursor);
      setAutoplayEnabled(page.autoplayEnabled);
      setAdPolicy(page.adPolicy);
    } catch {
      setLoadMoreError(true);
    } finally {
      setLoadMorePending(false);
    }
  }

  function moveByKeyboard(event: KeyboardEvent<HTMLElement>, index: number) {
    if (event.target !== event.currentTarget) return;
    const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    const target = root.current?.querySelector<HTMLElement>(`[data-clip-index='${index + delta}']`);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    target.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    target.focus({ preventScroll: true });
  }

  return (
    <section className={styles.workspace}>
      <div ref={root} className={styles.feed} aria-label={t("clips.feed")}>
        {items.map((clip, index) => {
          const source = clip.mediaAssets.find((asset) => asset.kind === "SOURCE_VIDEO");
          const sourceUrl = mediaAssetUrl(source?.r2ObjectKey);
          return (
            <article
              className={styles.clip}
              key={clip.id}
              data-clip-item="true"
              data-clip-index={index}
              data-video-id={clip.id}
              data-channel-id={clip.channel.id}
              data-tv-focusable="true"
              data-tv-focus-id={`clip-${clip.id}-surface`}
              tabIndex={0}
              onKeyDown={(event) => moveByKeyboard(event, index)}
            >
              {sourceUrl ? (
                <video
                  className={styles.video}
                  src={sourceUrl}
                  playsInline
                  muted
                  controls
                  preload="metadata"
                  data-tv-focusable="true"
                  data-tv-focus-id={`clip-${clip.id}-player`}
                  onPause={(event) => persistWatchProgress(clip, event.currentTarget)}
                  onEnded={(event) => {
                    persistWatchProgress(clip, event.currentTarget);
                    trackAnalyticsEvent("CLIP_COMPLETE", {
                      videoId: clip.id,
                      channelId: clip.channel.id,
                    });
                  }}
                />
              ) : (
                <div className={styles.mediaFallback}>
                  <StatusNotice tone="danger">{t("clips.mediaUnavailable")}</StatusNotice>
                </div>
              )}
              <div className={styles.overlay}>
                <div className={styles.copy}>
                  <Link className={styles.channelLink} href={href(`/c/${clip.channel.handle}`)}>
                    @{clip.channel.handle}
                  </Link>
                  <h2 dir="auto">{clip.title}</h2>
                  {clip.description ? <p dir="auto">{clip.description}</p> : null}
                </div>
                {activeId === clip.id ? <ClipActions key={clip.id} clip={clip} /> : null}
              </div>
              {adPolicy.enabled &&
              adPolicy.minimumOrganicClips > 0 &&
              (index + 1) % adPolicy.minimumOrganicClips === 0 ? (
                <span
                  aria-hidden="true"
                  className={styles.adBoundary}
                  data-clip-ad-boundary="true"
                />
              ) : null}
            </article>
          );
        })}
      </div>

      <div className={styles.more}>
        {nextCursor ? (
          <ActionButton
            type="button"
            tone="secondary"
            pending={loadMorePending}
            disabled={loadMorePending}
            data-tv-focusable="true"
            data-tv-focus-id="clips-load-more"
            onClick={() => void loadMore()}
          >
            {loadMorePending ? t("clips.loadingMore") : t("clips.loadMore")}
          </ActionButton>
        ) : null}
        {loadMoreError ? (
          <StatusNotice tone="warning" announce="polite">
            {t("clips.moreError")}
          </StatusNotice>
        ) : null}
      </div>
    </section>
  );
}
