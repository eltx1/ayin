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
  const [adContainer, setAdContainer] = useState<HTMLDivElement | null>(null);
  const [contentVideo, setContentVideo] = useState<HTMLVideoElement | null>(null);
  const [activated, setActivated] = useState(false);
  const [adActive, setAdActive] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const serviceRef = useRef<GoogleImaVideoAdService | null>(null);
  const midRollPlayedRef = useRef(false);
  const postRollPlayedRef = useRef(false);
  const requestIdRef = useRef(crypto.randomUUID());

  useEffect(() => {
    const controller = new AbortController();
    void fetchVideoAdDecision(props.videoId, controller.signal).then((result) => {
      if (!controller.signal.aborted && result.enabled) setDecision(result);
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
            if (slot !== "POST_ROLL") void contentVideo.play().catch(() => undefined);
          },
        });
        return true;
      } catch {
        setAdActive(false);
        setStatus(null);
        if (slot !== "POST_ROLL") void contentVideo.play().catch(() => undefined);
        return false;
      }
    },
    [adContainer, contentVideo, decision, emit],
  );

  async function activatePlayback() {
    if (!contentVideo || !adContainer) return;
    setActivated(true);
    if (decision?.preRollEnabled) {
      const served = await playAd("PRE_ROLL");
      if (served) return;
    }
    void contentVideo.play().catch(() => undefined);
  }

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
        adMode={{ active: adActive, controlsLocked: adActive, label: status ?? "Advertisement" }}
        onAdContainerReady={handleAdContainerReady}
      />
      {adEligible && !activated ? (
        <button
          className={styles.start}
          data-tv-focusable="true"
          onClick={() => void activatePlayback()}
        >
          Start playback
        </button>
      ) : null}
    </div>
  );
}
