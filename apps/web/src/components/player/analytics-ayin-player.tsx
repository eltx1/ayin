"use client";

import { useEffect, useMemo } from "react";

import { createPlayerAnalytics, trackAnalyticsEvent } from "@/lib/analytics";

import { AdEnabledAyinPlayer } from "./ad-enabled-ayin-player";
import type { AyinPlayerProps } from "./ayin-player";

export function AnalyticsAyinPlayer(props: AyinPlayerProps) {
  const { profileId, videoId } = props;
  const analytics = useMemo(() => createPlayerAnalytics(profileId), [profileId]);

  useEffect(() => {
    trackAnalyticsEvent("CONTENT_IMPRESSION", { videoId });
  }, [videoId]);

  return <AdEnabledAyinPlayer {...props} analytics={analytics} />;
}
