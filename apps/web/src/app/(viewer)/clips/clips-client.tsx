"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { ActionButton } from "@/components/ui/design-system";
import { useViewerProduct } from "@/components/viewer/viewer-product-context";
import { EmptyState, ErrorState } from "@/components/viewer/view-states";
import { releaseHtmlMediaElement } from "@/lib/adaptive-playback";
import {
  captureClipPlaybackPosition,
  mergeClipItems,
  type ClipsPage,
  type RegisterClipPositionAuthority,
} from "@/lib/clips";
import { ClipsReadError, readClips } from "@/lib/clips-request";
import { translateClips } from "@/lib/i18n/clips";

import { ClipsFeed, type ClipsPosition } from "./clips-feed";

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
  const root = useRef<HTMLDivElement>(null);
  // Concealment runs before audience listeners and makes DOM scrollTop read 0.
  // Retain the offset while this feed is visible and its audience is current.
  const feedScrollTop = useRef(0);
  const onFeedScroll = useCallback((scrollTop: number) => {
    feedScrollTop.current = Math.max(0, scrollTop);
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
  const retention = useRef<{
    owner: string;
    cursors: string[];
    isKids: boolean;
    position?: ClipsPosition;
  } | null>(null);
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
            const playback: ClipsPosition["playback"] = {};
            node.querySelectorAll<HTMLVideoElement>("video").forEach((video) => {
              const id = video.closest<HTMLElement>("[data-video-id]")?.dataset.videoId;
              if (id)
                playback[id] = captureClipPlaybackPosition(
                  video,
                  positionAuthority.current.get(id)?.() === true,
                  retention.current?.position?.playback[id]?.positionMs,
                );
            });
            retention.current.position = {
              scrollTop: feedScrollTop.current,
              impressedIds: [
                ...node.querySelectorAll<HTMLElement>("[data-clip-impressed='true']"),
              ].flatMap((article) => (article.dataset.videoId ? [article.dataset.videoId] : [])),
              activeId:
                node.querySelector<HTMLElement>("[data-clip-active='true']")?.dataset.videoId ??
                null,
              playback,
            };
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
    if (current && !current.cursors.includes(cursor)) current.cursors.push(cursor);
  }, []);
  const retry = useCallback(() => {
    revalidationAttempted.current = false;
    retryNavigation();
  }, [retryNavigation]);

  useEffect(() => {
    if (audienceStatus !== "ready" || !isAudienceCurrent()) return;
    const retained = retention.current?.owner === owner ? retention.current : null;
    if (!retained) retention.current = null;
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
          if (page.nextCursor !== cursor) break;
          const next = await readClips(cursor, audience, run.signal);
          if (!next.enabled || next.viewer.isKids !== page.viewer.isKids)
            throw new ClipsReadError(409);
          page = { ...next, items: mergeClipItems(page.items, next.items) };
          cursors.push(cursor);
        }
      }
      if (disposed || run.signal.aborted || !isAudienceCurrent()) return;
      revalidationAttempted.current = false;
      retention.current = {
        owner,
        cursors,
        isKids: page.viewer.isKids,
        ...(sameAudience && retained.position ? { position: retained.position } : {}),
      };
      setRead({ key, page, position: sameAudience ? retained.position : undefined });
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
      />
    </div>
  );
}
