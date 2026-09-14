"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import { createPlayerAnalytics, trackAnalyticsEvent } from "@/lib/analytics";

import { AdEnabledAyinPlayer } from "./ad-enabled-ayin-player";
import type { AyinPlayerProps } from "./ayin-player";

export function AnalyticsAyinPlayer(props: AyinPlayerProps) {
  const analytics = useMemo(() => createPlayerAnalytics(props.profileId), [props.profileId]);
  const startupStartedAt = useRef<number>(0);
  const startupReportedFor = useRef<string | null>(null);

  useEffect(() => {
    startupStartedAt.current = performance.now();
    startupReportedFor.current = null;
    trackAnalyticsEvent("CONTENT_IMPRESSION", { videoId: props.videoId });
  }, [props.videoId]);

  const onPlaybackReady = useCallback(() => {
    if (startupReportedFor.current !== props.videoId) {
      startupReportedFor.current = props.videoId;
      analytics.emit({
        type: "startup",
        videoId: props.videoId,
        durationMs: Math.max(0, performance.now() - startupStartedAt.current),
      });
    }
    props.onPlaybackReady?.();
  }, [analytics, props]);

  return <AdEnabledAyinPlayer {...props} analytics={analytics} onPlaybackReady={onPlaybackReady} />;
}
