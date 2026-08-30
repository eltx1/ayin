"use client";

import { useMemo } from "react";

import { createPlayerAnalytics } from "@/lib/analytics";

import { AdEnabledAyinPlayer } from "./ad-enabled-ayin-player";
import type { AyinPlayerProps } from "./ayin-player";

export function AnalyticsAyinPlayer(props: AyinPlayerProps) {
  const analytics = useMemo(() => createPlayerAnalytics(props.profileId), [props.profileId]);
  return <AdEnabledAyinPlayer {...props} analytics={analytics} />;
}
