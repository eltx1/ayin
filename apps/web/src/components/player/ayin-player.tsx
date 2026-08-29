"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { TvFocusScope } from "@/components/tv/tv-focus-scope";
import {
  type AyinCaptionTrack,
  type AyinPlayerAdModeState,
  type AyinPlayerAnalytics,
  type AyinPlayerChapter,
  type AyinPlayerUpNext,
  noopPlayerAnalytics,
} from "@/lib/ayin-player";
import {
  persistWatchProgress,
  readWatchProgress,
  resumablePositionMs,
  shouldPersistProgress,
  type PlayerProgressPolicy,
} from "@/lib/player-progress";

import styles from "./ayin-player.module.css";

export interface AyinPlayerProps {
  videoId: string;
  sourceUrl: string;
  title: string;
  durationMs?: number | null | undefined;
  posterUrl?: string | null | undefined;
  captions?: AyinCaptionTrack[] | undefined;
  chapters?: AyinPlayerChapter[] | undefined;
  initialPositionMs?: number | undefined;
  progressEnabled?: boolean | undefined;
  profileId?: string | undefined;
  progressPolicy?: PlayerProgressPolicy | undefined;
  upNext?: AyinPlayerUpNext | null | undefined;
  onNext?: (() => void) | undefined;
  analytics?: AyinPlayerAnalytics | undefined;
  adMode?: AyinPlayerAdModeState | undefined;
  onAdContainerReady?: ((element: HTMLDivElement | null) => void) | undefined;
  autoPlay?: boolean | undefined;
  muted?: boolean | undefined;
  className?: string | undefined;
  footer?: ReactNode;
}

