"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { ActionButton, StatusNotice } from "@/components/ui/design-system";
import { useViewerProduct } from "@/components/viewer/viewer-product-context";
import { EmptyState } from "@/components/viewer/view-states";
import { AccountScopeError, requestAccountScope } from "@/lib/account-scope";
import { trackAnalyticsEvent } from "@/lib/analytics";
import { mediaAssetUrl } from "@/lib/channel";
import {
  createClipsAutoplayGate,
  mergeClipItems,
  type ClipItem,
  type ClipPlaybackPosition,
  type RegisterClipPositionAuthority,
  type ClipsPage,
} from "@/lib/clips";
import { ClipsReadError, readClips } from "@/lib/clips-request";
import { translateClips } from "@/lib/i18n/clips";
import {
  parseChannelSocialState,
  parseReactionMutation,
  parseSubscriptionMutation,
  parseVideoSocialState,
  type ChannelSocialState,
  type VideoSocialState,
} from "@/lib/social-action-contracts";

import styles from "./clips.module.css";
import { ClipVideo } from "./clip-video";

type ActionMode = "loading" | "ready" | "signedOut" | "error" | "uncertain";

interface ActionSnapshot {
  mode: ActionMode;
  video: VideoSocialState;
  channel: ChannelSocialState;
}

function initialActions(clip: ClipItem): ActionSnapshot {
  return {
    mode: "loading",
    video: {
      reaction: null,
      likeCount: clip._count.reactions,
      watchLater: false,
      myList: false,
    },
    channel: { subscribed: false, subscriberCount: 0 },
  };
}

