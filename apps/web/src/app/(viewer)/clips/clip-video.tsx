"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { useWatchProgress } from "@/components/player/use-watch-progress";
import { useViewerProduct } from "@/components/viewer/viewer-product-context";
import { releaseHtmlMediaElement } from "@/lib/adaptive-playback";
import { trackAnalyticsEvent } from "@/lib/analytics";
import { noopPlayerAnalytics, type AyinCaptionTrack } from "@/lib/ayin-player";
import type { ClipItem, ClipPlaybackPosition, RegisterClipPositionAuthority } from "@/lib/clips";

import { clipPlayerCopy } from "./clip-player-copy";
import styles from "./clip-player.module.css";

const ignorePosition = () => undefined;
const noCaptions: AyinCaptionTrack[] = [];

interface PlaybackPolicy {
  current: boolean;
  autoplay: boolean;
  panelOpen: boolean;
}

// One element's playback intent, beneath the feed's active-item coordinator.
// Invalidation fences promises as well as media events. It never owns identity,
// progress, feed selection, or another element's playback.
export function createClipPlaybackIntent(
  video: Pick<HTMLVideoElement, "paused" | "ended" | "play" | "pause">,
  policy: () => PlaybackPolicy,
  changed: () => void,
  blocked: () => void,
) {
  let intent: "automatic" | "manual" | "paused" = "automatic";
  let generation = 0;
  let disposed = false;
  let pending: { generation: number; manual: boolean } | null = null;
  let ignoredPauses = 0;
  let panelWasOpen = false;
  let resumeAfterPanel = false;
  let deferInitialAutoplay = false;
  let hasAttemptedPlayback = false;

  const allowed = (manual: boolean) => {
    const current = policy();
    return !disposed && current.current && !current.panelOpen && (manual || current.autoplay);
  };
  const pauseMedia = () => {
    if (!video.paused) {
      ignoredPauses++;
      video.pause();
    }
  };
  const invalidate = () => {
    generation++;
    pending = null;
    pauseMedia();
    changed();
  };
  const play = (manual = false) => {
    if (intent === "paused" && !manual) return;
    if (!allowed(manual) || pending || !video.paused) return;
    intent = manual ? "manual" : "automatic";
    hasAttemptedPlayback = true;
    const request = { generation: ++generation, manual };
    pending = request;
    changed();
    const settled = () => {
      if (pending !== request || generation !== request.generation || !allowed(request.manual)) {
        // A newer valid intent on this SAME element is allowed to keep playing.
        // A retired element, panel, or disallowed generation is always stopped.
        if (!allowed(intent === "manual") || intent === "paused") pauseMedia();
        return;
      }
      pending = null;
      changed();
    };
    const rejected = () => {
      if (pending !== request || generation !== request.generation || disposed) return;
      pending = null;
      intent = "paused";
      pauseMedia();
      changed();
      if (allowed(true)) blocked();
    };
    try {
      void video.play().then(settled, rejected);
    } catch {
      rejected();
    }
  };
  return {
    play,
    pause() {
      intent = "paused";
      resumeAfterPanel = false;
      deferInitialAutoplay = false;
      invalidate();
    },
    pending: () => pending !== null,
    ownsPlayback: () =>
      hasAttemptedPlayback && intent !== "paused" && !video.paused && allowed(intent === "manual"),
    sync() {
      const current = policy();
      if (current.panelOpen) {
        if (!panelWasOpen) {
          resumeAfterPanel = !video.paused && !video.ended && intent !== "paused";
          deferInitialAutoplay = !hasAttemptedPlayback && intent === "automatic";
          panelWasOpen = true;
          intent = "paused";
          invalidate();
        }
        return;
      }
      if (panelWasOpen) {
        panelWasOpen = false;
        const resume = resumeAfterPanel || deferInitialAutoplay;
        intent = deferInitialAutoplay ? "automatic" : "paused";
        resumeAfterPanel = false;
        deferInitialAutoplay = false;
        if (resume && allowed(false)) {
          intent = "automatic";
          play();
        }
        return;
      }
      if (!allowed(intent === "manual")) {
        invalidate();
        return;
      }
      if (intent === "automatic") play();
    },
    observePlay(nativeControls: boolean) {
      if (!allowed(pending?.manual ?? (nativeControls || intent === "manual"))) {
        invalidate();
        return false;
      }
      if (!pending && nativeControls) {
        intent = "manual";
        hasAttemptedPlayback = true;
      }
      if (intent === "paused") {
        pauseMedia();
        return false;
      }
      changed();
      return !video.paused;
    },
    observePause() {
      if (ignoredPauses > 0) ignoredPauses--;
      else if (video.paused) {
        intent = "paused";
        pending = null;
        generation++;
        resumeAfterPanel = false;
      }
      changed();
    },
    revokeLease() {
      // Audience invalidation invokes listeners synchronously. Leave the media
      // unchanged until ClipsClient captures its position and playing state;
      // the existing owner boundary then releases it in the same call stack.
      disposed = true;
      intent = "paused";
      generation++;
      pending = null;
    },
    dispose() {
      disposed = true;
      intent = "paused";
      invalidate();
    },
  };
}

