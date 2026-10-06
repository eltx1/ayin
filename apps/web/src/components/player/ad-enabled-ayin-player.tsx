"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

import { type AyinPlayerProps, AyinPlayer } from "./ayin-player";
import styles from "./ad-enabled-ayin-player.module.css";

function mobileImaRequiresGesture(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function AdEnabledAyinPlayer(props: AyinPlayerProps) {
  // Creator TV replaces programs in the same tree. A new video needs fresh
  // decisions, media references and break state; token/URL refreshes do not.
  return <AdEnabledPlayerSession key={props.videoId} {...props} />;
}

function AdEnabledPlayerSession(props: AyinPlayerProps) {
  const [decision, setDecision] = useState<VideoAdDecision | null>(null);
  const [decisionLoaded, setDecisionLoaded] = useState(false);
  const [targetsReady, setTargetsReady] = useState(false);
  const [playbackReadyFor, setPlaybackReadyFor] = useState<string | null>(null);
  const [activated, setActivated] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [imaGestureRequired, setImaGestureRequired] = useState(false);
  const [adActive, setAdActive] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const serviceRef = useRef<GoogleImaVideoAdService | null>(null);
  const adContainerRef = useRef<HTMLDivElement | null>(null);
  const contentVideoRef = useRef<HTMLVideoElement | null>(null);
  const midRollPlayedRef = useRef(false);
  const postRollPlayedRef = useRef(false);
  const requestIdRef = useRef(crypto.randomUUID());
  const lifecycleRef = useRef<{ active: boolean; busy: boolean }>({ active: false, busy: false });
  const playbackIdentity = `${props.videoId}:${props.sourceUrl}:${props.adaptiveSourceUrl ?? ""}`;
  const playbackReady = playbackReadyFor === playbackIdentity;
  const onPlaybackReady = props.onPlaybackReady;

  useEffect(() => {
    const lifecycle = { active: true, busy: false };
    lifecycleRef.current = lifecycle;
    return () => {
      lifecycle.active = false;
      serviceRef.current?.destroy();
      serviceRef.current = null;
    };
  }, []);

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
          // Load the SDK before a possible mobile tap so AdDisplayContainer.initialize()
          // can stay in the direct user-gesture stack as required by Google IMA.
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

  const handlePlaybackReady = useCallback(() => {
    setPlaybackReadyFor(playbackIdentity);
    onPlaybackReady?.();
  }, [onPlaybackReady, playbackIdentity]);

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
    const lifecycle = lifecycleRef.current;
    const video = contentVideoRef.current;
    if (!video || !lifecycle.active) return false;
    try {
      await video.play();
      if (!lifecycle.active) return false;
      setAutoplayBlocked(false);
      return true;
    } catch {
      if (!lifecycle.active) return false;
      // Browsers commonly permit muted autoplay before a user gesture.
      video.muted = true;
      try {
        await video.play();
        if (!lifecycle.active) return false;
        setAutoplayBlocked(false);
        return true;
      } catch {
        if (!lifecycle.active) return false;
        setAutoplayBlocked(true);
        return false;
      }
    }
  }, []);

  const playAd = useCallback(
    async (slot: VideoAdSlot, playbackIntent?: VideoAdPlaybackIntent) => {
      const lifecycle = lifecycleRef.current;
      const adContainer = adContainerRef.current;
      const contentVideo = contentVideoRef.current;
      if (!lifecycle.active || lifecycle.busy || !decision || !adContainer || !contentVideo)
        return false;
      if (!canServeSessionAd(decision.frequencyCapPerSession)) return false;
      lifecycle.busy = true;
      const service = serviceRef.current ?? new GoogleImaVideoAdService();
      serviceRef.current = service;
      try {
        await service.initialize(adContainer, contentVideo);
        if (!lifecycle.active) return false;
        setAdActive(true);
        setStatus("Advertisement");
        contentVideo.pause();
        await service.play(
          slot,
          decision.tagUrl,
          {
            onEvent: (type, errorCode) => {
              if (lifecycle.active) emit(slot, type, errorCode);
            },
            onContentPause: () => {
              if (!lifecycle.active) return;
              contentVideo.pause();
              setAdActive(true);
            },
            onContentResume: () => {
              if (!lifecycle.active) return;
              setAdActive(false);
              setStatus(null);
              if (slot !== "POST_ROLL") void attemptContentPlayback();
            },
          },
          playbackIntent,
        );
        return true;
      } catch {
        if (!lifecycle.active) return false;
        emit(slot, "ERROR", "IMA_PLAYBACK_EXCEPTION");
        setAdActive(false);
        setStatus(null);
        return false;
      } finally {
        lifecycle.busy = false;
      }
    },
    [attemptContentPlayback, decision, emit],
  );

  const activatePlayback = useCallback(
    async (autoPlayAttempt = false) => {
      const lifecycle = lifecycleRef.current;
      const contentVideo = contentVideoRef.current;
      const adContainer = adContainerRef.current;
      if (!lifecycle.active || !contentVideo || !adContainer || !playbackReady || lifecycle.busy)
        return;
      setActivated(true);
      setAutoplayBlocked(false);

      if (decision?.preRollEnabled) {
        if (autoPlayAttempt) contentVideo.muted = true;
        const served = await playAd("PRE_ROLL", {
          autoPlay: autoPlayAttempt,
          muted: contentVideo.muted,
        });
        if (!lifecycle.active) return;
        if (served) return;
      }
      await attemptContentPlayback();
    },
    [attemptContentPlayback, decision, playAd, playbackReady],
  );

  useEffect(() => {
    if (
      !decisionLoaded ||
      !targetsReady ||
      !playbackReady ||
      activated ||
      props.autoPlay !== true ||
      (decision?.preRollEnabled && imaGestureRequired)
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void activatePlayback(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [
    activatePlayback,
    activated,
    decision?.preRollEnabled,
    decisionLoaded,
    imaGestureRequired,
    playbackReady,
    props.autoPlay,
    targetsReady,
  ]);

  useEffect(() => {
    const contentVideo = contentVideoRef.current;
    if (!decision || !contentVideo || !activated) return;
    const onTimeUpdate = () => {
      if (
        !decision.midRollEnabled ||
        lifecycleRef.current.busy ||
        midRollPlayedRef.current ||
        contentVideo.currentTime < decision.midRollEverySec
      ) {
        return;
      }
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

  const adEligible = Boolean(
    decision && (decision.preRollEnabled || decision.midRollEnabled || decision.postRollEnabled),
  );
  const gestureGate = Boolean(decision?.preRollEnabled && imaGestureRequired);
  const showStart =
    autoplayBlocked || (adEligible && !activated && (props.autoPlay !== true || gestureGate));

  return (
    <div className={styles.wrap}>
      <AyinPlayer
        {...props}
        autoPlay={false}
        adMode={{ active: adActive, controlsLocked: adActive, label: status ?? "Advertisement" }}
        onAdContainerReady={handleAdContainerReady}
        onPlaybackReady={handlePlaybackReady}
      />
      {showStart ? (
        <button
          aria-label="Play video"
          className={styles.start}
          data-tv-focusable="true"
          disabled={!playbackReady}
          onClick={() => void activatePlayback(false)}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M8 5.5v13l10-6.5z" />
          </svg>
          <span>
            {!playbackReady ? "Preparing video…" : autoplayBlocked ? "Tap to play" : "Play video"}
          </span>
        </button>
      ) : null}
    </div>
  );
}
