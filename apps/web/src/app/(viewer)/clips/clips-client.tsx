"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { ActionButton } from "@/components/ui/design-system";
import { useViewerProduct } from "@/components/viewer/viewer-product-context";
import { EmptyState, ErrorState } from "@/components/viewer/view-states";
import { releaseHtmlMediaElement } from "@/lib/adaptive-playback";
import {
  captureClipPlaybackPosition,
  CLIPS_SESSION_LIMIT,
  mergeClipItems,
  type ClipsPage,
  type RegisterClipPositionAuthority,
} from "@/lib/clips";
import { ClipsReadError, readClips } from "@/lib/clips-request";
import { translateClips } from "@/lib/i18n/clips";

import { ClipsFeed, type ClipsPosition } from "./clips-feed";

interface RetainedClipsSession {
  owner: string;
  cursors: string[];
  isKids: boolean;
  position?: ClipsPosition;
}

// A single bounded in-memory return capsule. Nothing enters history URLs,
// browser storage or the service worker. Every return revalidates the audience
// and all retained pages before this position can be applied.
let routeReturn: RetainedClipsSession | null = null;

export function ClipsClient() {
  const { locale, t } = useI18n();
  const text = (key: Parameters<typeof translateClips>[1]) => translateClips(locale, key);
  const {
    identity,
    identityRevision,
    audienceStatus,
    isAudienceCurrent,
    onAudienceInvalidated,
    retryNavigation,
  } = useViewerProduct();
  const owner = JSON.stringify([identity?.account.id, identity?.profile.id]);
  const key = JSON.stringify([identityRevision, locale]);
  // An optional Watch capability endpoint must not create an automatic
  // identity-revalidation loop across keyed feed remounts.
  const [capabilityBlockedOwner, setCapabilityBlockedOwner] = useState<string | null>(null);
  const onCapabilityIdentityInvalid = useCallback(() => {
    setCapabilityBlockedOwner(owner);
    // Existing provider invalidation conceals old UI and releases media now.
    retryNavigation();
  }, [owner, retryNavigation]);
  const retryCapabilities = useCallback(() => setCapabilityBlockedOwner(null), []);
  const root = useRef<HTMLDivElement>(null);
  // Concealment runs before audience listeners and makes DOM scrollTop read 0.
  // Retain the offset while this feed is visible and its audience is current.
  const feedScrollTop = useRef(0);
  const onFeedScroll = useCallback((scrollTop: number) => {
    feedScrollTop.current = Math.max(0, scrollTop);
  }, []);
  const feedSnapshot = useRef<(() => ClipsPosition) | null>(null);
  const registerSnapshot = useCallback((read: () => ClipsPosition) => {
    feedSnapshot.current = read;
    return () => {
      if (feedSnapshot.current === read) feedSnapshot.current = null;
    };
  }, []);
  const positionAuthority = useRef(new Map<string, () => boolean>());
  const registerPositionAuthority = useCallback<RegisterClipPositionAuthority>((videoId, check) => {
    positionAuthority.current.set(videoId, check);
    return () => {
      if (positionAuthority.current.get(videoId) === check)
        positionAuthority.current.delete(videoId);
    };
  }, []);
  const controller = useRef<AbortController | null>(null);
  const revalidationAttempted = useRef(false);
  const retention = useRef<RetainedClipsSession | null>(routeReturn);
  const [read, setRead] = useState<{
    key: string;
    page: ClipsPage | null;
    position?: ClipsPosition | undefined;
  } | null>(null);

  useLayoutEffect(
    () =>
      onAudienceInvalidated(() => {
        const node = root.current;
        if (node) {
          node.hidden = true;
          if (retention.current?.owner === owner) {
            const retainedSnapshot = feedSnapshot.current?.();
            const playback: ClipsPosition["playback"] = {
              ...retention.current.position?.playback,
              ...retainedSnapshot?.playback,
            };
            node.querySelectorAll<HTMLVideoElement>("video").forEach((video) => {
              const id = video.closest<HTMLElement>("[data-video-id]")?.dataset.videoId;
              if (id)
                playback[id] = captureClipPlaybackPosition(
                  video,
                  positionAuthority.current.get(id)?.() === true,
                  playback[id]?.positionMs,
                );
            });
            retention.current.position = {
              scrollTop: feedScrollTop.current,
              impressedIds:
                retainedSnapshot?.impressedIds ??
                [...node.querySelectorAll<HTMLElement>("[data-clip-impressed='true']")].flatMap(
                  (article) => (article.dataset.videoId ? [article.dataset.videoId] : []),
                ),
              activeId:
                retainedSnapshot?.activeId ??
                node.querySelector<HTMLElement>("[data-clip-active='true']")?.dataset.videoId ??
                null,
              playback,
              dataSaving:
                retainedSnapshot?.dataSaving ?? retention.current.position?.dataSaving ?? false,
            };
            routeReturn = retention.current;
          }
          // No old source survives the synchronous audience boundary, even if
          // React has not committed its neutral shell yet.
          node
            .querySelectorAll("video,audio")
            .forEach((media) => releaseHtmlMediaElement(media as HTMLMediaElement));
        }
        controller.current?.abort();
      }),
    [onAudienceInvalidated, owner],
  );

  const onPageLoaded = useCallback((cursor: string) => {
    const current = retention.current;
    if (
      current &&
      current.cursors.length < CLIPS_SESSION_LIMIT &&
      !current.cursors.includes(cursor)
    )
      current.cursors.push(cursor);
  }, []);
  const retry = useCallback(() => {
    revalidationAttempted.current = false;
    retryNavigation();
  }, [retryNavigation]);

  useEffect(() => {
    if (audienceStatus !== "ready" || !isAudienceCurrent()) return;
    const retained = retention.current?.owner === owner ? retention.current : null;
    if (!retained) {
      retention.current = null;
      routeReturn = null;
    }
    const run = new AbortController();
    controller.current = run;
    let disposed = false;
    const deadline = window.setTimeout(() => run.abort(), 15000);
    void (async () => {
      const audience = { identity, isCurrent: isAudienceCurrent };
      let page = await readClips(undefined, audience, run.signal);
      const sameAudience = retained && page.viewer.isKids === retained.isKids;
      const cursors: string[] = [];
      // Revalidate every previously loaded page before restoring pagination.
      // Changed ordering/eligibility stops restoration at the last fresh page.
      if (sameAudience && page.enabled) {
        for (const cursor of retained.cursors) {
          if (page.nextCursor !== cursor || page.items.length >= CLIPS_SESSION_LIMIT) break;
          const next = await readClips(cursor, audience, run.signal);
          if (!next.enabled || next.viewer.isKids !== page.viewer.isKids)
            throw new ClipsReadError(409);
          page = {
            ...next,
            items: mergeClipItems(page.items, next.items).slice(0, CLIPS_SESSION_LIMIT),
          };
          cursors.push(cursor);
        }
      }
      if (disposed || run.signal.aborted || !isAudienceCurrent()) return;
      revalidationAttempted.current = false;
      const eligibleIds = new Set(page.items.map((item) => item.id));
      const restoredPosition =
        sameAudience && retained.position
          ? {
              ...retained.position,
              impressedIds: retained.position.impressedIds.filter((id) => eligibleIds.has(id)),
              playback: Object.fromEntries(
                Object.entries(retained.position.playback).filter(([id]) => eligibleIds.has(id)),
              ),
            }
          : undefined;
      retention.current = {
        owner,
        cursors,
        isKids: page.viewer.isKids,
        ...(restoredPosition ? { position: restoredPosition } : {}),
      };
      routeReturn = retention.current;
      setRead({ key, page, position: restoredPosition });
    })()
      .catch((error: unknown) => {
        if (disposed || !isAudienceCurrent()) return;
        setRead({ key, page: null });
        const status = error instanceof ClipsReadError ? error.status : 0;
        if (
          (status === 409 || (status === 401 && identity !== null)) &&
          !revalidationAttempted.current
        ) {
          revalidationAttempted.current = true;
          retryNavigation();
        }
      })
      .finally(() => window.clearTimeout(deadline));
    return () => {
      disposed = true;
      run.abort();
      window.clearTimeout(deadline);
      if (controller.current === run) controller.current = null;
    };
  }, [audienceStatus, identity, isAudienceCurrent, key, owner, retryNavigation]);

  useLayoutEffect(
    () => () => {
      const retained = retention.current;
      if (retained?.owner === owner) {
        const position = isAudienceCurrent() ? feedSnapshot.current?.() : undefined;
        if (position) retained.position = position;
        routeReturn = retained;
      }
    },
    [owner, isAudienceCurrent],
  );

  const startFresh = useCallback(() => {
    retention.current = null;
    routeReturn = null;
    feedScrollTop.current = 0;
    retry();
  }, [retry]);

  const current = read?.key === key && isAudienceCurrent() ? read : null;
  if (audienceStatus === "error" || (current && !current.page))
    return (
      <ErrorState
        title={text("clips.loadErrorTitle")}
        description={text("clips.loadErrorDescription")}
        action={<ActionButton onClick={retry}>{text("clips.retry")}</ActionButton>}
      />
    );
  if (!current?.page) return <p role="status">{t("common.loading")}</p>;
  if (!current.page.enabled)
    return (
      <EmptyState
        title={text("clips.disabledTitle")}
        description={text("clips.disabledDescription")}
      />
    );
  if (!current.page.items.length && !current.page.nextCursor)
    return (
      <EmptyState title={text("clips.emptyTitle")} description={text("clips.emptyDescription")} />
    );
  return (
    <div ref={root} key={key} data-private-viewer-state>
      <ClipsFeed
        initialPage={current.page}
        initialPosition={current.position}
        onPageLoaded={onPageLoaded}
        onFeedScroll={onFeedScroll}
        registerPositionAuthority={registerPositionAuthority}
        registerSnapshot={registerSnapshot}
        onStartFresh={startFresh}
        capabilityBlocked={capabilityBlockedOwner === owner}
        onCapabilityIdentityInvalid={onCapabilityIdentityInvalid}
        onRetryCapabilities={retryCapabilities}
      />
    </div>
  );
}
