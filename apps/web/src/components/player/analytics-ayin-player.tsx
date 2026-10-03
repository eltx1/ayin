"use client";

import { useEffect, useMemo } from "react";

import { createPlayerAnalytics, trackAnalyticsEvent } from "@/lib/analytics";

import { AyinPlayer } from "./ayin-player";
import { AdEnabledAyinPlayer } from "./ad-enabled-ayin-player";
import type { AyinPlayerProps } from "./ayin-player";

export function AnalyticsAyinPlayer({
  advertisingEnabled = true,
  ...props
}: AyinPlayerProps & { advertisingEnabled?: boolean }) {
  const { profileId, videoId } = props;
  const analytics = useMemo(() => createPlayerAnalytics(profileId), [profileId]);

  useEffect(() => {
    trackAnalyticsEvent("CONTENT_IMPRESSION", { videoId });
  }, [videoId]);

  return advertisingEnabled ? (
    <AdEnabledAyinPlayer {...props} analytics={analytics} />
  ) : (
    <AyinPlayer {...props} analytics={analytics} />
  );
}
