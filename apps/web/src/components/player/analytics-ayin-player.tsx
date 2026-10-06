"use client";

import { useEffect, useMemo } from "react";

import { useViewerProduct } from "@/components/viewer/viewer-product-context";
import { createPlayerAnalytics, trackAnalyticsEvent } from "@/lib/analytics";

import { AyinPlayer } from "./ayin-player";
import { AdEnabledAyinPlayer } from "./ad-enabled-ayin-player";
import type { AyinPlayerProps } from "./ayin-player";

export function AnalyticsAyinPlayer({
  advertisingEnabled = true,
  ...props
}: AyinPlayerProps & { advertisingEnabled?: boolean }) {
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
  const analytics = useMemo(() => createPlayerAnalytics(props.profileId), [props.profileId]);

  useEffect(() => {
    trackAnalyticsEvent("CONTENT_IMPRESSION", { videoId });
  }, [videoId]);

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