function ClipActions({ clip }: { clip: ClipItem }) {
  const router = useRouter();
  const { locale, href, formatNumber } = useI18n();
  const t = useCallback(
    (key: Parameters<typeof translateClips>[1], values = {}) => translateClips(locale, key, values),
    [locale],
  );
  const {
    identity,
    identityRevision,
    isIdentityCurrent,
    audienceStatus,
    isAudienceCurrent,
    onBeforeIdentitySuspend,
    retryNavigation,
  } = useViewerProduct();
  const root = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const accountId = identity?.account.id;
  const profileId = identity?.profile.id;
  // This component owns only its request lifetime. The existing viewer provider
  // is the sole owner of identity, suspension and revalidation.
  const scope = useMemo(
    () => ({
      accountId,
      profileId,
      videoId: clip.id,
      channelId: clip.channel.id,
      identityRevision,
      attempt,
      isCurrent: isIdentityCurrent,
      audienceStatus,
      isAudienceCurrent,
    }),
    [
      accountId,
      profileId,
      clip,
      identityRevision,
      isIdentityCurrent,
      audienceStatus,
      isAudienceCurrent,
      attempt,
    ],
  );
  const runRef = useRef<{
    scope: typeof scope;
    controller: AbortController;
    pending: boolean;
  } | null>(null);
  const [result, setResult] = useState<{ scope: typeof scope; snapshot: ActionSnapshot } | null>(
    null,
  );
  const [operation, setOperation] = useState<{
    scope: typeof scope;
    action: "like" | "subscribe";
  } | null>(null);
  const snapshot =
    result?.scope === scope && scope.isCurrent()
      ? result.snapshot
      : {
          ...initialActions(clip),
          // A null identity while its read is pending is not proof of sign-out.
          // Keep actions inert through hydration, suspension and failed checks.
          mode:
            audienceStatus === "error"
              ? ("error" as const)
              : !accountId && audienceStatus === "ready" && isAudienceCurrent()
                ? ("signedOut" as const)
                : ("loading" as const),
        };
  const pending = operation?.scope === scope ? operation.action : null;

  useLayoutEffect(() => {
    // A development Strict Mode replay receives its own request lifetime too.
    const controller = new AbortController();
    const run = { scope, controller, pending: false };
    runRef.current = run;
    const node = root.current;
    if (node) node.hidden = false;
    const revoke = () => {
      controller.abort();
      if (node) node.hidden = true;
    };
    const removeSuspend = onBeforeIdentitySuspend(revoke);
    const valid = () => runRef.current === run && !controller.signal.aborted && scope.isCurrent();
    if (scope.accountId && scope.profileId && valid()) {
      const options = {
        expectedAccountId: scope.accountId,
        expectedProfileId: scope.profileId,
        signal: controller.signal,
        maxResponseBytes: 32 * 1024,
      };
      void Promise.all([
        requestAccountScope(
          `/social/videos/${scope.videoId}?profileId=${scope.profileId}`,
          "GET",
          (value) => parseVideoSocialState(value, scope.videoId),
          options,
        ),
        requestAccountScope(
          `/social/channels/${scope.channelId}?profileId=${scope.profileId}`,
          "GET",
          (value) => parseChannelSocialState(value, scope.channelId),
          options,
        ),
      ])
        .then(([video, channel]) => {
          if (valid())
            setResult({
              scope,
              snapshot: { mode: "ready", video: video.value, channel: channel.value },
            });
        })
        .catch((error: unknown) => {
          if (!valid()) return;
          setResult({ scope, snapshot: { ...initialActions(clip), mode: "error" } });
          if (
            error instanceof AccountScopeError &&
            (error.status === 401 ||
              error.code === "ACCOUNT_CHANGED" ||
              error.code === "PROFILE_CHANGED")
          ) {
            revoke();
            retryNavigation();
          }
        });
    }
    return () => {
      if (runRef.current === run) runRef.current = null;
      revoke();
      removeSuspend();
    };
  }, [scope, clip, onBeforeIdentitySuspend, retryNavigation]);

  function signIn() {
    router.push(href("/login"));
  }

  function refresh() {
    const run = runRef.current;
    if (run?.pending) return;
    run?.controller.abort();
    if (root.current) root.current.hidden = true;
    if (audienceStatus === "error") retryNavigation();
    else setAttempt((value) => value + 1);
  }

  async function mutate(action: "like" | "subscribe") {
    const run = runRef.current;
    const current = () =>
      Boolean(
        run &&
        runRef.current === run &&
        run.scope === scope &&
        !run.controller.signal.aborted &&
        scope.isCurrent(),
      );
    if (snapshot.mode === "signedOut") {
      if (scope.isAudienceCurrent()) signIn();
      return;
    }
    if (
      !run ||
      !current() ||
      snapshot.mode !== "ready" ||
      run.pending ||
      !scope.profileId ||
      !scope.accountId
    )
      return;
    const removing =
      action === "like" ? snapshot.video.reaction === "LIKE" : snapshot.channel.subscribed;
    // A synchronous latch also covers two activations before React can commit.
    run.pending = true;
    setOperation({ scope, action });
    const target =
      action === "like"
        ? `videos/${scope.videoId}/reaction`
        : `channels/${scope.channelId}/subscription`;
    const path = `/social/${target}${removing ? `?profileId=${scope.profileId}` : ""}`;
    try {
      const response = await requestAccountScope(
        path,
        removing ? "DELETE" : "PUT",
        (value) =>
          action === "like"
            ? { video: parseReactionMutation(value, removing ? null : "LIKE", scope.videoId) }
            : { channel: parseSubscriptionMutation(value, !removing, scope.channelId) },
        {
          expectedAccountId: scope.accountId,
          expectedProfileId: scope.profileId,
          signal: run.controller.signal,
          maxResponseBytes: 32 * 1024,
        },
        removing
          ? undefined
          : { profileId: scope.profileId, ...(action === "like" ? { type: "LIKE" } : {}) },
      );
      if (!current()) return;
      setResult({ scope, snapshot: { ...snapshot, ...response.value, mode: "ready" } });
      if (!removing)
        trackAnalyticsEvent(action === "like" ? "LIKE" : "SUBSCRIBE", {
          videoId: scope.videoId,
          channelId: scope.channelId,
          profileId: scope.profileId,
        });
    } catch (error) {
      if (!current()) return;
      if (
        error instanceof AccountScopeError &&
        (error.identityUnverified ||
          error.status === 401 ||
          error.code === "ACCOUNT_CHANGED" ||
          error.code === "PROFILE_CHANGED")
      ) {
        // Conceal immediately, including when a late identity check fails. A
        // retry cannot replay this mutation; a new owner must read fresh state.
        if (root.current) root.current.hidden = true;
        run.controller.abort();
        retryNavigation();
      } else {
        setResult({ scope, snapshot: { ...snapshot, mode: "uncertain" } });
      }
    } finally {
      run.pending = false;
      if (current()) setOperation((value) => (value?.scope === scope ? null : value));
    }
  }

  async function share() {
    const url = `${window.location.origin}${href(`/watch/${clip.slug}`)}`;
    try {
      if (navigator.share) await navigator.share({ title: clip.title, url });
      else await navigator.clipboard.writeText(url);
      trackAnalyticsEvent("CLIP_SHARE", { videoId: clip.id, channelId: clip.channel.id });
      trackAnalyticsEvent("SHARE", { videoId: clip.id, channelId: clip.channel.id });
    } catch {
      // Closing a share sheet or unavailable clipboard is a normal non-mutation outcome.
    }
  }

  const mutationDisabled =
    snapshot.mode === "loading" || snapshot.mode === "error" || snapshot.mode === "uncertain";
  const feedback =
    snapshot.mode === "loading"
      ? t("clips.actionsLoading")
      : snapshot.mode === "error"
        ? t("clips.actionsUnavailable")
        : snapshot.mode === "uncertain"
          ? t("clips.actionsUncertain")
          : null;

  return (
    <div ref={root} className={styles.actionWorkspace} data-private-viewer-state>
      <nav className={styles.actions} aria-label={t("clips.actions", { title: clip.title })}>
        <ActionButton
          className={styles.clipAction}
          tone="quiet"
          type="button"
          aria-pressed={snapshot.video.reaction === "LIKE"}
          data-tv-focusable="true"
          data-tv-focus-id={`clip-${clip.id}-like`}
          disabled={mutationDisabled || Boolean(pending)}
          pending={pending === "like"}
          onClick={() => void mutate("like")}
        >
          {snapshot.video.reaction === "LIKE" ? t("clips.liked") : t("clips.like")} ·{" "}
          {formatNumber(snapshot.video.likeCount)}
        </ActionButton>
        <ActionButton
          className={styles.clipAction}
          tone="quiet"
          type="button"
          aria-pressed={snapshot.channel.subscribed}
          data-tv-focusable="true"
          data-tv-focus-id={`clip-${clip.id}-subscribe`}
          disabled={mutationDisabled || Boolean(pending)}
          pending={pending === "subscribe"}
          onClick={() => void mutate("subscribe")}
        >
          {snapshot.channel.subscribed ? t("clips.subscribed") : t("clips.subscribe")}
        </ActionButton>
        <ActionButton
          className={styles.clipAction}
          tone="quiet"
          type="button"
          data-tv-focusable="true"
          data-tv-focus-id={`clip-${clip.id}-share`}
          onClick={() => void share()}
        >
          {t("clips.share")}
        </ActionButton>
      </nav>
      {feedback ? (
        <StatusNotice
          className={styles.actionFeedback ?? ""}
          tone={
            snapshot.mode === "uncertain"
              ? "warning"
              : snapshot.mode === "error"
                ? "danger"
                : "info"
          }
          announce={snapshot.mode === "loading" ? "polite" : "assertive"}
        >
          {feedback}
          {snapshot.mode === "error" || snapshot.mode === "uncertain" ? (
            <div className={styles.feedbackActions}>
              <ActionButton
                type="button"
                tone="secondary"
                data-tv-focusable="true"
                data-tv-focus-id={`clip-${clip.id}-actions-refresh`}
                onClick={refresh}
              >
                {t("clips.refreshActions")}
              </ActionButton>
            </div>
          ) : null}
        </StatusNotice>
      ) : null}
    </div>
  );
}