export function AyinPlayer({
  videoId,
  sourceUrl,
  title,
  durationMs: declaredDurationMs = null,
  posterUrl = null,
  captions = [],
  chapters = [],
  initialPositionMs = 0,
  progressEnabled = true,
  profileId,
  progressPolicy,
  upNext = null,
  onNext,
  analytics = noopPlayerAnalytics,
  adMode = { active: false },
  onAdContainerReady,
  autoPlay = false,
  muted: initiallyMuted = false,
  className,
  footer,
}: AyinPlayerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const adContainerRef = useRef<HTMLDivElement | null>(null);
  const lastPersistedAtRef = useRef(0);
  const lastPersistedPositionRef = useRef(0);
  const persistBusyRef = useRef(false);
  const resumeAppliedRef = useRef(false);
  const lastAdActiveRef = useRef(adMode.active);

  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(declaredDurationMs ?? 0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(initiallyMuted);
  const [rate, setRate] = useState(1);
  const [captionsEnabled, setCaptionsEnabled] = useState(captions.some((track) => track.default));
  const [savedResume, setSavedResume] = useState<{ videoId: string; positionMs: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const effectivePolicy = progressPolicy ?? {
    progressSaveIntervalMs: 15_000,
    completionThresholdPercent: 90,
  };
  const activeChapter = useMemo(() => {
    const ordered = [...chapters].sort((a, b) => a.startMs - b.startMs);
    return [...ordered].reverse().find((chapter) => chapter.startMs <= positionMs) ?? null;
  }, [chapters, positionMs]);

  useEffect(() => {
    onAdContainerReady?.(adContainerRef.current);
    return () => onAdContainerReady?.(null);
  }, [onAdContainerReady]);

  useEffect(() => {
    if (lastAdActiveRef.current !== adMode.active) {
      analytics.emit({ type: "ad_mode", videoId, active: adMode.active });
      lastAdActiveRef.current = adMode.active;
    }
  }, [adMode.active, analytics, videoId]);

  useEffect(() => {
    resumeAppliedRef.current = false;
    lastPersistedAtRef.current = 0;
    lastPersistedPositionRef.current = 0;
    if (!progressEnabled || initialPositionMs > 0) return;

    let cancelled = false;
    void readWatchProgress(videoId, profileId).then((snapshot) => {
      if (cancelled || !snapshot) return;
      setSavedResume({
        videoId,
        positionMs: resumablePositionMs(snapshot, declaredDurationMs),
      });
      lastPersistedPositionRef.current = snapshot.positionMs;
      lastPersistedAtRef.current = Date.now();
    });
    return () => {
      cancelled = true;
    };
  }, [declaredDurationMs, initialPositionMs, profileId, progressEnabled, videoId]);

  const resumePositionMs =
    savedResume?.videoId === videoId ? savedResume.positionMs : initialPositionMs;

  const applyResume = useCallback(() => {
    const video = videoRef.current;
    if (!video || resumeAppliedRef.current || resumePositionMs <= 0) return;
    const mediaDurationMs = Number.isFinite(video.duration) ? video.duration * 1000 : durationMs;
    const safePositionMs = Math.min(
      resumePositionMs,
      Math.max(0, mediaDurationMs > 0 ? mediaDurationMs - 250 : resumePositionMs),
    );
    if (safePositionMs <= 0) return;
    try {
      video.currentTime = safePositionMs / 1000;
      setPositionMs(safePositionMs);
      resumeAppliedRef.current = true;
    } catch {
      // Progressive MP4 seeking depends on browser/R2 range support; playback can still start at zero.
    }
  }, [durationMs, resumePositionMs]);

  const persist = useCallback(
    async (force = false, keepalive = false) => {
      const video = videoRef.current;
      if (!progressEnabled || !video || adMode.active || persistBusyRef.current) return;
      const currentPositionMs = Math.max(0, Math.floor(video.currentTime * 1000));
      const nowMs = Date.now();
      if (
        !shouldPersistProgress({
          nowMs,
          lastPersistedAtMs: lastPersistedAtRef.current,
          positionMs: currentPositionMs,
          lastPersistedPositionMs: lastPersistedPositionRef.current,
          intervalMs: effectivePolicy.progressSaveIntervalMs,
          force,
        })
      ) {
        return;
      }

      lastPersistedAtRef.current = nowMs;
      lastPersistedPositionRef.current = currentPositionMs;
      persistBusyRef.current = true;
      try {
        const mediaDurationMs = Number.isFinite(video.duration)
          ? Math.floor(video.duration * 1000)
          : durationMs || undefined;
        const snapshot = await persistWatchProgress(
          videoId,
          {
            ...(profileId ? { profileId } : {}),
            positionMs: currentPositionMs,
            ...(mediaDurationMs ? { durationMs: mediaDurationMs } : {}),
          },
          keepalive,
        );
        analytics.emit({ type: "progress_checkpoint", videoId, positionMs: currentPositionMs });
        if (snapshot?.completedAt) analytics.emit({ type: "complete", videoId });
      } finally {
        persistBusyRef.current = false;
      }
    },
    [
      adMode.active,
      analytics,
      durationMs,
      effectivePolicy.progressSaveIntervalMs,
      profileId,
      progressEnabled,
      videoId,
    ],
  );

  useEffect(() => {
    if (!progressEnabled) return;
    const flush = () => void persist(true, true);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [persist, progressEnabled]);

  const togglePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video || (adMode.active && adMode.controlsLocked !== false)) return;
    if (video.paused) await video.play();
    else video.pause();
  }, [adMode.active, adMode.controlsLocked]);

  const seekBy = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (!video || (adMode.active && adMode.controlsLocked !== false)) return;
      const max = Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
      video.currentTime = Math.max(0, Math.min(max, video.currentTime + seconds));
      setPositionMs(Math.floor(video.currentTime * 1000));
      analytics.emit({ type: "seek", videoId, positionMs: Math.floor(video.currentTime * 1000) });
    },
    [adMode.active, adMode.controlsLocked, analytics, videoId],
  );

  const seekTo = useCallback(
    (nextMs: number) => {
      const video = videoRef.current;
      if (!video || (adMode.active && adMode.controlsLocked !== false)) return;
      video.currentTime = Math.max(0, nextMs) / 1000;
      setPositionMs(Math.max(0, nextMs));
      analytics.emit({ type: "seek", videoId, positionMs: Math.max(0, nextMs) });
    },
    [adMode.active, adMode.controlsLocked, analytics, videoId],
  );

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await root.requestFullscreen();
  }, []);

  const togglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled || !("requestPictureInPicture" in video))
      return;
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  }, []);

  const toggleCaptions = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.textTracks.length === 0) return;
    const next = !captionsEnabled;
    for (let index = 0; index < video.textTracks.length; index += 1) {
      const track = video.textTracks[index];
      if (track) track.mode = next && index === 0 ? "showing" : "disabled";
    }
    setCaptionsEnabled(next);
  }, [captionsEnabled]);

  function onStageKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === " " || key === "k" || key === "enter") {
      event.preventDefault();
      event.stopPropagation();
      void togglePlay();
    } else if (key === "arrowleft" || key === "j") {
      event.preventDefault();
      event.stopPropagation();
      seekBy(-10);
    } else if (key === "arrowright" || key === "l") {
      event.preventDefault();
      event.stopPropagation();
      seekBy(10);
    } else if (key === "m") {
      event.preventDefault();
      event.stopPropagation();
      toggleMute();
    } else if (key === "f") {
      event.preventDefault();
      event.stopPropagation();
      void toggleFullscreen();
    }
  }

  const locked = adMode.active && adMode.controlsLocked !== false;
  return (
    <TvFocusScope className={className}>
      <section className={styles.player} ref={rootRef} aria-label={`${title} player`}>
        <div
          className={styles.stage}
          data-player-stage="true"
          data-tv-focusable="true"
          data-tv-focus-id={`player-stage-${videoId}`}
          onKeyDown={onStageKeyDown}
          tabIndex={0}
        >
          <video
            autoPlay={autoPlay}
            className={styles.video}
            key={`${videoId}:${sourceUrl}`}
            muted={muted}
            onCanPlay={applyResume}
            onEnded={() => {
              void persist(true);
              analytics.emit({ type: "complete", videoId });
              if (onNext) {
                analytics.emit({ type: "next", videoId });
                onNext();
              }
            }}
            onError={() => {
              const message = "AYIN could not play this MP4 source.";
              setError(message);
              analytics.emit({ type: "error", videoId, message });
            }}
            onLoadedMetadata={(event) => {
              const nextDurationMs = Number.isFinite(event.currentTarget.duration)
                ? Math.floor(event.currentTarget.duration * 1000)
                : (declaredDurationMs ?? 0);
              setDurationMs(nextDurationMs);
              applyResume();
            }}
            onPause={() => {
              setPlaying(false);
              analytics.emit({ type: "pause", videoId, positionMs });
              void persist(true);
            }}
            onPlay={() => {
              setPlaying(true);
              analytics.emit({ type: "play", videoId });
            }}
            onTimeUpdate={(event) => {
              setPositionMs(Math.floor(event.currentTarget.currentTime * 1000));
              void persist(false);
            }}
            playsInline
            poster={posterUrl ?? undefined}
            preload="metadata"
            ref={videoRef}
            src={sourceUrl}
          >
            {captions.map((track) => (
              <track
                default={track.default}
                key={track.id}
                kind="captions"
                label={track.label}
                src={track.src}
                srcLang={track.language}
              />
            ))}
          </video>

          <div
            className={`${styles.adContainer} ${adMode.active ? styles.adActive : ""}`}
            data-ayin-ad-container="true"
            ref={adContainerRef}
            aria-hidden={!adMode.active}
          >
            {adMode.active ? <span>{adMode.label ?? "Advertisement"}</span> : null}
          </div>

          <div className={styles.titleBar}>
            <strong>{title}</strong>
            {activeChapter ? <span>{activeChapter.title}</span> : null}
          </div>
          {error ? <div className={styles.error}>{error}</div> : null}
        </div>

        <div className={styles.controls} aria-label="Playback controls">
          <input
            aria-label="Seek video"
            className={styles.scrubber}
            data-tv-focusable="true"
            data-tv-focus-id={`player-seek-${videoId}`}
            disabled={locked}
            max={Math.max(durationMs, 1)}
            min={0}
            onChange={(event) => seekTo(Number(event.currentTarget.value))}
            type="range"
            value={Math.min(positionMs, Math.max(durationMs, 1))}
          />

          <div className={styles.controlRow}>
            <button
              data-tv-focusable="true"
              data-tv-focus-id={`player-play-${videoId}`}
              disabled={locked}
              onClick={() => void togglePlay()}
              type="button"
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button
              data-tv-focusable="true"
              data-tv-focus-id={`player-back-${videoId}`}
              disabled={locked}
              onClick={() => seekBy(-10)}
              type="button"
            >
              −10s
            </button>
            <button
              data-tv-focusable="true"
              data-tv-focus-id={`player-forward-${videoId}`}
              disabled={locked}
              onClick={() => seekBy(10)}
              type="button"
            >
              +10s
            </button>
            <span className={styles.time}>
              {formatTime(positionMs)} / {formatTime(durationMs)}
            </span>
            <button
              data-tv-focusable="true"
              data-tv-focus-id={`player-mute-${videoId}`}
              onClick={toggleMute}
              type="button"
            >
              {muted ? "Unmute" : "Mute"}
            </button>
            <input
              aria-label="Volume"
              className={styles.volume}
              data-tv-focusable="true"
              data-tv-focus-id={`player-volume-${videoId}`}
              max={1}
              min={0}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                setVolume(next);
                if (videoRef.current) {
                  videoRef.current.volume = next;
                  if (next > 0) videoRef.current.muted = false;
                  setMuted(videoRef.current.muted);
                }
              }}
              step={0.05}
              type="range"
              value={volume}
            />
            <select
              aria-label="Playback speed"
              data-tv-focusable="true"
              data-tv-focus-id={`player-speed-${videoId}`}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                setRate(next);
                if (videoRef.current) videoRef.current.playbackRate = next;
              }}
              value={rate}
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </select>
            {captions.length > 0 ? (
              <button
                data-tv-focusable="true"
                data-tv-focus-id={`player-cc-${videoId}`}
                onClick={toggleCaptions}
                type="button"
              >
                CC {captionsEnabled ? "On" : "Off"}
              </button>
            ) : null}
            {chapters.length > 0 ? (
              <select
                aria-label="Chapters"
                data-tv-focusable="true"
                data-tv-focus-id={`player-chapters-${videoId}`}
                onChange={(event) => seekTo(Number(event.currentTarget.value))}
                value={activeChapter?.startMs ?? chapters[0]?.startMs ?? 0}
              >
                {[...chapters]
                  .sort((a, b) => a.startMs - b.startMs)
                  .map((chapter) => (
                    <option key={chapter.id} value={chapter.startMs}>
                      {chapter.title}
                    </option>
                  ))}
              </select>
            ) : null}
            <button
              data-tv-focusable="true"
              data-tv-focus-id={`player-pip-${videoId}`}
              onClick={() => void togglePip()}
              type="button"
            >
              PiP
            </button>
            <button
              data-tv-focusable="true"
              data-tv-focus-id={`player-fullscreen-${videoId}`}
              onClick={() => void toggleFullscreen()}
              type="button"
            >
              Fullscreen
            </button>
            {onNext ? (
              <button
                data-tv-focusable="true"
                data-tv-focus-id={`player-next-${videoId}`}
                onClick={() => {
                  analytics.emit({ type: "next", videoId });
                  onNext();
                }}
                type="button"
              >
                Next{upNext ? ` · ${upNext.title}` : ""}
              </button>
            ) : null}
          </div>
        </div>
        {upNext ? (
          <div className={styles.upNext}>
            <span>Up Next</span>
            <strong>{upNext.title}</strong>
            {upNext.detail ? <small>{upNext.detail}</small> : null}
          </div>
        ) : null}
        {footer}
      </section>
    </TvFocusScope>
  );
}

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
