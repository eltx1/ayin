"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { useWatchProgress } from "@/components/player/use-watch-progress";
import { useViewerProduct } from "@/components/viewer/viewer-product-context";
import { releaseHtmlMediaElement } from "@/lib/adaptive-playback";
import { trackAnalyticsEvent } from "@/lib/analytics";
import { noopPlayerAnalytics } from "@/lib/ayin-player";
import type { ClipItem } from "@/lib/clips";

import styles from "./clips.module.css";

const ignorePosition = () => undefined;

// Clips retains its native controls and feed navigation. Its progress has the
// same owner, revision and lifecycle contract as Watch, including late replies.
export function ClipVideo({ clip, sourceUrl }: { clip: ClipItem; sourceUrl: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const adActiveRef = useRef(false);
  const {
    identity,
    identityRevision,
    isIdentityCurrent,
    onBeforeIdentitySuspend,
    retryNavigation,
  } = useViewerProduct();
  const owner = identity ? `${identity.account.id}:${identity.profile.id}` : null;
  const activity = useRef<{ owner: string | null; participated: boolean }>({
    owner: null,
    participated: false,
  });
  useLayoutEffect(() => {
    if (owner && activity.current.owner !== owner) {
      activity.current = { owner, participated: false };
    }
  }, [owner]);
  const canPersist = useCallback(
    () =>
      Boolean(
        owner &&
        activity.current.owner === owner &&
        activity.current.participated &&
        isIdentityCurrent(),
      ),
    [isIdentityCurrent, owner],
  );
  const participate = () => {
    if (owner && isIdentityCurrent()) activity.current = { owner, participated: true };
  };
  const { applyResume, markNativeSeek, finishNativeSeek, persist } = useWatchProgress({
    videoId: clip.id,
    videoRef,
    identity: identity
      ? {
          accountId: identity.account.id,
          profileId: identity.profile.id,
          revision: identityRevision,
          isCurrent: isIdentityCurrent,
          onBeforeSuspend: onBeforeIdentitySuspend,
        }
      : null,
    enabled: true,
    initialPositionMs: 0,
    durationMs: clip.durationMs,
    intervalMs: 15_000,
    adActiveRef,
    analytics: noopPlayerAnalytics,
    onPosition: ignorePosition,
    onIdentityInvalid: retryNavigation,
    // Metadata/resume on an untouched offscreen clip is not a new viewing.
    // Participation belongs to the current owner, never to a prior account.
    canPersist,
  });

  useEffect(() => {
    const video = videoRef.current;
    return () => {
      // The progress layout cleanup already revoked this element's run before
      // releasing its decoder can produce a final native pause event.
      if (video) releaseHtmlMediaElement(video);
    };
  }, []);

  return (
    <video
      ref={videoRef}
      className={styles.video}
      src={sourceUrl}
      playsInline
      muted
      controls
      preload="metadata"
      data-tv-focusable="true"
      data-tv-focus-id={`clip-${clip.id}-player`}
      onLoadedMetadata={applyResume}
      onCanPlay={applyResume}
      onPlay={(event) => {
        if (!event.currentTarget.paused) participate();
      }}
      onTimeUpdate={(event) => {
        if (!event.currentTarget.paused) participate();
      }}
      onSeeking={() => {
        if (markNativeSeek()) participate();
      }}
      onSeeked={finishNativeSeek}
      onPause={() => void persist(true)}
      onEnded={() => {
        void persist(true);
        trackAnalyticsEvent("CLIP_COMPLETE", {
          videoId: clip.id,
          channelId: clip.channel.id,
        });
      }}
    />
  );
}
