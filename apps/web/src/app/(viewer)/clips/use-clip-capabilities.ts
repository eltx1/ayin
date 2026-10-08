"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { useViewerProduct } from "@/components/viewer/viewer-product-context";
import type { AyinCaptionTrack } from "@/lib/ayin-player";
import { mediaAssetUrl } from "@/lib/channel";
import { isClipCursor, type ClipItem } from "@/lib/clips";
import { PlaybackReadError, readPlayback } from "@/lib/playback-request";
import type { SearchAudience } from "@/lib/search-request";

export interface ClipCapabilities {
  captions: AyinCaptionTrack[];
  commentsEnabled: boolean;
}

interface ClipCapabilityTarget {
  id: string;
  slug: string;
  sourceObjectKey: string;
  locale: "en" | "ar";
  expectedKids: boolean;
}

const emptyCapabilities: ClipCapabilities = { captions: [], commentsEnabled: false };

function objectKey(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1024 &&
    !/[\\\u0000-\u001f\u007f]/.test(value) &&
    value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

// This only enriches an already eligible, selected feed item. Watch's detail
// contract does not expose VideoForm and cannot establish Clip membership.
export async function readClipCapabilities(
  target: ClipCapabilityTarget,
  audience: SearchAudience,
  signal: AbortSignal,
): Promise<ClipCapabilities> {
  signal.throwIfAborted();
  if (
    !audience.isCurrent() ||
    !isClipCursor(target.id) ||
    !target.slug ||
    !objectKey(target.sourceObjectKey)
  )
    throw new PlaybackReadError(409);

  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const deadline = setTimeout(() => controller.abort(), 15_000);
  try {
    const data = await readPlayback(
      {
        slug: target.slug,
        locale: target.locale,
        explicitKids: target.expectedKids,
      },
      audience,
      controller.signal,
    );
    controller.signal.throwIfAborted();
    signal.throwIfAborted();
    if (
      !audience.isCurrent() ||
      data.video.id !== target.id ||
      data.video.slug !== target.slug ||
      data.video.source.objectKey !== target.sourceObjectKey ||
      data.video.source.mimeType !== "video/mp4" ||
      (target.expectedKids && data.detail.commentsSlot.enabled)
    )
      throw new PlaybackReadError(409);
    // The same profile can become Kids before this request starts. A verified
    // narrower audience is policy evidence, not an optional caption failure.
    // Retire the old feed through the existing bounded Viewer boundary.
    if (data.viewer.isKids !== target.expectedKids) throw new PlaybackReadError(409, true);

    // Keep track/option DOM bounded even if a valid catalog grows many tracks.
    // The unavailable state offers a truthful retry/Watch fallback, not a
    // silently truncated language list.
    if (data.video.captions.length > 32) throw new PlaybackReadError(0);
    const ids = new Set<string>();
    const captions = data.video.captions.map((track): AyinCaptionTrack => {
      if (
        !isClipCursor(track.id) ||
        ids.has(track.id) ||
        !objectKey(track.objectKey) ||
        track.mimeType !== "text/vtt" ||
        typeof track.default !== "boolean" ||
        track.label.length > 80 ||
        track.language.length > 35
      )
        throw new PlaybackReadError(0);
      try {
        if (Intl.getCanonicalLocales(track.language).length !== 1) throw new Error();
      } catch {
        throw new PlaybackReadError(0);
      }
      const src = mediaAssetUrl(track.objectKey);
      if (!src) throw new PlaybackReadError(0);
      ids.add(track.id);
      return {
        id: track.id,
        src,
        label: track.label,
        language: track.language,
        kind: track.kind,
        default: track.default,
      };
    });
    return { captions, commentsEnabled: !target.expectedKids && data.detail.commentsSlot.enabled };
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", abort);
  }
}

// Call once for the selected Clip, not for every resident/loaded feed article.
// The Viewer provider conceals the owning data-private-viewer-state root before
// invoking invalidation listeners. This hook synchronously revokes its lease;
// the feed/player boundary remains responsible for detaching native sources.
export function useClipCapabilities(
  activeClip: ClipItem | null,
  expectedKids: boolean,
  onIdentityInvalid: () => void,
) {
  const { locale } = useI18n();
  const {
    identity,
    identityRevision,
    audienceStatus,
    isAudienceCurrent,
    onAudienceInvalidated,
    retryNavigation,
  } = useViewerProduct();
  const [attempt, setAttempt] = useState(0);
  const id = activeClip?.id;
  const slug = activeClip?.slug;
  const sourceObjectKey = activeClip?.mediaAssets.find(
    (asset) => asset.kind === "SOURCE_VIDEO",
  )?.r2ObjectKey;
  const scope = useMemo(
    () => ({
      id,
      slug,
      sourceObjectKey,
      locale,
      expectedKids,
      identityRevision,
      identity,
      isAudienceCurrent,
      attempt,
    }),
    [
      id,
      slug,
      sourceObjectKey,
      locale,
      expectedKids,
      identityRevision,
      identity,
      isAudienceCurrent,
      attempt,
    ],
  );
  const runRef = useRef<{
    scope: typeof scope;
    controller: AbortController;
    isCurrent: () => boolean;
  } | null>(null);
  const [result, setResult] = useState<{
    scope: typeof scope;
    signal: AbortSignal;
    capabilities: ClipCapabilities | null;
  } | null>(null);

  useLayoutEffect(() => {
    if (!scope.id || !scope.slug || !scope.sourceObjectKey || audienceStatus !== "ready") return;
    const controller = new AbortController();
    const run = {
      scope,
      controller,
      isCurrent: () => runRef.current === run && !controller.signal.aborted && isAudienceCurrent(),
    };
    runRef.current = run;
    const revoke = () => controller.abort();
    const removeInvalidation = onAudienceInvalidated(revoke);
    if (run.isCurrent()) {
      void readClipCapabilities(
        {
          id: scope.id,
          slug: scope.slug,
          sourceObjectKey: scope.sourceObjectKey,
          locale: scope.locale,
          expectedKids: scope.expectedKids,
        },
        { identity, isCurrent: run.isCurrent },
        controller.signal,
      )
        .then((capabilities) => {
          if (run.isCurrent()) setResult({ scope, signal: controller.signal, capabilities });
        })
        .catch((error: unknown) => {
          if (!run.isCurrent()) return;
          if (error instanceof PlaybackReadError && error.identityInvalid) {
            revoke();
            // The parent owns bounded revalidation above the keyed feed. It
            // conceals/releases through the existing Viewer boundary.
            onIdentityInvalid();
          } else setResult({ scope, signal: controller.signal, capabilities: null });
        });
    }
    return () => {
      revoke();
      removeInvalidation();
      if (runRef.current === run) runRef.current = null;
    };
  }, [
    scope,
    audienceStatus,
    identity,
    isAudienceCurrent,
    onAudienceInvalidated,
    onIdentityInvalid,
  ]);

  const isCurrent = useCallback(
    () => runRef.current?.scope === scope && runRef.current.isCurrent(),
    [scope],
  );
  const retry = useCallback(() => {
    runRef.current?.controller.abort();
    if (audienceStatus !== "ready" || !isAudienceCurrent()) retryNavigation();
    setAttempt((value) => value + 1);
  }, [audienceStatus, isAudienceCurrent, retryNavigation]);
  const current =
    result?.scope === scope && !result.signal.aborted && isAudienceCurrent() ? result : null;
  const status = !activeClip
    ? ("idle" as const)
    : !id ||
        !slug ||
        !sourceObjectKey ||
        audienceStatus === "error" ||
        (current && !current.capabilities)
      ? ("unavailable" as const)
      : current?.capabilities
        ? ("ready" as const)
        : ("loading" as const);
  return { ...(current?.capabilities ?? emptyCapabilities), status, retry, isCurrent };
}
