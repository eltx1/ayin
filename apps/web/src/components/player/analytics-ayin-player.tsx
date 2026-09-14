"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import { createPlayerAnalytics, trackAnalyticsEvent } from "@/lib/analytics";

import { AdEnabledAyinPlayer } from "./ad-enabled-ayin-player";
import type { AyinPlayerProps } from "./ayin-player";

function monotonicNow() {
  return typeof performance === "undefined" ? 0 : performance.now();
}

export function AnalyticsAyinPlayer(props: AyinPlayerProps) {
  const { onPlaybackReady: forwardPlaybackReady, profileId, videoId } = props;
  const analytics = useMemo(() => createPlayerAnalytics(profileId), [profileId]);
  const startupTiming = useRef<{ videoId: string; startedAt: number } | null>(null);
  const startupReportedFor = useRef<string | null>(null);

  if (startupTiming.current?.videoId !== videoId) {
    startupTiming.current = { videoId, startedAt: monotonicNow() };
    startupReportedFor.current = null;
  }

  useEffect(() => {
    trackAnalyticsEvent("CONTENT_IMPRESSION", { videoId });
  }, [videoId]);

  const onPlaybackReady = useCallback(() => {
    const timing = startupTiming.current;
    if (startupReportedFor.current !== videoId && timing?.videoId === videoId) {
      startupReportedFor.current = videoId;
      analytics.emit({
        type: "startup",
        videoId,
        durationMs: Math.max(0, monotonicNow() - timing.startedAt),
      });
    }
    forwardPlaybackReady?.();
  }, [analytics, forwardPlaybackReady, videoId]);

  return <AdEnabledAyinPlayer {...props} analytics={analytics} onPlaybackReady={onPlaybackReady} />;
}
