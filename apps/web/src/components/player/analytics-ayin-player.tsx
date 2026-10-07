"use client";

import { useEffect, useMemo } from "react";

import { useViewerProduct } from "@/components/viewer/viewer-product-context";
import { createPlayerAnalytics, trackAnalyticsEvent } from "@/lib/analytics";
import type { AyinPlayerAnalytics } from "@/lib/ayin-player";
import type { VideoAdSlot } from "@/lib/video-ads";

import { AyinPlayer } from "./ayin-player";
import { AdEnabledAyinPlayer } from "./ad-enabled-ayin-player";
import type { AyinPlayerProps } from "./ayin-player";

export interface PlayerAnalyticsSession {
  analytics: AyinPlayerAnalytics;
  recordImpression: () => void;
  completedAdBreaks: Set<VideoAdSlot>;
}

// Accounting only: this never retains a playable source or an audience lease.
export function createPlayerAnalyticsSession(videoId: string): PlayerAnalyticsSession {
  let impressed = false;
  return {
    analytics: createPlayerAnalytics(),
    completedAdBreaks: new Set<VideoAdSlot>(),
    recordImpression: () => {
      if (impressed) return;
      impressed = true;
      trackAnalyticsEvent("CONTENT_IMPRESSION", { videoId });
    },
  };
}

export function AnalyticsAyinPlayer({
  advertisingEnabled = true,
  analytics: suppliedAnalytics,
  onContentImpression,
  ...props
}: AyinPlayerProps & {
  advertisingEnabled?: boolean;
  onContentImpression?: (() => void) | undefined;
}) {
  const {
    identity,
    identityRevision,
    isIdentityCurrent,
    onBeforeIdentitySuspend,
    retryNavigation,
  } = useViewerProduct();
  const { videoId } = props;
  const profileId = identity ? (props.profileId ?? identity.profile.id) : undefined;
  const progressIdentity =
    identity && profileId
      ? {
          accountId: identity.account.id,
          profileId,
          revision: identityRevision,
          isCurrent: isIdentityCurrent,
          onBeforeSuspend: onBeforeIdentitySuspend,
        }
      : null;
  const analytics = useMemo(
    () => suppliedAnalytics ?? createPlayerAnalytics(props.profileId),
    [props.profileId, suppliedAnalytics],
  );

  useEffect(() => {
    if (onContentImpression) onContentImpression();
    else trackAnalyticsEvent("CONTENT_IMPRESSION", { videoId });
  }, [onContentImpression, videoId]);

  return advertisingEnabled ? (
    <AdEnabledAyinPlayer
      {...props}
      profileId={profileId}
      progressIdentity={progressIdentity}
      onProgressIdentityInvalid={retryNavigation}
      analytics={analytics}
    />
  ) : (
    <AyinPlayer
      {...props}
      profileId={profileId}
      progressIdentity={progressIdentity}
      onProgressIdentityInvalid={retryNavigation}
      analytics={analytics}
    />
  );
}
