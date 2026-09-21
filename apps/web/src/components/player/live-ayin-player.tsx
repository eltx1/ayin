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
  type AyinAdaptivePlaybackSession,
  type AyinHlsFailureReason,
  startAdaptiveHlsPlayback,
} from "@/lib/adaptive-playback";
import { trackAnalyticsEvent } from "@/lib/analytics";
import type { AyinCaptionTrack, AyinPlayerAdModeState } from "@/lib/ayin-player";
import {
  createLiveAttemptGuard,
  type LiveEdgeSnapshot,
  liveEdgeSnapshot,
  liveReconnectDelayMs,
  moveToLiveEdge,
  usefulLiveLatencyLabel,
} from "@/lib/live-playback";

import styles from "./live-ayin-player.module.css";

export type LivePlayerStreamStatus =
  "DRAFT" | "SCHEDULED" | "READY" | "LIVE" | "ENDED" | "CANCELLED" | "FAILED";

export interface LiveAyinPlayerProps {
  streamId: string;
  channelId: string;
  title: string;
  playbackUrl: string;
  status: LivePlayerStreamStatus;
  captions?: AyinCaptionTrack[] | undefined;
  autoPlay?: boolean | undefined;
  muted?: boolean | undefined;
  dvrWindowSeconds?: number | null | undefined;
  adMode?: AyinPlayerAdModeState | undefined;
  onAdContainerReady?: ((element: HTMLDivElement | null) => void) | undefined;
  className?: string | undefined;
  footer?: ReactNode;
}

type ConnectionState = "IDLE" | "CONNECTING" | "PLAYING" | "RECOVERING" | "OFFLINE" | "FATAL";

const STABLE_PLAYBACK_RESET_MS = 10_000;
const LIVE_STARTUP_WATCHDOG_MS = 12_000;
const LIVE_STALL_WATCHDOG_MS = 12_000;
const LIVE_DURATION_SAMPLE_MS = 30_000;

function stopLiveMedia(video: HTMLVideoElement): void {
  try {
    video.pause();
  } catch {
    // Native media teardown is best-effort, but source removal still prevents continued playback.
  }
  video.removeAttribute("src");
  video.load();
}

function terminalEndReason(status: LivePlayerStreamStatus): string | null {
  if (status === "ENDED") return "provider_ended";
  if (status === "CANCELLED") return "cancelled";
  if (status === "FAILED") return "provider_failed";
  return null;
}