export function sameOriginCaptionTracks(tracks: AyinCaptionTrack[], origin: string) {
  return tracks.filter((track) => {
    try {
      const url = new URL(track.src, origin);
      return ["https:", "http:"].includes(url.protocol) && url.origin === origin;
    } catch {
      return false;
    }
  });
}

function releaseCaptionSources(video: HTMLVideoElement) {
  video.querySelectorAll("track").forEach((track) => {
    track.track.mode = "disabled";
    track.removeAttribute("src");
  });
}

function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const tail = `${String(minutes).padStart(hours ? 2 : 1, "0")}:${String(value % 60).padStart(2, "0")}`;
  return hours ? `${hours}:${tail}` : tail;
}

function PlayerIcon({
  name,
}: {
  name: "play" | "pause" | "mute" | "unmute" | "native" | "fullscreen";
}) {
  const paths = {
    play: "M8 5v14l11-7z",
    pause: "M7 5h3v14H7z M14 5h3v14h-3z",
    mute: "M11 5 6 9H3v6h3l5 4z M16 9l5 6 M21 9l-5 6",
    unmute: "M11 5 6 9H3v6h3l5 4z M15 8a6 6 0 0 1 0 8 M18 5a10 10 0 0 1 0 14",
    native: "M4 6h16v12H4z M7 14h4 M14 10h3 M9 12v4 M15 8v4",
    fullscreen: "M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5",
  };
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function ClipVideo({
  clip,
  isKids,
  sourceUrl,
  posterUrl,
  initialPlayback,
  registerPositionAuthority,
  registerDeactivate,
  autoPlayAllowed,
  pausedForPanel,
  viewportVisible,
  dataSaving,
  captions,
  onPlaybackChange,
  onMediaReady,
}: {
  clip: ClipItem;
  isKids: boolean;
  sourceUrl: string;
  posterUrl?: string | undefined;
  initialPlayback?: ClipPlaybackPosition | undefined;
  registerPositionAuthority?: RegisterClipPositionAuthority | undefined;
  registerDeactivate?: ((deactivate: () => void) => () => void) | undefined;
  autoPlayAllowed: boolean;
  pausedForPanel: boolean;
  viewportVisible: boolean;
  dataSaving: boolean;
  captions?: AyinCaptionTrack[] | undefined;
  onPlaybackChange?: ((video: HTMLVideoElement) => void) | undefined;
  onMediaReady?: ((video: HTMLVideoElement) => void) | undefined;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const retired = useRef(false);
  const endedRestore = useRef(initialPlayback?.ended === true);
  const playerRef = useRef<HTMLDivElement>(null);
  const adActiveRef = useRef(false);
  const playback = useRef<ReturnType<typeof createClipPlaybackIntent> | null>(null);
  const { locale, href } = useI18n();
  const supportedCaptions = useMemo(
    () =>
      sameOriginCaptionTracks(
        captions ?? noCaptions,
        typeof window === "undefined" ? "" : window.location.origin,
      ),
    [captions],
  );
  const copy = clipPlayerCopy(locale);
  const captionSelectId = useId();
  const [nativeControls, setNativeControls] = useState(false);
  const [media, setMedia] = useState({
    playing: false,
    ended: initialPlayback?.ended === true,
    pending: false,
    muted: initialPlayback?.muted ?? true,
    time: 0,
    duration: (clip.durationMs ?? 0) / 1000,
    ready: false,
  });
  const [feedback, setFeedback] = useState<"buffering" | "error" | "blocked" | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [captionId, setCaptionId] = useState<string | null>(initialPlayback?.captionId ?? null);
  const [failedCaption, setFailedCaption] = useState<string | null>(null);
  const retryPosition = useRef<number | null>(null);
  const mountedPlayback = useRef(initialPlayback);
  const {
    identity,
    identityRevision,
    isIdentityCurrent,
    isAudienceCurrent,
    onBeforeIdentitySuspend,
    onAudienceInvalidated,
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
        !retired.current &&
        owner &&
        activity.current.owner === owner &&
        activity.current.participated &&
        isIdentityCurrent(),
      ),
    [isIdentityCurrent, owner],
  );
  const participate = () => {
    if (!retired.current && owner && isIdentityCurrent())
      activity.current = { owner, participated: true };
  };
  const {
    applyResume,
    markUserPlay,
    markUserSeek,
    markNativeSeek,
    finishNativeSeek,
    persist,
    isPositionAuthoritative,
  } = useWatchProgress({
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
    initialPositionMs: initialPlayback?.positionMs ?? 0,
    initialPositionExplicit: initialPlayback?.positionMs !== undefined,
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

  useLayoutEffect(
    () => registerPositionAuthority?.(clip.id, isPositionAuthoritative),
    [clip.id, isPositionAuthoritative, registerPositionAuthority],
  );

  const policyRef = useRef({
    autoPlayAllowed,
    pausedForPanel,
    viewportVisible,
    dataSaving,
    isAudienceCurrent,
    onPlaybackChange,
  });
  useLayoutEffect(() => {
    policyRef.current = {
      autoPlayAllowed,
      pausedForPanel,
      viewportVisible,
      dataSaving,
      isAudienceCurrent,
      onPlaybackChange,
    };
  });
  const updateMedia = useCallback(() => {
    const video = videoRef.current;
    if (!video || retired.current || !policyRef.current.isAudienceCurrent()) return;
    video.dataset.clipEnded = video.ended || endedRestore.current ? "true" : "false";
    setMedia({
      playing: !video.paused,
      ended: video.ended || endedRestore.current,
      pending: playback.current?.pending() ?? false,
      muted: video.muted,
      time: video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : (clip.durationMs ?? 0) / 1000,
      ready: video.readyState >= 1,
    });
    policyRef.current.onPlaybackChange?.(video);
  }, [clip.durationMs]);

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const controller = createClipPlaybackIntent(
      video,
      () => ({
        current:
          !retired.current &&
          policyRef.current.viewportVisible &&
          video.isConnected &&
          videoRef.current === video &&
          policyRef.current.isAudienceCurrent() &&
          document.visibilityState === "visible" &&
          document.hasFocus(),
        autoplay:
          policyRef.current.autoPlayAllowed && !policyRef.current.dataSaving && !motion.matches,
        panelOpen: policyRef.current.pausedForPanel,
      }),
      updateMedia,
      () => setFeedback("blocked"),
    );
    playback.current = controller;
    // The feed's initial autoplay gate owns restored deliberate pause. Returning
    // to a Clip through a new feed activation is not a permanent pause lock.
    video.muted = mountedPlayback.current?.muted ?? true;
    video.volume = mountedPlayback.current?.volume ?? 1;
    video.playbackRate = mountedPlayback.current?.playbackRate ?? 1;
    const revoke = () => {
      retired.current = true;
      controller.revokeLease();
      releaseCaptionSources(video);
    };
    const stop = onAudienceInvalidated(revoke);
    const sync = () => controller.sync();
    motion.addEventListener("change", sync);
    controller.sync();
    return () => {
      stop();
      motion.removeEventListener("change", sync);
      controller.dispose();
      if (playback.current === controller) playback.current = null;
    };
  }, [onAudienceInvalidated, updateMedia]);

  useLayoutEffect(() => {
    playback.current?.sync();
  }, [autoPlayAllowed, pausedForPanel, viewportVisible, dataSaving]);

  useLayoutEffect(
    () =>
      registerDeactivate?.(() => {
        if (retired.current) return;
        // Selection eviction checkpoints the still-authorized position before load()
        // clears it. Keepalive takes an immutable snapshot and never queues a retry
        // behind an unresolved read/write. Ordinary unmount does not create a write.
        void persist(true, true);
        retired.current = true;
        playback.current?.dispose();
        if (videoRef.current) {
          releaseCaptionSources(videoRef.current);
          releaseHtmlMediaElement(videoRef.current);
        }
      }),
    [persist, registerDeactivate],
  );

  const selectedCaption = supportedCaptions.some((track) => track.id === captionId)
    ? captionId
    : null;
  useEffect(() => {
    const video = videoRef.current;
    if (!video || retired.current || !isAudienceCurrent()) return;
    if (captions === undefined) {
      video.dataset.clipCaptionId = captionId ?? "";
      return;
    }
    for (let index = 0; index < video.textTracks.length; index++) {
      const track = video.textTracks[index];
      if (track)
        track.mode = supportedCaptions[index]?.id === selectedCaption ? "showing" : "disabled";
    }
    video.dataset.clipCaptionId = selectedCaption ?? "";
    onPlaybackChange?.(video);
  }, [
    captions,
    captionId,
    supportedCaptions,
    isAudienceCurrent,
    onPlaybackChange,
    selectedCaption,
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const changed = () => {
      if (captions === undefined || retired.current || !isAudienceCurrent()) return;
      const index = Array.from(video.textTracks).findIndex((track) => track.mode === "showing");
      const id = supportedCaptions[index]?.id ?? null;
      video.dataset.clipCaptionId = id ?? "";
      setCaptionId(id);
      onPlaybackChange?.(video);
    };
    video.textTracks.addEventListener("change", changed);
    return () => video.textTracks.removeEventListener("change", changed);
  }, [captions, supportedCaptions, isAudienceCurrent, onPlaybackChange]);

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === playerRef.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    return () => {
      // The progress layout cleanup already revoked this element's run before
      // releasing its decoder can produce a final native pause event.
      if (video) {
        releaseCaptionSources(video);
        releaseHtmlMediaElement(video);
      }
    };
  }, []);

  const ready = () => {
    const video = videoRef.current;
    if (!video || retired.current || !isAudienceCurrent()) return;
    applyResume();
    if (retryPosition.current !== null && video.readyState >= 1) {
      video.currentTime = retryPosition.current;
      retryPosition.current = null;
    }
    updateMedia();
    onMediaReady?.(video);
    playback.current?.sync();
  };

  function play() {
    if (retired.current || !isAudienceCurrent() || pausedForPanel) return;
    const video = videoRef.current;
    if (!video) return;
    markUserPlay();
    participate();
    setFeedback(null);
    if (video.ended || endedRestore.current) {
      endedRestore.current = false;
      video.currentTime = 0;
    }
    playback.current?.play(true);
  }

  function seek(seconds: number) {
    const video = videoRef.current;
    if (!video || !isAudienceCurrent() || video.readyState < 1 || !Number.isFinite(seconds)) return;
    // Authored input elects this timeline even if it matches an in-flight
    // internal resume target; native-control seeking retains its own provenance.
    endedRestore.current = false;
    markUserSeek();
    participate();
    video.currentTime = Math.max(0, Math.min(seconds, media.duration));
    updateMedia();
  }

  function retry() {
    const video = videoRef.current;
    if (!video || retired.current || !isAudienceCurrent() || pausedForPanel) return;
    retryPosition.current = Number.isFinite(video.currentTime) ? video.currentTime : null;
    playback.current?.pause();
    video.load();
    play();
  }

  async function toggleFullscreen() {
    const video = videoRef.current as
      (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!video || retired.current || !isAudienceCurrent()) return;
    try {
      if (document.fullscreenElement === playerRef.current) await document.exitFullscreen();
      else if (playerRef.current?.requestFullscreen) await playerRef.current.requestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
      else setNativeControls(true);
    } catch {
      // Keep the browser's usable platform-specific fullscreen route visible.
      setNativeControls(true);
    }
  }

  const feedbackText =
    feedback === "error"
      ? copy.unavailable
      : feedback === "blocked"
        ? copy.blocked
        : feedback === "buffering"
          ? copy.buffering
          : dataSaving && !media.ready
            ? copy.dataSaving
            : media.pending && !media.ready
              ? copy.loading
              : null;
  return (
    <div
      ref={playerRef}
      className={styles.player}
      data-clip-player
      data-clip-native-controls={nativeControls}
    >
      <video
        ref={videoRef}
        className={styles.video}
        src={sourceUrl}
        poster={posterUrl}
        playsInline
        muted={initialPlayback?.muted ?? true}
        controls={nativeControls}
        preload={dataSaving ? "none" : "metadata"}
        aria-label={clip.title}
        data-tv-focusable={nativeControls ? "true" : undefined}
        data-tv-focus-id={`clip-${clip.id}-player`}
        data-clip-ended={initialPlayback?.ended ? "true" : "false"}
        data-clip-caption-id={captionId ?? ""}
        tabIndex={nativeControls ? 0 : -1}
        onLoadedMetadata={ready}
        onCanPlay={() => {
          if (isAudienceCurrent())
            setFeedback((current) => (current === "buffering" ? null : current));
          ready();
        }}
        onDurationChange={updateMedia}
        onPlay={(event) => {
          if (!isAudienceCurrent()) {
            releaseHtmlMediaElement(event.currentTarget);
            return;
          }
          if (playback.current?.observePlay(nativeControls)) {
            if (nativeControls && endedRestore.current) {
              endedRestore.current = false;
              markUserPlay();
              event.currentTarget.currentTime = 0;
              updateMedia();
            }
            participate();
            setFeedback(null);
            trackAnalyticsEvent("CLIP_PLAY", { videoId: clip.id, channelId: clip.channel.id });
          }
        }}
        onPlaying={() => {
          if (isAudienceCurrent()) setFeedback(null);
          updateMedia();
        }}
        onTimeUpdate={() => {
          if (playback.current?.ownsPlayback()) {
            participate();
            void persist(false);
          }
          updateMedia();
        }}
        onSeeking={() => {
          if (markNativeSeek()) {
            endedRestore.current = false;
            participate();
          }
          updateMedia();
        }}
        onSeeked={() => {
          finishNativeSeek();
          updateMedia();
        }}
        onPause={() => {
          playback.current?.observePause();
          if (!retired.current) void persist(true);
        }}
        onVolumeChange={updateMedia}
        onRateChange={updateMedia}
        onWaiting={() => {
          if (isAudienceCurrent() && !videoRef.current?.paused) setFeedback("buffering");
        }}
        onStalled={() => {
          if (isAudienceCurrent() && !videoRef.current?.paused) setFeedback("buffering");
        }}
        onError={() => {
          if (isAudienceCurrent()) {
            playback.current?.pause();
            setFeedback("error");
          }
        }}
        onEnded={() => {
          if (retired.current || !isAudienceCurrent()) return;
          playback.current?.pause();
          void persist(true);
          trackAnalyticsEvent("CLIP_COMPLETE", { videoId: clip.id, channelId: clip.channel.id });
        }}
      >
        {supportedCaptions.map((track) => (
          <track
            key={track.id}
            kind={track.kind === "CAPTIONS" ? "captions" : "subtitles"}
            label={track.label}
            src={track.src}
            srcLang={track.language}
            onError={() => {
              if (!retired.current && isAudienceCurrent()) setFailedCaption(track.id);
            }}
          />
        ))}
      </video>
      <div className={styles.controls} data-clip-controls role="group" aria-label={copy.controls}>
        {nativeControls ? (
          <div className={`${styles.row} ${styles.nativeRow}`}>
            <button
              type="button"
              className={styles.button}
              onClick={() => setNativeControls(false)}
            >
              {copy.authored}
            </button>
            <button
              type="button"
              className={styles.button}
              aria-label={fullscreen ? copy.exitFullscreen : copy.fullscreen}
              title={fullscreen ? copy.exitFullscreen : copy.fullscreen}
              onClick={() => void toggleFullscreen()}
            >
              <PlayerIcon name="fullscreen" />
            </button>
          </div>
        ) : (
          <>
            <input
              className={styles.seek}
              type="range"
              min="0"
              max={media.duration || 1}
              step="0.1"
              value={Math.min(media.time, media.duration || 1)}
              disabled={!media.ready || !media.duration || pausedForPanel}
              aria-label={copy.seek}
              aria-valuetext={`${formatTime(media.time)} ${copy.of} ${formatTime(media.duration)}`}
              onChange={(event) => seek(Number(event.currentTarget.value))}
              data-tv-focusable="true"
              data-tv-focus-id={`clip-${clip.id}-seek`}
            />
            <div className={styles.row}>
              <button
                type="button"
                className={styles.button}
                aria-label={
                  media.playing || media.pending
                    ? copy.pause
                    : media.ended
                      ? copy.replay
                      : copy.play
                }
                title={
                  media.playing || media.pending
                    ? copy.pause
                    : media.ended
                      ? copy.replay
                      : copy.play
                }
                disabled={pausedForPanel}
                onClick={() =>
                  media.playing || media.pending ? playback.current?.pause() : play()
                }
                data-tv-focusable="true"
                data-tv-focus-id={`clip-${clip.id}-play`}
              >
                <PlayerIcon name={media.playing || media.pending ? "pause" : "play"} />
              </button>
              <button
                type="button"
                className={styles.button}
                aria-label={media.muted ? copy.unmute : copy.mute}
                title={media.muted ? copy.unmute : copy.mute}
                onClick={() => {
                  if (videoRef.current && isAudienceCurrent())
                    videoRef.current.muted = !videoRef.current.muted;
                }}
                data-tv-focusable="true"
                data-tv-focus-id={`clip-${clip.id}-mute`}
              >
                <PlayerIcon name={media.muted ? "mute" : "unmute"} />
              </button>
              <span className={styles.time} dir="ltr" aria-hidden="true">
                {formatTime(media.time)} / {formatTime(media.duration)}
              </span>
              <button
                type="button"
                className={styles.button}
                aria-label={copy.native}
                title={copy.native}
                onClick={() => setNativeControls(true)}
                data-tv-focusable="true"
                data-tv-focus-id={`clip-${clip.id}-native`}
              >
                <PlayerIcon name="native" />
              </button>
              <button
                type="button"
                className={styles.button}
                aria-label={fullscreen ? copy.exitFullscreen : copy.fullscreen}
                title={fullscreen ? copy.exitFullscreen : copy.fullscreen}
                onClick={() => void toggleFullscreen()}
                data-tv-focusable="true"
                data-tv-focus-id={`clip-${clip.id}-fullscreen`}
              >
                <PlayerIcon name="fullscreen" />
              </button>
            </div>
          </>
        )}
        {supportedCaptions.length > 0 && !nativeControls ? (
          <div className={styles.captionRow}>
            <label htmlFor={captionSelectId}>{copy.captions}</label>
            <select
              id={captionSelectId}
              className={styles.captionSelect}
              value={selectedCaption ?? ""}
              onChange={(event) => {
                setFailedCaption(null);
                setCaptionId(event.currentTarget.value || null);
              }}
            >
              <option value="">{copy.captionsOff}</option>
              {supportedCaptions.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {(captions?.length ?? 0) > supportedCaptions.length ? (
          <p className={styles.feedback}>
            {copy.captionsTransportUnavailable}{" "}
            <a
              className={styles.button}
              href={href(`/watch/${clip.slug}${isKids ? "?kids=1" : ""}`)}
            >
              {copy.openFullVideo}
            </a>
          </p>
        ) : null}
        {feedbackText ? (
          <div className={styles.feedback} role="status">
            {feedbackText}
            {feedback === "error" ? (
              <button type="button" className={styles.button} onClick={retry}>
                {copy.retry}
              </button>
            ) : null}
          </div>
        ) : null}
        {failedCaption && failedCaption === selectedCaption ? (
          <p className={styles.feedback} role="status">
            {copy.captionsUnavailable}
          </p>
        ) : null}
      </div>
    </div>
  );
}
