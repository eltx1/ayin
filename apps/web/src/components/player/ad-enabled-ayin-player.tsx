"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { type AyinPlayerProps, AyinPlayer } from "./ayin-player";
import {
  type AyinAdaptivePlaybackSession,
  type AyinPlaybackRendition,
  startAdaptiveHlsPlayback,
} from "@/lib/adaptive-playback";
import { GoogleImaVideoAdService } from "@/lib/google-ima-video-ad-service";
import {
  canServeSessionAd,
  fetchVideoAdDecision,
  getVideoAdSessionId,
  markSessionAdServed,
  recordVideoAdEvent,
  type VideoAdDecision,
  type VideoAdEventType,
  type VideoAdPlaybackIntent,
  type VideoAdSlot,
} from "@/lib/video-ads";

import styles from "./ad-enabled-ayin-player.module.css";

export interface AdEnabledAyinPlayerProps extends AyinPlayerProps {
  adaptiveSourceUrl?: string | null | undefined;
}

function mobileImaRequiresGesture(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function AdEnabledAyinPlayer(props: AdEnabledAyinPlayerProps) {
  const { adaptiveSourceUrl: requestedAdaptiveSourceUrl = null, ...playerProps } = props;
  const [decision, setDecision] = useState<VideoAdDecision | null>(null);
  const [decisionLoaded, setDecisionLoaded] = useState(false);
  const [targetsReady, setTargetsReady] = useState(false);
  const [activated, setActivated] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [imaGestureRequired, setImaGestureRequired] = useState(false);
  const [adActive, setAdActive] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [sourceReady, setSourceReady] = useState(!requestedAdaptiveSourceUrl);
  const [qualities, setQualities] = useState<AyinPlaybackRendition[]>([]);
  const [qualitySelection, setQualitySelection] = useState("auto");
  const serviceRef = useRef<GoogleImaVideoAdService | null>(null);
  const adaptiveSessionRef = useRef<AyinAdaptivePlaybackSession | null>(null);
  const adContainerRef = useRef<HTMLDivElement | null>(null);
  const contentVideoRef = useRef<HTMLVideoElement | null>(null);
  const midRollPlayedRef = useRef(false);
  const postRollPlayedRef = useRef(false);
  const fallbackAttemptedRef = useRef(false);
  const requestIdRef = useRef(crypto.randomUUID());

  useEffect(() => {
    const controller = new AbortController();
    void fetchVideoAdDecision(props.videoId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        const enabledDecision = result.enabled ? result : null;
        setDecision(enabledDecision);
        setDecisionLoaded(true);
        setImaGestureRequired(
          Boolean(enabledDecision?.preRollEnabled && mobileImaRequiresGesture()),
        );

        if (enabledDecision?.preRollEnabled) {
          const service = serviceRef.current ?? new GoogleImaVideoAdService();
          serviceRef.current = service;
          void service.preload().catch(() => undefined);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setDecisionLoaded(true);
      });
    return () => controller.abort();
  }, [props.videoId]);

  const handleAdContainerReady = useCallback((element: HTMLDivElement | null) => {
    adContainerRef.current = element;
    contentVideoRef.current = element?.parentElement?.querySelector("video") ?? null;
    setTargetsReady(Boolean(adContainerRef.current && contentVideoRef.current));
  }, []);

  const emit = useCallback(
    (slot: VideoAdSlot, type: VideoAdEventType, errorCode?: string) => {
      if (!decision) return;
      if (type === "START") markSessionAdServed();
      void recordVideoAdEvent({
        videoId: props.videoId,
        slot,
        eventType: type,
        requestId: requestIdRef.current,
        sessionId: getVideoAdSessionId(),
        provider: decision.provider,
        ...(errorCode ? { errorCode } : {}),
      });
    },
    [decision, props.videoId],
  );

  const attemptContentPlayback = useCallback(async () => {
    const video = contentVideoRef.current;
    if (!video) return false;
    try {
      await video.play();
      setAutoplayBlocked(false);
      return true;
    } catch {
      video.muted = true;
      try {
        await video.play();
        setAutoplayBlocked(false);
        return true;
      } catch {
        setAutoplayBlocked(true);
        return false;
      }
    }
  }, []);

  const fallbackToMp4 = useCallback(
    (
      reason: "NETWORK" | "MEDIA" | "MANIFEST" | "STARTUP" | "UNSUPPORTED" | "OTHER",
    ) => {
      const video = contentVideoRef.current;
      if (!video || fallbackAttemptedRef.current) return;
      fallbackAttemptedRef.current = true;
      adaptiveSessionRef.current?.destroy();
      adaptiveSessionRef.current = null;
      const resumeTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const shouldResume = !video.paused && !adActive;
      setQualities([]);
      setQualitySelection("auto");
      props.analytics?.emit({ type: "fallback_mp4", videoId: props.videoId, reason });
      props.analytics?.emit({ type: "playback_protocol", videoId: props.videoId, protocol: "MP4" });
      const restore = () => {
        if (resumeTime > 0 && Number.isFinite(video.duration)) {
          try {
            video.currentTime = Math.min(resumeTime, Math.max(0, video.duration - 0.25));
          } catch {
            // The canonical MP4 remains playable even if the browser rejects an early seek.
          }
        }
        setSourceReady(true);
        if (shouldResume) void attemptContentPlayback();
      };
      video.addEventListener("loadedmetadata", restore, { once: true });
      video.src = props.sourceUrl;
      video.load();
    },
    [adActive, attemptContentPlayback, props.analytics, props.sourceUrl, props.videoId],
  );

  useEffect(() => {
    fallbackAttemptedRef.current = false;
    adaptiveSessionRef.current?.destroy();
    adaptiveSessionRef.current = null;
    setQualities([]);
    setQualitySelection("auto");
    setSourceReady(!requestedAdaptiveSourceUrl);
  }, [props.videoId, props.sourceUrl, requestedAdaptiveSourceUrl]);

  useEffect(() => {
    const video = contentVideoRef.current;
    if (!targetsReady || !video) return;
    if (!requestedAdaptiveSourceUrl || fallbackAttemptedRef.current) {
      props.analytics?.emit({ type: "playback_protocol", videoId: props.videoId, protocol: "MP4" });
      setSourceReady(true);
      return;
    }

    let cancelled = false;
    let ready = false;
    const startupTimer = window.setTimeout(() => {
      if (!ready && !cancelled) {
        props.analytics?.emit({ type: "hls_fatal", videoId: props.videoId, reason: "STARTUP" });
        fallbackToMp4("STARTUP");
      }
    }, 12_000);

    void startAdaptiveHlsPlayback({
      video,
      hlsUrl: requestedAdaptiveSourceUrl,
      callbacks: {
        onReady: () => {
          if (cancelled) return;
          ready = true;
          window.clearTimeout(startupTimer);
          props.analytics?.emit({ type: "playback_protocol", videoId: props.videoId, protocol: "HLS" });
          setSourceReady(true);
        },
        onQualities: (items) => {
          if (!cancelled) setQualities(items);
        },
        onQualitySwitch: ({ selection, rendition, automatic }) => {
          if (cancelled) return;
          props.analytics?.emit({
            type: "quality_switch",
            videoId: props.videoId,
            selection,
            automatic,
            rendition: rendition
              ? { label: rendition.label, height: rendition.height, bitrateKbps: rendition.bitrateKbps }
              : null,
          });
        },
        onFatal: (reason) => {
          if (cancelled || fallbackAttemptedRef.current) return;
          props.analytics?.emit({ type: "hls_fatal", videoId: props.videoId, reason });
          fallbackToMp4(reason);
        },
      },
    }).then((session) => {
      if (cancelled) {
        session?.destroy();
        return;
      }
      adaptiveSessionRef.current = session;
      if (!session && !fallbackAttemptedRef.current) fallbackToMp4("UNSUPPORTED");
    });

    return () => {
      cancelled = true;
      window.clearTimeout(startupTimer);
      adaptiveSessionRef.current?.destroy();
      adaptiveSessionRef.current = null;
    };
  }, [fallbackToMp4, props.analytics, props.videoId, requestedAdaptiveSourceUrl, targetsReady]);

  const playAd = useCallback(
    async (slot: VideoAdSlot, playbackIntent?: VideoAdPlaybackIntent) => {
      const adContainer = adContainerRef.current;
      const contentVideo = contentVideoRef.current;
      if (!decision || !adContainer || !contentVideo) return false;
      if (!canServeSessionAd(decision.frequencyCapPerSession)) return false;
      const service = serviceRef.current ?? new GoogleImaVideoAdService();
      serviceRef.current = service;
      try {
        await service.initialize(adContainer, contentVideo);
        setAdActive(true);
        setStatus("Advertisement");
        contentVideo.pause();
        await service.play(
          slot,
          decision.tagUrl,
          {
            onEvent: (type, errorCode) => emit(slot, type, errorCode),
            onContentPause: () => {
              contentVideo.pause();
              setAdActive(true);
            },
            onContentResume: () => {
              setAdActive(false);
              setStatus(null);
              if (slot !== "POST_ROLL") void attemptContentPlayback();
            },
          },
          playbackIntent,
        );
        return true;
      } catch {
        setAdActive(false);
        setStatus(null);
        return false;
      }
    },
    [attemptContentPlayback, decision, emit],
  );

  const activatePlayback = useCallback(
    async (autoPlayAttempt = false) => {
      const contentVideo = contentVideoRef.current;
      const adContainer = adContainerRef.current;
      if (!contentVideo || !adContainer || !sourceReady) return;
      setActivated(true);
      setAutoplayBlocked(false);

      if (decision?.preRollEnabled) {
        if (autoPlayAttempt) contentVideo.muted = true;
        const served = await playAd("PRE_ROLL", {
          autoPlay: autoPlayAttempt,
          muted: contentVideo.muted,
        });
        if (served) return;
      }
      await attemptContentPlayback();
    },
    [attemptContentPlayback, decision, playAd, sourceReady],
  );

  useEffect(() => {
    if (
      !decisionLoaded ||
      !targetsReady ||
      !sourceReady ||
      activated ||
      props.autoPlay !== true ||
      (decision?.preRollEnabled && imaGestureRequired)
    ) {
      return;
    }
    const timeout = window.setTimeout(() => void activatePlayback(true), 0);
    return () => window.clearTimeout(timeout);
  }, [activatePlayback, activated, decision?.preRollEnabled, decisionLoaded, imaGestureRequired, props.autoPlay, sourceReady, targetsReady]);

  useEffect(() => {
    const contentVideo = contentVideoRef.current;
    if (!decision || !contentVideo || !activated) return;
    const onTimeUpdate = () => {
      if (!decision.midRollEnabled || midRollPlayedRef.current || contentVideo.currentTime < decision.midRollEverySec) return;
      midRollPlayedRef.current = true;
      void playAd("MID_ROLL", { autoPlay: false, muted: contentVideo.muted });
    };
    const onEnded = () => {
      serviceRef.current?.contentComplete();
      if (decision.postRollEnabled && !postRollPlayedRef.current) {
        postRollPlayedRef.current = true;
        void playAd("POST_ROLL", { autoPlay: false, muted: contentVideo.muted });
      }
    };
    contentVideo.addEventListener("timeupdate", onTimeUpdate);
    contentVideo.addEventListener("ended", onEnded);
    return () => {
      contentVideo.removeEventListener("timeupdate", onTimeUpdate);
      contentVideo.removeEventListener("ended", onEnded);
    };
  }, [activated, decision, playAd]);

  useEffect(
    () => () => {
      adaptiveSessionRef.current?.destroy();
      serviceRef.current?.destroy();
      serviceRef.current = null;
    },
    [],
  );

  const adEligible = Boolean(decision && (decision.preRollEnabled || decision.midRollEnabled || decision.postRollEnabled));
  const gestureGate = Boolean(decision?.preRollEnabled && imaGestureRequired);

  return (
    <div className={styles.wrap}>
      <AyinPlayer
        {...playerProps}
        autoPlay={false}
        adMode={{ active: adActive, controlsLocked: adActive, label: status ?? "Advertisement" }}
        onAdContainerReady={handleAdContainerReady}
      />
      {qualities.length > 0 && !adActive ? (
        <label className={styles.quality}>
          <span>Quality</span>
          <select
            aria-label="Playback quality"
            data-tv-focusable="true"
            data-tv-focus-id={`player-quality-${props.videoId}`}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setQualitySelection(value);
              adaptiveSessionRef.current?.setQuality(value === "auto" ? null : value);
            }}
            value={qualitySelection}
          >
            <option value="auto">Auto</option>
            {qualities.map((quality) => (
              <option key={quality.id} value={quality.id}>{quality.label}</option>
            ))}
          </select>
        </label>
      ) : null}
      {autoplayBlocked || (adEligible && !activated && (props.autoPlay !== true || gestureGate)) ? (
        <button
          aria-label="Play video"
          className={styles.start}
          data-tv-focusable="true"
          onClick={() => void activatePlayback(false)}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5z" /></svg>
          <span>{autoplayBlocked ? "Tap to play" : "Play video"}</span>
        </button>
      ) : null}
    </div>
  );
}