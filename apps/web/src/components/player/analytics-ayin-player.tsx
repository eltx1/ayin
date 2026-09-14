"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { createPlayerAnalytics, trackAnalyticsEvent } from "@/lib/analytics";

import { AdEnabledAyinPlayer } from "./ad-enabled-ayin-player";
import type { AyinPlayerProps } from "./ayin-player";

export function AnalyticsAyinPlayer(props: AyinPlayerProps) {
  const { onPlaybackReady: forwardPlaybackReady, profileId, videoId } = props;
  const analytics = useMemo(() => createPlayerAnalytics(profileId), [profileId]);
  const startupStartedAt = useRef(0);
  const startupReportedFor = useRef<string | null>(null);

  useLayoutEffect(() => {
    startupStartedAt.current = performance.now();
    startupReportedFor.current = null;
  }, [videoId]);

  useEffect(() => {
    trackAnalyticsEvent("CONTENT_IMPRESSION", { videoId });
  }, [videoId]);

  const onPlaybackReady = useCallback(() => {
    if (startupReportedFor.current !== videoId) {
      startupReportedFor.current = videoId;
      analytics.emit({
        type: "startup",
        videoId,
        durationMs: Math.max(0, performance.now() - startupStartedAt.current),
      });
    }
    forwardPlaybackReady?.();
  }, [analytics, forwardPlaybackReady, videoId]);

  return <AdEnabledAyinPlayer {...props} analytics={analytics} onPlaybackReady={onPlaybackReady} />;
}
