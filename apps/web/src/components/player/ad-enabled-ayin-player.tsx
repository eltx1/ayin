"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { GoogleImaVideoAdService } from "@/lib/google-ima-video-ad-service";
import { translatePlayer } from "@/lib/i18n/player";
import {
  createAdvertisingConsentScope,
  ADVERTISING_CONSENT_CHANGED,
  type AdvertisingConsentSnapshot,
} from "@/lib/advertising-consent";
import { useAdvertisingConsent } from "@/lib/use-advertising-consent";
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
  const { locale } = useI18n();
  const consent = useAdvertisingConsent();
  const [decisionState, setDecisionState] = useState<{
    consent: AdvertisingConsentSnapshot;
    decision: VideoAdDecision | null;
  } | null>(null);
  const decisionLoaded = decisionState?.consent === consent;
  const decision = decisionLoaded ? decisionState.decision : null;
  const [targetsReady, setTargetsReady] = useState(false);
  const [playbackReadyFor, setPlaybackReadyFor] = useState<string | null>(null);
  const [activated, setActivated] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const [imaGestureRequired, setImaGestureRequired] = useState(false);
  const [adActive, setAdActive] = useState(false);
  const [status, setStatus] = useState<"player.advertisement" | null>(null);
  const serviceRef = useRef<GoogleImaVideoAdService | null>(null);
  const adScopeRef = useRef<ReturnType<typeof createAdvertisingConsentScope> | null>(null);
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
      adScopeRef.current?.release();
      serviceRef.current?.destroy();
      serviceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scope = createAdvertisingConsentScope(consent);
    if (!scope.isCurrent()) return () => scope.release();
    const revoke = () => {
      if (scope.signal.reason !== ADVERTISING_CONSENT_CHANGED) return;
      if (adContainerRef.current) adContainerRef.current.hidden = true;
      adScopeRef.current?.release();
      serviceRef.current?.destroy();
      serviceRef.current = null;
      adContainerRef.current?.querySelectorAll("iframe").forEach((frame) => frame.remove());
    };
    scope.signal.addEventListener("abort", revoke, { once: true });
    void fetchVideoAdDecision(props.videoId, scope.signal)
      .then((result) => {
        if (!scope.isCurrent()) return;
        const enabledDecision = result.enabled ? result : null;
        setDecisionState({ consent, decision: enabledDecision });
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
        if (scope.isCurrent()) setDecisionState({ consent, decision: null });
      });
    return () => scope.release();
  }, [consent, props.videoId]);

  const handleAdContainerReady = useCallback((element: HTMLDivElement | null) => {
    adContainerRef.current = element;
    contentVideoRef.current = element?.parentElement?.querySelector("video") ?? null;
    setTargetsReady(Boolean(adContainerRef.current && contentVideoRef.current));
  }, []);

  useEffect(() => {
    const video = contentVideoRef.current;
    if (!video) return;
    // A rejected play() also happens for failed sources, not just gesture policy.
    // Let the player's error banner explain those failures without a covering CTA.
    // Reading the current error preserves HLS-to-MP4 recovery, whose load() clears it.
    const syncMediaFailure = () => setMediaFailed(Boolean(video.error));
    syncMediaFailure();
    video.addEventListener("error", syncMediaFailure);
    video.addEventListener("loadstart", syncMediaFailure);
    video.addEventListener("canplay", syncMediaFailure);
    return () => {
      video.removeEventListener("error", syncMediaFailure);
      video.removeEventListener("loadstart", syncMediaFailure);
      video.removeEventListener("canplay", syncMediaFailure);
    };
  }, [playbackIdentity, targetsReady]);

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
      const scope = createAdvertisingConsentScope(consent);
      if (!scope.isCurrent()) {
        scope.release();
        return false;
      }
      adScopeRef.current = scope;
      lifecycle.busy = true;
      const service = serviceRef.current ?? new GoogleImaVideoAdService();
      serviceRef.current = service;
      let contentPausedForAd = false;
      const cancelAd = () => {
        adContainer.hidden = true;
        service.destroy();
        adContainer.querySelectorAll("iframe").forEach((frame) => frame.remove());
        if (serviceRef.current === service) serviceRef.current = null;
        if (!lifecycle.active) return;
        setAdActive(false);
        setStatus(null);
        if (contentPausedForAd && slot !== "POST_ROLL") void attemptContentPlayback();
      };
      scope.signal.addEventListener("abort", cancelAd, { once: true });
      try {
        adContainer.hidden = false;
        await service.initialize(adContainer, contentVideo, scope.signal);
        if (!lifecycle.active || !scope.isCurrent()) return false;
        setAdActive(true);
        setStatus("player.advertisement");
        contentVideo.pause();
        contentPausedForAd = true;
        await service.play(
          slot,
          decision.tagUrl,
          {
            onEvent: (type, errorCode) => {
              if (lifecycle.active && scope.isCurrent()) emit(slot, type, errorCode);
            },
            onContentPause: () => {
              if (!lifecycle.active || !scope.isCurrent()) return;
              contentVideo.pause();
              setAdActive(true);
            },
            onContentResume: () => {
              if (!lifecycle.active || !scope.isCurrent()) return;
              setAdActive(false);
              setStatus(null);
              if (slot !== "POST_ROLL") void attemptContentPlayback();
            },
          },
          playbackIntent,
          scope.snapshot,
          scope.signal,
        );
        return true;
      } catch {
        if (!lifecycle.active || !scope.isCurrent()) return false;
        emit(slot, "ERROR", "IMA_PLAYBACK_EXCEPTION");
        setAdActive(false);
        setStatus(null);
        return false;
      } finally {
        scope.signal.removeEventListener("abort", cancelAd);
        scope.release();
        if (adScopeRef.current === scope) {
          adScopeRef.current = null;
          lifecycle.busy = false;
        }
      }
    },
    [attemptContentPlayback, consent, decision, emit],
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
    !mediaFailed &&
    (autoplayBlocked || (adEligible && !activated && (props.autoPlay !== true || gestureGate)));

  return (
    <div className={styles.wrap}>
      <AyinPlayer
        {...props}
        autoPlay={false}
        adMode={{
          active: adActive,
          controlsLocked: adActive,
          label: translatePlayer(locale, status ?? "player.advertisement"),
        }}
        onAdContainerReady={handleAdContainerReady}
        onPlaybackReady={handlePlaybackReady}
      />
      {showStart ? (
        <button
          aria-label={translatePlayer(locale, "player.playVideo")}
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
            {translatePlayer(
              locale,
              !playbackReady
                ? "player.preparingVideo"
                : autoplayBlocked
                  ? "player.tapToPlay"
                  : "player.playVideo",
            )}
          </span>
        </button>
      ) : null}
    </div>
  );
}