export function LiveAyinPlayer({
  streamId,
  channelId,
  title,
  playbackUrl,
  status,
  captions = [],
  autoPlay = true,
  muted: initiallyMuted = true,
  dvrWindowSeconds = null,
  adMode = { active: false },
  onAdContainerReady,
  className,
  footer,
}: LiveAyinPlayerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const adContainerRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<AyinAdaptivePlaybackSession | null>(null);
  const reconnectAttemptRef = useRef(0);
  const startedRef = useRef(false);
  const endedReportedRef = useRef(false);
  const fatalReportedRef = useRef(false);
  const firstConnectStartedAtRef = useRef<number | null>(null);
  const bufferStartedAtRef = useRef<number | null>(null);
  const durationSegmentStartedAtRef = useRef<number | null>(null);
  const adActiveRef = useRef(adMode.active);
  const [manualRetryGeneration, setManualRetryGeneration] = useState(0);
  const [connectionState, setConnectionState] = useState<ConnectionState>("IDLE");
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(initiallyMuted);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [edge, setEdge] = useState<LiveEdgeSnapshot>({
    seekableStartSeconds: null,
    seekableEndSeconds: null,
    behindLiveSeconds: null,
    atLiveEdge: true,
  });
  const defaultCaptionId = useMemo(
    () => captions.find((track) => track.default)?.id ?? null,
    [captions],
  );
  const [captionSelection, setCaptionSelection] = useState<{
    streamId: string;
    trackId: string | null;
  }>({ streamId, trackId: defaultCaptionId });
  const selectedCaptionId =
    captionSelection.streamId === streamId ? captionSelection.trackId : defaultCaptionId;

  const emit = useCallback(
    (
      eventName:
        | "LIVE_PLAY_START"
        | "LIVE_STARTUP"
        | "LIVE_REBUFFER"
        | "LIVE_RECONNECT"
        | "LIVE_FATAL_ERROR"
        | "LIVE_DURATION"
        | "LIVE_END"
        | "LIVE_PLAY_COMPLETE",
      input: {
        durationDeltaMs?: number;
        metadata?: Record<string, string | number | boolean | null>;
      } = {},
    ) => {
      trackAnalyticsEvent(eventName, {
        channelId,
        ...(input.durationDeltaMs === undefined
          ? {}
          : {
              durationDeltaMs: Math.max(0, Math.min(3_600_000, Math.round(input.durationDeltaMs))),
            }),
        metadata: { liveStreamId: streamId, ...(input.metadata ?? {}) },
      });
    },
    [channelId, streamId],
  );

  const flushDuration = useCallback(
    (continueSegment = false) => {
      const startedAt = durationSegmentStartedAtRef.current;
      if (startedAt === null) return;
      const now = performance.now();
      const delta = Math.max(0, now - startedAt);
      durationSegmentStartedAtRef.current = continueSegment ? now : null;
      if (delta >= 250) emit("LIVE_DURATION", { durationDeltaMs: delta });
    },
    [emit],
  );

  const updateEdge = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setEdge(liveEdgeSnapshot(video));
  }, []);

  const goLive = useCallback(async () => {
    const video = videoRef.current;
    if (!video || status !== "LIVE") return;
    moveToLiveEdge(video);
    updateEdge();
    if (video.paused && !adActiveRef.current) {
      try {
        await video.play();
        setAutoplayBlocked(false);
      } catch {
        setAutoplayBlocked(true);
      }
    }
  }, [status, updateEdge]);

  const togglePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video || status !== "LIVE" || (adMode.active && adMode.controlsLocked !== false)) return;
    if (video.paused) {
      if (!dvrWindowSeconds) moveToLiveEdge(video);
      try {
        await video.play();
        setAutoplayBlocked(false);
      } catch {
        setAutoplayBlocked(true);
      }
    } else {
      video.pause();
    }
  }, [adMode.active, adMode.controlsLocked, dvrWindowSeconds, status]);

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

  const selectCaption = useCallback(
    (trackId: string | null) => {
      const video = videoRef.current;
      setCaptionSelection({ streamId, trackId });
      if (!video) return;
      for (let index = 0; index < video.textTracks.length; index += 1) {
        const track = video.textTracks[index];
        const source = captions[index];
        if (track) track.mode = source?.id === trackId ? "showing" : "disabled";
      }
    },
    [captions, streamId],
  );

  const toggleCaptions = useCallback(() => {
    selectCaption(selectedCaptionId ? null : (defaultCaptionId ?? captions[0]?.id ?? null));
  }, [captions, defaultCaptionId, selectCaption, selectedCaptionId]);

  useEffect(() => {
    adActiveRef.current = adMode.active;
  }, [adMode.active]);

  useEffect(() => {
    onAdContainerReady?.(adContainerRef.current);
    return () => onAdContainerReady?.(null);
  }, [onAdContainerReady]);

  useEffect(() => {
    const reason = terminalEndReason(status);
    if (!reason || endedReportedRef.current) return;
    endedReportedRef.current = true;
    flushDuration(false);
    sessionRef.current?.destroy();
    sessionRef.current = null;
    const video = videoRef.current;
    if (video) stopLiveMedia(video);
    if (startedRef.current) {
      emit("LIVE_PLAY_COMPLETE", { metadata: { reason } });
      emit("LIVE_END", { metadata: { reason } });
    } else if (firstConnectStartedAtRef.current !== null) {
      emit("LIVE_END", { metadata: { reason: `${reason}_before_start` } });
    }
  }, [emit, flushDuration, status]);

  useEffect(() => {
    if (status !== "LIVE" || !playbackUrl) return;
    const video = videoRef.current;
    if (!video) return;
    const liveVideo: HTMLVideoElement = video;

    let cancelled = false;
    let reconnectTimer: number | null = null;
    let stableTimer: number | null = null;
    let startupWatchdog: number | null = null;
    let stallWatchdog: number | null = null;
    let durationTimer: number | null = null;
    let connecting = false;
    const attemptGuard = createLiveAttemptGuard();

    const clearReconnectTimer = () => {
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };
    const clearStableTimer = () => {
      if (stableTimer !== null) window.clearTimeout(stableTimer);
      stableTimer = null;
    };
    const clearStartupWatchdog = () => {
      if (startupWatchdog !== null) window.clearTimeout(startupWatchdog);
      startupWatchdog = null;
    };
    const clearStallWatchdog = () => {
      if (stallWatchdog !== null) window.clearTimeout(stallWatchdog);
      stallWatchdog = null;
    };

    const reportFatal = (reason: string) => {
      if (cancelled || fatalReportedRef.current) return;
      fatalReportedRef.current = true;
      connecting = false;
      attemptGuard.invalidate();
      clearReconnectTimer();
      clearStableTimer();
      clearStartupWatchdog();
      clearStallWatchdog();
      sessionRef.current?.destroy();
      sessionRef.current = null;
      stopLiveMedia(liveVideo);
      bufferStartedAtRef.current = null;
      flushDuration(false);
      setPlaying(false);
      setConnectionState("FATAL");
      setMessage("Live playback could not reconnect. Try again.");
      emit("LIVE_FATAL_ERROR", { metadata: { reason } });
    };

    const scheduleReconnect = (reason: AyinHlsFailureReason | "OFFLINE", immediate = false) => {
      if (cancelled || reconnectTimer !== null || fatalReportedRef.current) return;
      if (navigator.onLine === false) {
        setConnectionState("OFFLINE");
        setMessage("Connection lost. Waiting for network…");
        return;
      }

      const attemptIndex = reconnectAttemptRef.current;
      const policyDelay = liveReconnectDelayMs(attemptIndex);
      if (policyDelay === null) {
        reportFatal(reason);
        return;
      }
      const delayMs = immediate ? 0 : policyDelay;
      reconnectAttemptRef.current = attemptIndex + 1;
      setConnectionState("RECOVERING");
      setMessage(delayMs ? "Reconnecting to live stream…" : "Restoring live stream…");
      emit("LIVE_RECONNECT", {
        metadata: {
          reason,
          attempt: reconnectAttemptRef.current,
          delayMs,
        },
      });
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect(reason);
      }, delayMs);
    };

    async function connect(reason?: AyinHlsFailureReason | "OFFLINE") {
      if (cancelled || connecting || fatalReportedRef.current || navigator.onLine === false) return;
      const generation = attemptGuard.begin();
      connecting = true;
      clearStartupWatchdog();
      clearStallWatchdog();
      sessionRef.current?.destroy();
      sessionRef.current = null;
      setConnectionState(reason ? "RECOVERING" : "CONNECTING");
      if (!startedRef.current && firstConnectStartedAtRef.current === null) {
        firstConnectStartedAtRef.current = performance.now();
      }

      startupWatchdog = window.setTimeout(() => {
        startupWatchdog = null;
        if (!attemptGuard.isCurrent(generation)) return;
        attemptGuard.invalidate();
        connecting = false;
        sessionRef.current?.destroy();
        sessionRef.current = null;
        stopLiveMedia(liveVideo);
        bufferStartedAtRef.current = null;
        scheduleReconnect("STARTUP");
      }, LIVE_STARTUP_WATCHDOG_MS);

      let fatalDelivered = false;
      try {
        const next = await startAdaptiveHlsPlayback({
          video: liveVideo,
          hlsUrl: playbackUrl,
          mode: "LIVE",
          callbacks: {
            onReady: () => {
              if (cancelled || !attemptGuard.isCurrent(generation)) return;
              setMessage(null);
              updateEdge();
              if (startedRef.current || reason) moveToLiveEdge(liveVideo);
              if (autoPlay && !adActiveRef.current) {
                void liveVideo.play().catch(() => {
                  if (!attemptGuard.isCurrent(generation)) return;
                  clearStartupWatchdog();
                  setAutoplayBlocked(true);
                });
              } else {
                // The media is intentionally held for a user gesture/ad; this is not startup loss.
                clearStartupWatchdog();
              }
            },
            onRecoverable: (recoveringReason) => {
              if (cancelled || !attemptGuard.isCurrent(generation)) return;
              setConnectionState("RECOVERING");
              setMessage(
                recoveringReason === "MANIFEST"
                  ? "Refreshing live stream…"
                  : "Recovering live playback…",
              );
            },
            onRecovered: () => {
              if (cancelled || !attemptGuard.isCurrent(generation)) return;
              setMessage(null);
              if (startedRef.current && !liveVideo.paused) {
                setConnectionState("PLAYING");
              }
            },
            onFatal: (fatalReason) => {
              if (!attemptGuard.isCurrent(generation)) return;
              fatalDelivered = true;
              attemptGuard.invalidate();
              clearStableTimer();
              clearStartupWatchdog();
              clearStallWatchdog();
              connecting = false;
              flushDuration(false);
              bufferStartedAtRef.current = null;
              sessionRef.current?.destroy();
              sessionRef.current = null;
              scheduleReconnect(fatalReason);
            },
          },
        });
        if (cancelled || !attemptGuard.isCurrent(generation)) {
          next?.destroy();
          return;
        }
        sessionRef.current = next;
        if (!next && !fatalDelivered) {
          connecting = false;
          attemptGuard.invalidate();
          scheduleReconnect("UNSUPPORTED");
        }
      } catch {
        if (!cancelled && !fatalDelivered && attemptGuard.isCurrent(generation)) {
          connecting = false;
          attemptGuard.invalidate();
          scheduleReconnect("OTHER");
        }
      } finally {
        if (attemptGuard.isCurrent(generation)) connecting = false;
      }
    }

    const onPlaying = () => {
      if (cancelled) return;
      clearStartupWatchdog();
      setPlaying(true);
      setAutoplayBlocked(false);
      setConnectionState("PLAYING");
      setMessage(null);
      if (!dvrWindowSeconds) moveToLiveEdge(video);
      updateEdge();

      if (!startedRef.current) {
        startedRef.current = true;
        emit("LIVE_PLAY_START", { metadata: { protocol: "HLS" } });
        const startedAt = firstConnectStartedAtRef.current;
        if (startedAt !== null) {
          emit("LIVE_STARTUP", {
            durationDeltaMs: performance.now() - startedAt,
            metadata: { protocol: "HLS" },
          });
        }
      } else if (bufferStartedAtRef.current !== null) {
        emit("LIVE_REBUFFER", {
          durationDeltaMs: performance.now() - bufferStartedAtRef.current,
        });
      }
      bufferStartedAtRef.current = null;
      if (durationSegmentStartedAtRef.current === null) {
        durationSegmentStartedAtRef.current = performance.now();
      }

      clearStableTimer();
      clearStallWatchdog();
      stableTimer = window.setTimeout(() => {
        reconnectAttemptRef.current = 0;
        fatalReportedRef.current = false;
      }, STABLE_PLAYBACK_RESET_MS);
    };

    const onPause = () => {
      clearStableTimer();
      clearStallWatchdog();
      bufferStartedAtRef.current = null;
      setPlaying(false);
      flushDuration(false);
    };

    const onWaiting = () => {
      clearStableTimer();
      if (startedRef.current && bufferStartedAtRef.current === null) {
        bufferStartedAtRef.current = performance.now();
      }
      flushDuration(false);
      if (startedRef.current && stallWatchdog === null) {
        stallWatchdog = window.setTimeout(() => {
          stallWatchdog = null;
          attemptGuard.invalidate();
          sessionRef.current?.destroy();
          sessionRef.current = null;
          stopLiveMedia(liveVideo);
          bufferStartedAtRef.current = null;
          setPlaying(false);
          scheduleReconnect("NETWORK");
        }, LIVE_STALL_WATCHDOG_MS);
      }
    };

    const onEnded = () => {
      clearStableTimer();
      clearStallWatchdog();
      setPlaying(false);
      flushDuration(false);
      attemptGuard.invalidate();
      scheduleReconnect("OTHER");
    };

    const onOffline = () => {
      clearReconnectTimer();
      clearStableTimer();
      clearStallWatchdog();
      connecting = false;
      attemptGuard.invalidate();
      sessionRef.current?.destroy();
      sessionRef.current = null;
      setConnectionState("OFFLINE");
      setMessage("Connection lost. Waiting for network…");
      flushDuration(false);
    };

    const onOnline = () => {
      if (cancelled || fatalReportedRef.current) return;
      scheduleReconnect("OFFLINE", true);
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible" || !startedRef.current) return;
      if (!dvrWindowSeconds) {
        moveToLiveEdge(video);
        updateEdge();
      }
    };

    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onWaiting);
    video.addEventListener("ended", onEnded);
    video.addEventListener("timeupdate", updateEdge);
    video.addEventListener("progress", updateEdge);
    video.addEventListener("canplay", updateEdge);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);

    durationTimer = window.setInterval(() => {
      if (!video.paused && navigator.onLine !== false) flushDuration(true);
    }, LIVE_DURATION_SAMPLE_MS);

    void connect();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      clearStableTimer();
      clearStartupWatchdog();
      clearStallWatchdog();
      attemptGuard.invalidate();
      if (durationTimer !== null) window.clearInterval(durationTimer);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onWaiting);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("timeupdate", updateEdge);
      video.removeEventListener("progress", updateEdge);
      video.removeEventListener("canplay", updateEdge);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      sessionRef.current?.destroy();
      sessionRef.current = null;
      stopLiveMedia(liveVideo);
      bufferStartedAtRef.current = null;
      flushDuration(false);
    };
  }, [
    autoPlay,
    dvrWindowSeconds,
    emit,
    flushDuration,
    manualRetryGeneration,
    playbackUrl,
    status,
    updateEdge,
  ]);

  useEffect(
    () => () => {
      flushDuration(false);
      sessionRef.current?.destroy();
      sessionRef.current = null;
      const video = videoRef.current;
      if (video) stopLiveMedia(video);
      bufferStartedAtRef.current = null;
    },
    [flushDuration],
  );

  const retry = useCallback(() => {
    reconnectAttemptRef.current = 0;
    fatalReportedRef.current = false;
    bufferStartedAtRef.current = null;
    if (!startedRef.current) firstConnectStartedAtRef.current = null;
    setPlaying(false);
    setAutoplayBlocked(false);
    setMessage(null);
    setConnectionState("CONNECTING");
    setManualRetryGeneration((value) => value + 1);
  }, []);

  function onStageKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("button,input,select,textarea,a")
    ) {
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === " " || key === "k" || key === "enter") {
      event.preventDefault();
      event.stopPropagation();
      void togglePlay();
    } else if (key === "m") {
      event.preventDefault();
      event.stopPropagation();
      toggleMute();
    } else if (key === "c" && captions.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      toggleCaptions();
    } else if (key === "f") {
      event.preventDefault();
      event.stopPropagation();
      void toggleFullscreen();
    } else if (key === "g") {
      event.preventDefault();
      event.stopPropagation();
      void goLive();
    }
  }

  const latencyLabel = usefulLiveLatencyLabel(edge);
  const terminal = terminalEndReason(status);
  const terminalMessage =
    status === "ENDED"
      ? "This live stream has ended."
      : terminal
        ? "This live stream is unavailable."
        : null;
  const visibleMessage = terminalMessage ?? message;
  const effectivePlaying = terminal ? false : playing;
  const controlsLocked = adMode.active && adMode.controlsLocked !== false;
  const showGoLive = status === "LIVE" && !edge.atLiveEdge;

  return (
    <TvFocusScope className={className}>
      <section
        aria-label={`${title} live player`}
        className={styles.player}
        data-live-player="true"
        data-live-state={terminal ? "ENDED" : connectionState}
        data-playing={effectivePlaying}
        ref={rootRef}
      >
        <div
          className={styles.stage}
          data-player-stage="true"
          data-tv-focusable="true"
          data-tv-focus-id={`live-player-stage-${streamId}`}
          onDoubleClick={() => void toggleFullscreen()}
          onKeyDown={onStageKeyDown}
          tabIndex={0}
        >
          <video className={styles.video} muted={muted} playsInline ref={videoRef} title={title}>
            {captions.map((track) => (
              <track
                default={track.default}
                key={track.id}
                kind={track.kind.toLowerCase() as "captions" | "subtitles"}
                label={track.label}
                src={track.src}
                srcLang={track.language}
              />
            ))}
          </video>

          <div className={styles.titleBar}>
            <span className={styles.liveBadge} data-at-live-edge={edge.atLiveEdge}>
              {edge.atLiveEdge ? "LIVE" : "LIVE · BEHIND"}
            </span>
            <strong>{title}</strong>
            {latencyLabel ? <span className={styles.latency}>{latencyLabel}</span> : null}
          </div>

          {visibleMessage ? (
            <div className={styles.status} aria-live="polite">
              <p>{visibleMessage}</p>
              {!terminal && connectionState === "FATAL" ? (
                <button data-tv-focusable="true" onClick={retry} type="button">
                  Try again
                </button>
              ) : null}
            </div>
          ) : null}

          {autoplayBlocked && status === "LIVE" ? (
            <button
              className={styles.centerPlay}
              data-tv-focusable="true"
              onClick={() => void togglePlay()}
              type="button"
            >
              Play live
            </button>
          ) : null}

          <div
            className={`${styles.adContainer} ${adMode.active ? styles.adActive : ""}`}
            ref={adContainerRef}
          >
            {adMode.active ? <span>{adMode.label ?? "Advertisement"}</span> : null}
          </div>

          <div className={styles.controls}>
            <button
              aria-label={effectivePlaying ? "Pause live" : "Play live"}
              data-tv-focusable="true"
              disabled={status !== "LIVE" || controlsLocked}
              onClick={() => void togglePlay()}
              type="button"
            >
              {effectivePlaying ? "Pause" : "Play"}
            </button>
            <button
              aria-label={muted ? "Unmute" : "Mute"}
              data-tv-focusable="true"
              onClick={toggleMute}
              type="button"
            >
              {muted ? "Unmute" : "Mute"}
            </button>
            {showGoLive ? (
              <button data-tv-focusable="true" onClick={() => void goLive()} type="button">
                Go live
              </button>
            ) : (
              <span className={styles.edgeLabel}>Live edge</span>
            )}
            {captions.length ? (
              <button
                aria-pressed={Boolean(selectedCaptionId)}
                data-tv-focusable="true"
                onClick={toggleCaptions}
                type="button"
              >
                CC
              </button>
            ) : null}
            {dvrWindowSeconds ? (
              <span className={styles.dvrLabel}>
                DVR {Math.max(1, Math.round(dvrWindowSeconds / 60))}m
              </span>
            ) : null}
            <span className={styles.spacer} />
            <button data-tv-focusable="true" onClick={() => void toggleFullscreen()} type="button">
              Fullscreen
            </button>
          </div>
        </div>
        {footer}
      </section>
    </TvFocusScope>
  );
}