export interface ClipsPosition {
  scrollTop: number;
  activeId: string | null;
  impressedIds: string[];
  playback: Record<string, ClipPlaybackPosition>;
}

export function ClipsFeed({
  initialPage,
  initialPosition,
  onPageLoaded,
  onFeedScroll,
  registerPositionAuthority,
}: {
  initialPage: ClipsPage;
  initialPosition?: ClipsPosition | undefined;
  onPageLoaded?: ((cursor: string) => void) | undefined;
  onFeedScroll?: ((scrollTop: number) => void) | undefined;
  registerPositionAuthority?: RegisterClipPositionAuthority | undefined;
}) {
  const { identity, isAudienceCurrent, onAudienceInvalidated, retryNavigation } =
    useViewerProduct();
  const continuation = useRef<AbortController | null>(null);
  const startingId = initialPage.items.some((item) => item.id === initialPosition?.activeId)
    ? initialPosition!.activeId
    : (initialPage.items[0]?.id ?? null);
  const { locale, href } = useI18n();
  const t = useCallback(
    (key: Parameters<typeof translateClips>[1]) => translateClips(locale, key),
    [locale],
  );
  const root = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(startingId);
  const impressed = useRef(new Set(initialPosition?.impressedIds));
  const autoplayGate = useRef(createClipsAutoplayGate(initialPosition));
  const [activeId, setActiveId] = useState<string | null>(startingId);
  const [items, setItems] = useState<ClipItem[]>(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [autoplayEnabled, setAutoplayEnabled] = useState(initialPage.autoplayEnabled);
  const [adPolicy, setAdPolicy] = useState(initialPage.adPolicy);
  const [loadMorePending, setLoadMorePending] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);

  useLayoutEffect(() => {
    if (root.current) {
      root.current.scrollTop = initialPosition?.scrollTop ?? 0;
      onFeedScroll?.(root.current.scrollTop);
    }
    const stop = onAudienceInvalidated(() => continuation.current?.abort());
    return () => {
      continuation.current?.abort();
      stop();
    };
  }, [initialPosition, onAudienceInvalidated, onFeedScroll]);

  useEffect(() => {
    const container = root.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!isAudienceCurrent()) return;
        for (const entry of entries) {
          const article = entry.target as HTMLElement;
          const video = article.querySelector("video");
          const videoId = article.dataset.videoId;
          const channelId = article.dataset.channelId;
          if (!video || !videoId) continue;

          if (entry.isIntersecting && entry.intersectionRatio >= 0.7) {
            if (activeIdRef.current && activeIdRef.current !== videoId) {
              trackAnalyticsEvent("CLIP_SWIPE", {
                videoId,
                ...(channelId ? { channelId } : {}),
                metadata: { fromVideoId: activeIdRef.current },
              });
            }
            activeIdRef.current = videoId;
            setActiveId(videoId);
            if (!impressed.current.has(videoId)) {
              impressed.current.add(videoId);
              article.dataset.clipImpressed = "true";
              trackAnalyticsEvent("CLIP_IMPRESSION", {
                videoId,
                ...(channelId ? { channelId } : {}),
              });
            }
            if (
              autoplayGate.current(
                videoId,
                autoplayEnabled,
                window.matchMedia("(prefers-reduced-motion: reduce)").matches,
              )
            ) {
              void video
                .play()
                .then(() => {
                  if (isAudienceCurrent())
                    trackAnalyticsEvent("CLIP_PLAY", {
                      videoId,
                      ...(channelId ? { channelId } : {}),
                    });
                })
                .catch(() => undefined);
            }
          } else {
            video.pause();
          }
        }
      },
      { root: container, threshold: [0.7] },
    );
    container
      .querySelectorAll<HTMLElement>("[data-clip-item='true']")
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [autoplayEnabled, initialPosition, isAudienceCurrent, items.length]);

  async function loadMore() {
    if (!nextCursor || continuation.current || !isAudienceCurrent()) return;
    const cursor = nextCursor;
    const run = new AbortController();
    continuation.current = run;
    const valid = () => continuation.current === run && !run.signal.aborted && isAudienceCurrent();
    const deadline = window.setTimeout(() => run.abort(), 15000);
    setLoadMorePending(true);
    setLoadMoreError(false);
    try {
      const page = await readClips(cursor, { identity, isCurrent: isAudienceCurrent }, run.signal);
      if (!valid()) return;
      if (!page.enabled || page.viewer.isKids !== initialPage.viewer.isKids)
        throw new ClipsReadError(409);
      setItems((current) => mergeClipItems(current, page.items));
      setNextCursor(page.nextCursor);
      setAutoplayEnabled(page.autoplayEnabled);
      setAdPolicy(page.adPolicy);
      onPageLoaded?.(cursor);
    } catch (error) {
      if (continuation.current !== run || !isAudienceCurrent()) return;
      setLoadMoreError(true);
      if (error instanceof ClipsReadError && [401, 409].includes(error.status)) retryNavigation();
    } finally {
      window.clearTimeout(deadline);
      if (continuation.current === run) {
        continuation.current = null;
        if (isAudienceCurrent()) setLoadMorePending(false);
      }
    }
  }

  function moveByKeyboard(event: KeyboardEvent<HTMLElement>, index: number) {
    if (!isAudienceCurrent() || event.target !== event.currentTarget) return;
    const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    const container = root.current;
    const target = container?.querySelector<HTMLElement>(`[data-clip-index='${index + delta}']`);
    if (!container || !target) return;
    event.preventDefault();
    event.stopPropagation();
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth";
    // Scroll the feed itself; scrollIntoView also moves the document and can
    // align the selected clip underneath the sticky shell header.
    const feedBounds = container.getBoundingClientRect();
    container.scrollTo({
      top:
        container.scrollTop +
        target.getBoundingClientRect().top -
        feedBounds.top -
        container.clientTop,
      behavior,
    });
    const header = document
      .querySelector<HTMLElement>("[data-tv-focus-id='brand-home']")
      ?.closest("header");
    const bottomNavigation = [...document.querySelectorAll<HTMLElement>("nav[data-mobile-visible]")]
      .filter((element) => getComputedStyle(element).position === "fixed")
      .find((element) => element.getBoundingClientRect().height > 0);
    const visibleTop = Math.max(0, header?.getBoundingClientRect().bottom ?? 0);
    const visibleBottom = bottomNavigation?.getBoundingClientRect().top ?? window.innerHeight;
    window.scrollBy({
      top: (feedBounds.top + feedBounds.bottom - visibleTop - visibleBottom) / 2,
      behavior,
    });
    target.focus({ preventScroll: true });
  }

  return (
    <section className={styles.workspace}>
      {!items.length ? (
        <EmptyState title={t("clips.emptyTitle")} description={t("clips.emptyDescription")} />
      ) : null}
      <div
        ref={root}
        hidden={!items.length}
        data-clips-feed
        onScroll={(event) => {
          if (isAudienceCurrent()) onFeedScroll?.(event.currentTarget.scrollTop);
        }}
        className={styles.feed}
        aria-label={t("clips.feed")}
      >
        {items.map((clip, index) => {
          const source = clip.mediaAssets.find((asset) => asset.kind === "SOURCE_VIDEO");
          const sourceUrl = mediaAssetUrl(source?.r2ObjectKey);
          return (
            <article
              className={styles.clip}
              key={clip.id}
              data-clip-item="true"
              data-clip-index={index}
              data-clip-active={activeId === clip.id}
              data-clip-impressed={initialPosition?.impressedIds.includes(clip.id) ?? false}
              data-video-id={clip.id}
              data-channel-id={clip.channel.id}
              data-tv-focusable="true"
              data-tv-focus-id={`clip-${clip.id}-surface`}
              tabIndex={0}
              onKeyDown={(event) => moveByKeyboard(event, index)}
            >
              {sourceUrl ? (
                <ClipVideo
                  clip={clip}
                  sourceUrl={sourceUrl}
                  initialPlayback={initialPosition?.playback[clip.id]}
                  registerPositionAuthority={registerPositionAuthority}
                />
              ) : (
                <div className={styles.mediaFallback}>
                  <StatusNotice tone="danger">{t("clips.mediaUnavailable")}</StatusNotice>
                </div>
              )}
              <div className={styles.overlay}>
                <div className={styles.copy}>
                  <Link className={styles.channelLink} href={href(`/c/${clip.channel.handle}`)}>
                    @{clip.channel.handle}
                  </Link>
                  <h2 dir="auto">{clip.title}</h2>
                  {clip.description ? <p dir="auto">{clip.description}</p> : null}
                </div>
                {activeId === clip.id ? <ClipActions key={clip.id} clip={clip} /> : null}
              </div>
              {adPolicy.enabled &&
              adPolicy.minimumOrganicClips > 0 &&
              (index + 1) % adPolicy.minimumOrganicClips === 0 ? (
                <span
                  aria-hidden="true"
                  className={styles.adBoundary}
                  data-clip-ad-boundary="true"
                />
              ) : null}
            </article>
          );
        })}
      </div>

      <div className={styles.more}>
        {nextCursor ? (
          <ActionButton
            type="button"
            tone="secondary"
            pending={loadMorePending}
            disabled={loadMorePending}
            data-tv-focusable="true"
            data-tv-focus-id="clips-load-more"
            onClick={() => void loadMore()}
          >
            {loadMorePending ? t("clips.loadingMore") : t("clips.loadMore")}
          </ActionButton>
        ) : null}
        {loadMoreError ? (
          <StatusNotice tone="warning" announce="polite">
            {t("clips.moreError")}
          </StatusNotice>
        ) : null}
      </div>
    </section>
  );
}
