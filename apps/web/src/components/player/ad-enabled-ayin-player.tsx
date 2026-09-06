"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { type AyinPlayerProps, AyinPlayer } from "./ayin-player";
import { GoogleImaVideoAdService } from "@/lib/google-ima-video-ad-service";
import {
  canServeSessionAd,
  fetchVideoAdDecision,
  getVideoAdSessionId,
  markSessionAdServed,
  recordVideoAdEvent,
  type VideoAdDecision,
  type VideoAdEventType,
  type VideoAdSlot,
} from "@/lib/video-ads";

import styles from "./ad-enabled-ayin-player.module.css";

export function AdEnabledAyinPlayer(props: AyinPlayerProps) {
  const [decision, setDecision] = useState<VideoAdDecision | null>(null);
  const [decisionLoaded, setDecisionLoaded] = useState(false);
  const [adContainer, setAdContainer] = useState<HTMLDivElement | null>(null);
  const [contentVideo, setContentVideo] = useState<HTMLVideoElement | null>(null);
  const [activated, setActivated] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [adActive, setAdActive] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const serviceRef = useRef<GoogleImaVideoAdService | null>(null);
  const midRollPlayedRef = useRef(false);
  const postRollPlayedRef = useRef(false);
  const requestIdRef = useRef(crypto.randomUUID());

  useEffect(() => {
    const controller = new AbortController();
    void fetchVideoAdDecision(props.videoId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setDecision(result.enabled ? result : null);
        setDecisionLoaded(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDecisionLoaded(true);
      });
    return () => controller.abort();
  }, [props.videoId]);

  const handleAdContainerReady = useCallback((element: HTMLDivElement | null) => {
    setAdContainer(element);
    setContentVideo(element?.parentElement?.querySelector("video") ?? null);
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
    if (!contentVideo) return false;
    try {
      await contentVideo.play();
      setAutoplayBlocked(false);
      return true;
    } catch {
      // Browsers commonly permit muted autoplay before a user gesture.
      contentVideo.muted = true;
      try {
        await contentVideo.play();
        setAutoplayBlocked(false);
        return true;
      } catch {
        setAutoplayBlocked(true);
        return false;
      }
    }
  }, [contentVideo]);

  const playAd = useCallback(
    async (slot: VideoAdSlot) => {
      if (!decision || !adContainer || !contentVideo) return false;
      if (!canServeSessionAd(decision.frequencyCapPerSession)) return false;
      const service = serviceRef.current ?? new GoogleImaVideoAdService();
      serviceRef.current = service;
      try {
        await service.initialize(adContainer, contentVideo);
        setAdActive(true);
        setStatus("Advertisement");
        contentVideo.pause();
        await service.play(slot, decision.tagUrl, {
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
        });
        return true;
      } catch {
        setAdActive(false);
        setStatus(null);
        if (slot !== "POST_ROLL") void attemptContentPlayback();
        return false;
      }
    },
    [adContainer, attemptContentPlayback, contentVideo, decision, emit],
  );

  const activatePlayback = useCallback(async () => {
    if (!contentVideo || !adContainer) return;
    setActivated(true);
    setAutoplayBlocked(false);
    if (decision?.preRollEnabled) {
      const served = await playAd("PRE_ROLL");
      if (served) return;
    }
    await attemptContentPlayback();
  }, [adContainer, attemptContentPlayback, contentVideo, decision, playAd]);

  useEffect(() => {
    if (
      !decisionLoaded ||
      !contentVideo ||
      !adContainer ||
      activated ||
      props.autoPlay !== true
    ) {
      return;
    }
    void activatePlayback();
  }, [activatePlayback, activated, adContainer, contentVideo, decisionLoaded, props.autoPlay]);

  useEffect(() => {
    if (!decision || !contentVideo || !activated) return;
    const onTimeUpdate = () => {
      if (
        !decision.midRollEnabled ||
        midRollPlayedRef.current ||
        contentVideo.currentTime < decision.midRollEverySec
      ) {
        return;
      }
      midRollPlayedRef.current = true;
      void playAd("MID_ROLL");
    };
    const onEnded = () => {
      serviceRef.current?.contentComplete();
      if (decision.postRollEnabled && !postRollPlayedRef.current) {
        postRollPlayedRef.current = true;
        void playAd("POST_ROLL");
      }
    };
    contentVideo.addEventListener("timeupdate", onTimeUpdate);
    contentVideo.addEventListener("ended", onEnded);
    return () => {
      contentVideo.removeEventListener("timeupdate", onTimeUpdate);
      contentVideo.removeEventListener("ended", onEnded);
    };
  }, [activated, contentVideo, decision, playAd]);

  useEffect(
    () => () => {
      serviceRef.current?.destroy();
      serviceRef.current = null;
    },
    [],
  );

  const adEligible = Boolean(
    decision && (decision.preRollEnabled || decision.midRollEnabled || decision.postRollEnabled),
  );

  return (
    <div className={styles.wrap}>
      <AyinPlayer
        {...props}
        autoPlay={false}
        adMode={{ active: adActive, controlsLocked: adActive, label: status ?? "Advertisement" }}
        onAdContainerReady={handleAdContainerReady}
      />
      {autoplayBlocked || (adEligible && !activated && props.autoPlay !== true) ? (
        <button
          aria-label="Play video"
          className={styles.start}
          data-tv-focusable="true"
          onClick={() => void activatePlayback()}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M8 5.5v13l10-6.5z" />
          </svg>
          <span>{autoplayBlocked ? "Tap to play" : "Play video"}</span>
        </button>
      ) : null}
    </div>
  );
}
