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
  captureClipPlaybackPosition,
  CLIPS_SESSION_LIMIT,
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
import { ClipDetails } from "./clip-details";
import { useClipCapabilities } from "./use-clip-capabilities";
import { useClipsViewport, useClipsModalOpen } from "./use-clips-viewport";

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

function ClipActions({
  clip,
  onShareActive,
  isKids,
}: {
  isKids: boolean;
  clip: ClipItem;
  onShareActive: (value: boolean) => void;
}) {
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
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const sharing = useRef(false);
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
    if (sharing.current || !isAudienceCurrent()) return;
    sharing.current = true;
    setShareFeedback(null);
    const current = isAudienceCurrent;
    const url = `${window.location.origin}${href(`/watch/${clip.slug}${isKids ? "?kids=1" : ""}`)}`;
    onShareActive(true);
    try {
      const native = Boolean(navigator.share);
      if (native) await navigator.share({ title: clip.title, url });
      else if (navigator.clipboard) await navigator.clipboard.writeText(url);
      else throw new Error("Clipboard unavailable");
      if (!current()) return;
      setShareFeedback(native ? t("clips.shareOpened") : t("clips.copied"));
      trackAnalyticsEvent("CLIP_SHARE", { videoId: clip.id, channelId: clip.channel.id });
      trackAnalyticsEvent("SHARE", { videoId: clip.id, channelId: clip.channel.id });
    } catch (error) {
      if (current() && !(error instanceof DOMException && error.name === "AbortError"))
        setShareFeedback(t("clips.shareFailed"));
    } finally {
      sharing.current = false;
      onShareActive(false);
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
      {shareFeedback ? (
        <p className={styles.actionFeedback} role="status">
          {shareFeedback}
        </p>
      ) : null}
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
  dataSaving?: boolean;
}

export function ClipsFeed({
  initialPage,
  initialPosition,
  onPageLoaded,
  onFeedScroll,
  registerPositionAuthority,
  registerSnapshot,
  onStartFresh,
  capabilityBlocked = false,
  onCapabilityIdentityInvalid,
  onRetryCapabilities,
}: {
  initialPage: ClipsPage;
  capabilityBlocked?: boolean;
  onCapabilityIdentityInvalid?: (() => void) | undefined;
  onRetryCapabilities?: (() => void) | undefined;
  initialPosition?: ClipsPosition | undefined;
  onPageLoaded?: ((cursor: string) => void) | undefined;
  onFeedScroll?: ((scrollTop: number) => void) | undefined;
  registerPositionAuthority?: RegisterClipPositionAuthority | undefined;
  registerSnapshot?: ((read: () => ClipsPosition) => () => void) | undefined;
  onStartFresh?: (() => void) | undefined;
}) {
  const { identity, isAudienceCurrent, onAudienceInvalidated, retryNavigation } =
    useViewerProduct();
  const { locale, href, formatNumber } = useI18n();
  const t = useCallback(
    (key: Parameters<typeof translateClips>[1], values = {}) => translateClips(locale, key, values),
    [locale],
  );
  const continuation = useRef<AbortController | null>(null);
  const startingId = initialPage.items.some((item) => item.id === initialPosition?.activeId)
    ? initialPosition!.activeId
    : (initialPage.items[0]?.id ?? null);
  const root = useRef<HTMLDivElement>(null);
  const deactivate = useRef<(() => void) | null>(null);
  const registerDeactivate = useCallback((stop: () => void) => {
    deactivate.current = stop;
    return () => {
      if (deactivate.current === stop) deactivate.current = null;
    };
  }, []);
  const activeIdRef = useRef<string | null>(startingId);
  const focusSelection = useRef(false);
  const impressed = useRef(new Set(initialPosition?.impressedIds));
  const positions = useRef<Record<string, ClipPlaybackPosition>>({ ...initialPosition?.playback });
  const authorities = useRef(new Map<string, () => boolean>());
  const [restoredPauseId, setRestoredPauseId] = useState(
    startingId &&
      (initialPosition?.playback[startingId]?.paused ||
        initialPosition?.playback[startingId]?.ended)
      ? startingId
      : null,
  );
  const [selectedPlayback, setSelectedPlayback] = useState(
    startingId ? initialPosition?.playback[startingId] : undefined,
  );
  const [viewportVisible, setViewportVisible] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(startingId);
  const [items, setItems] = useState<ClipItem[]>(initialPage.items.slice(0, CLIPS_SESSION_LIMIT));
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [autoplayEnabled, setAutoplayEnabled] = useState(initialPage.autoplayEnabled);
  const [adPolicy, setAdPolicy] = useState(initialPage.adPolicy);
  const [loadMorePending, setLoadMorePending] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shareActive, setShareActive] = useState(false);
  const [dataSaving, setDataSaving] = useState(() => {
    const connection =
      typeof navigator === "undefined"
        ? undefined
        : (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
            .connection;
    return (
      initialPosition?.dataSaving ??
      Boolean(connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? ""))
    );
  });
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const anyModalOpen = useClipsModalOpen();
  const pausedForPanel = sheetOpen || shareActive || anyModalOpen;
  const stageHeight = useClipsViewport(root);
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.id === activeId),
  );
  const activeClip = items[activeIndex] ?? null;
  const capabilities = useClipCapabilities(
    capabilityBlocked ? null : activeClip,
    initialPage.viewer.isKids,
    onCapabilityIdentityInvalid ?? retryNavigation,
  );
  const capabilityStatus = capabilityBlocked ? "unavailable" : capabilities.status;
  const retryCapabilities = () => {
    if (capabilityBlocked) onRetryCapabilities?.();
    else capabilities.retry();
  };
  const windowStart = Math.max(0, activeIndex - 1);
  const windowEnd = Math.min(items.length, activeIndex + 2);
  const sessionFull = items.length >= CLIPS_SESSION_LIMIT && Boolean(nextCursor);
  const visible = viewportVisible && stageHeight > 0;
  const allowAutoplay = Boolean(
    activeId &&
    activeId !== restoredPauseId &&
    autoplayEnabled &&
    !reducedMotion &&
    !dataSaving &&
    visible,
  );

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) =>
        setViewportVisible(Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.5)),
      { threshold: [0, 0.5] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const registerAuthority = useCallback<RegisterClipPositionAuthority>(
    (id, check) => {
      authorities.current.set(id, check);
      const remove = registerPositionAuthority?.(id, check);
      return () => {
        if (authorities.current.get(id) === check) authorities.current.delete(id);
        remove?.();
      };
    },
    [registerPositionAuthority],
  );

  const snapshot = useCallback((): ClipsPosition => {
    const node = root.current;
    node?.querySelectorAll<HTMLVideoElement>("video").forEach((video) => {
      const id = video.closest<HTMLElement>("[data-video-id]")?.dataset.videoId;
      if (id)
        positions.current[id] = captureClipPlaybackPosition(
          video,
          authorities.current.get(id)?.() === true,
          positions.current[id]?.positionMs,
        );
    });
    return {
      activeId: activeIdRef.current,
      scrollTop: node?.scrollTop ?? 0,
      impressedIds: [...impressed.current],
      playback: { ...positions.current },
      dataSaving,
    };
  }, [dataSaving]);
  useLayoutEffect(() => registerSnapshot?.(snapshot), [registerSnapshot, snapshot]);
  useLayoutEffect(() => {
    const stop = onAudienceInvalidated(() => continuation.current?.abort());
    return () => {
      continuation.current?.abort();
      stop();
    };
  }, [onAudienceInvalidated]);

  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(motion.matches);
    motion.addEventListener("change", update);
    type Connection = EventTarget & { saveData?: boolean; effectiveType?: string };
    const connection = (navigator as Navigator & { connection?: Connection }).connection;
    const updateConnection = () => {
      // Optional hints only. The active-only source policy applies even without them.
      if (connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? ""))
        setDataSaving(true);
    };
    connection?.addEventListener("change", updateConnection);
    return () => {
      motion.removeEventListener("change", update);
      connection?.removeEventListener("change", updateConnection);
    };
  }, []);

  useLayoutEffect(() => {
    if (!root.current || !stageHeight) return;
    // Resize retains the selected item rather than the previous pixel offset.
    const index = Number(
      root.current.querySelector<HTMLElement>("[data-clip-active='true']")?.dataset.clipIndex ?? 0,
    );
    root.current.scrollTop = index * root.current.clientHeight;
    onFeedScroll?.(root.current.scrollTop);
    // Selection changes scroll through move()/native input; only geometry changes realign.
  }, [stageHeight, onFeedScroll]);

  useEffect(() => {
    if (!activeClip || !visible || !isAudienceCurrent() || impressed.current.has(activeClip.id))
      return;
    impressed.current.add(activeClip.id);
    trackAnalyticsEvent("CLIP_IMPRESSION", {
      videoId: activeClip.id,
      channelId: activeClip.channel.id,
    });
  }, [activeClip, isAudienceCurrent, visible]);

  useLayoutEffect(() => {
    if (!focusSelection.current) return;
    focusSelection.current = false;
    root.current
      ?.querySelector<HTMLElement>("[data-clip-active='true']")
      ?.focus({ preventScroll: true });
  }, [activeId]);

  function select(index: number, focus = false) {
    const clip = items[index];
    if (!clip || !isAudienceCurrent() || pausedForPanel || clip.id === activeIdRef.current) return;
    const previous = activeIdRef.current;
    snapshot();
    // Retire the old decoder synchronously before a new one can be mounted.
    deactivate.current?.();
    const focused = root.current?.contains(document.activeElement);
    focusSelection.current = Boolean(focus || focused);
    activeIdRef.current = clip.id;
    const retained = positions.current[clip.id];
    // Re-entering a completed Clip is a replay, not a new completion after
    // useWatchProgress safely clamps an end-position to the final250ms.
    const playback = retained?.ended
      ? { ...retained, positionMs: 0, paused: true, ended: false }
      : retained;
    if (playback) positions.current[clip.id] = playback;
    setSelectedPlayback(playback);
    setRestoredPauseId(null);
    setActiveId(clip.id);
    setSheetOpen(false);
    if (previous)
      trackAnalyticsEvent("CLIP_SWIPE", {
        videoId: clip.id,
        channelId: clip.channel.id,
        metadata: { fromVideoId: previous },
      });
  }

  function move(delta: number) {
    const index = items.findIndex((item) => item.id === activeIdRef.current) + delta;
    if (!root.current || !items[index] || pausedForPanel) return;
    // One deterministic intent. Native touch scrolling remains native; buttons
    // and arrows never queue overlapping smooth-scroll animations.
    select(index, true);
    root.current.scrollTo({ top: index * root.current.clientHeight, behavior: "instant" });
  }

  async function loadMore() {
    if (!nextCursor || continuation.current || !isAudienceCurrent() || sessionFull) return;
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
      setItems((current) => mergeClipItems(current, page.items).slice(0, CLIPS_SESSION_LIMIT));
      setNextCursor(page.nextCursor);
      setAutoplayEnabled(page.autoplayEnabled);
      setAdPolicy(page.adPolicy);
      if (!activeIdRef.current && page.items[0]) {
        activeIdRef.current = page.items[0].id;
        setActiveId(page.items[0].id);
      }
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

  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey)
      return;
    const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!delta || !items[activeIndex + delta]) return;
    event.preventDefault();
    event.stopPropagation();
    move(delta);
  }

  return (
    <section className={styles.workspace} aria-label={t("clips.feed")}>
      <div className={styles.toolbar}>
        <span className={styles.wordmark} aria-hidden="true">
          {t("clips.title")}
        </span>
        <nav className={styles.stepControls} aria-label={t("clips.navigation")}>
          <ActionButton
            tone="quiet"
            type="button"
            aria-label={t("clips.previous")}
            disabled={!activeIndex || pausedForPanel}
            onClick={() => move(-1)}
          >
            <span aria-hidden="true">↑</span>
          </ActionButton>
          <span className={styles.position}>
            {t("clips.position", {
              current: formatNumber(items.length ? activeIndex + 1 : 0),
              total: formatNumber(items.length),
            })}
          </span>
          <ActionButton
            tone="quiet"
            type="button"
            aria-label={t("clips.next")}
            disabled={activeIndex >= items.length - 1 || pausedForPanel}
            onClick={() => move(1)}
          >
            <span aria-hidden="true">↓</span>
          </ActionButton>
        </nav>
        <ActionButton
          className={styles.dataSaving}
          tone="quiet"
          type="button"
          aria-pressed={dataSaving}
          title={t("clips.saveDataHint")}
          onClick={() => setDataSaving((value) => !value)}
        >
          {t("clips.saveData")}
        </ActionButton>
      </div>
      <p className={styles.srOnly} id="clips-feed-help">
        {t("clips.feedHelp")}
      </p>
      {!items.length ? (
        <EmptyState title={t("clips.emptyTitle")} description={t("clips.emptyDescription")} />
      ) : null}
      <div
        ref={root}
        hidden={!items.length}
        data-clips-feed
        data-clips-loaded-count={items.length}
        role="feed"
        aria-busy={loadMorePending}
        className={styles.feed}
        aria-label={t("clips.feed")}
        aria-describedby="clips-feed-help"
        onScroll={(event) => {
          if (
            !isAudienceCurrent() ||
            pausedForPanel ||
            !stageHeight ||
            event.currentTarget.clientHeight !== stageHeight
          )
            return;
          const node = event.currentTarget;
          onFeedScroll?.(node.scrollTop);
          const index = Math.max(
            0,
            Math.min(items.length - 1, Math.round(node.scrollTop / node.clientHeight)),
          );
          // Wait until one card owns at least70% of the viewport.
          if (Math.abs(node.scrollTop / node.clientHeight - index) <= 0.3) select(index);
        }}
      >
        {windowStart > 0 && (
          <div
            aria-hidden="true"
            className={styles.spacer}
            style={{ height: `calc(var(--clip-stage-height) * ${windowStart})` }}
          />
        )}
        {items.slice(windowStart, windowEnd).map((clip, offset) => {
          const index = windowStart + offset;
          const active = activeId === clip.id;
          const sourceUrl = mediaAssetUrl(
            clip.mediaAssets.find((asset) => asset.kind === "SOURCE_VIDEO")?.r2ObjectKey,
          );
          const posterUrl = mediaAssetUrl(
            clip.mediaAssets.find((asset) => asset.kind === "THUMBNAIL")?.r2ObjectKey,
          );
          return (
            <article
              className={styles.clip}
              key={clip.id}
              data-clip-item="true"
              aria-labelledby={`clip-title-${clip.id}`}
              aria-posinset={index + 1}
              aria-setsize={nextCursor ? -1 : items.length}
              data-clip-index={index}
              data-clip-active={active}
              data-clip-impressed={
                (visible && active) || initialPosition?.impressedIds.includes(clip.id) || false
              }
              data-video-id={clip.id}
              data-channel-id={clip.channel.id}
              data-tv-focusable="true"
              data-tv-focus-id={`clip-${clip.id}-surface`}
              tabIndex={active ? 0 : -1}
              onKeyDown={keyboard}
            >
              {active && sourceUrl ? (
                <ClipVideo
                  key={clip.id}
                  clip={clip}
                  sourceUrl={sourceUrl}
                  posterUrl={posterUrl ?? undefined}
                  initialPlayback={selectedPlayback}
                  registerPositionAuthority={registerAuthority}
                  registerDeactivate={registerDeactivate}
                  autoPlayAllowed={allowAutoplay}
                  pausedForPanel={pausedForPanel}
                  dataSaving={dataSaving}
                  viewportVisible={visible}
                  captions={capabilities.status === "ready" ? capabilities.captions : undefined}
                  isKids={initialPage.viewer.isKids}
                />
              ) : (
                <div className={styles.mediaFallback}>
                  {posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={posterUrl} alt="" loading="lazy" className={styles.poster} />
                  ) : null}
                  {!sourceUrl ? (
                    <StatusNotice tone="danger">{t("clips.mediaUnavailable")}</StatusNotice>
                  ) : null}
                </div>
              )}
              <div className={styles.overlay} data-clip-metadata>
                <div className={styles.copy}>
                  <Link
                    className={styles.channelLink}
                    tabIndex={active ? 0 : -1}
                    href={href(
                      `/c/${clip.channel.handle}${initialPage.viewer.isKids ? "?kids=1" : ""}`,
                    )}
                  >
                    <bdi>@{clip.channel.handle}</bdi>
                  </Link>
                  <h2 id={`clip-title-${clip.id}`} dir="auto">
                    {clip.title}
                  </h2>
                  {active && (
                    <div className={styles.detailActions}>
                      <ClipDetails
                        clip={clip}
                        onOpenChange={setSheetOpen}
                        capabilityStatus={capabilityStatus}
                        onRetryCapabilities={retryCapabilities}
                      />
                      <Link
                        className={styles.watchLink}
                        href={href(
                          `/watch/${clip.slug}${initialPage.viewer.isKids ? "?kids=1" : ""}`,
                        )}
                      >
                        {t("clips.watch")}
                      </Link>
                    </div>
                  )}
                </div>
                {active ? (
                  <ClipActions
                    key={clip.id}
                    clip={clip}
                    onShareActive={setShareActive}
                    isKids={initialPage.viewer.isKids}
                  />
                ) : null}
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
        {windowEnd < items.length && (
          <div
            aria-hidden="true"
            className={styles.spacer}
            style={{ height: `calc(var(--clip-stage-height) * ${items.length - windowEnd})` }}
          />
        )}
      </div>
      <div className={styles.more}>
        {nextCursor && !sessionFull ? (
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
        {sessionFull ? (
          <>
            <p>{t("clips.sessionEnd")}</p>
            <ActionButton type="button" tone="secondary" onClick={onStartFresh}>
              {t("clips.startFresh")}
            </ActionButton>
          </>
        ) : !nextCursor && items.length > 0 ? (
          <p>{t("clips.end")}</p>
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
