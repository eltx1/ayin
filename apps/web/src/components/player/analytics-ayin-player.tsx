"use client";

import { useEffect, useMemo } from "react";

import { createPlayerAnalytics, trackAnalyticsEvent } from "@/lib/analytics";

import { AdEnabledAyinPlayer } from "./ad-enabled-ayin-player";
import type { AyinPlayerProps } from "./ayin-player";

export function AnalyticsAyinPlayer(props: AyinPlayerProps) {
  const analytics = useMemo(() => createPlayerAnalytics(props.profileId), [props.profileId]);
  useEffect(() => {
    trackAnalyticsEvent("CONTENT_IMPRESSION", { videoId: props.videoId });
  }, [props.videoId]);
  return <AdEnabledAyinPlayer {...props} analytics={analytics} />;
}
