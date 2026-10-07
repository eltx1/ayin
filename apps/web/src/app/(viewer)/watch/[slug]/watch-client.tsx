"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PageHeader, ActionLink } from "@/components/ui/design-system";
import { PageAdSlot } from "@/components/ads/page-ad-slot";
import { CommentsPanel } from "@/components/comments/comments-panel";
import {
  AnalyticsAyinPlayer,
  createPlayerAnalyticsSession,
  type PlayerAnalyticsSession,
} from "@/components/player/analytics-ayin-player";
import { VideoSocialActions } from "@/components/social/video-social-actions";
import { useI18n } from "@/components/i18n/i18n-provider";
import { useViewerProduct } from "@/components/viewer/viewer-product-context";
import { EmptyState } from "@/components/viewer/view-states";
import type { PublicPlaybackResponse, AyinPlayerInitialPreferences } from "@/lib/ayin-player";
import { releaseHtmlMediaElement } from "@/lib/adaptive-playback";
import { mediaAssetUrl } from "@/lib/channel";
import { localizePath } from "@/lib/i18n/routing";
import { formatNumber } from "@/lib/i18n/format";
import { translateCatalogDetail } from "@/lib/i18n/catalog-detail";
import { readPlayback, PlaybackReadError } from "@/lib/playback-request";
import styles from "./page.module.css";

export function WatchClient({ slug, explicitKids }: { slug: string; explicitKids: boolean }) {
  const { locale, t } = useI18n();
  const {
    identity,
    identityRevision,
    audienceStatus,
    isAudienceCurrent,
    retryNavigation,
    onAudienceInvalidated,
  } = useViewerProduct();
  const key = JSON.stringify([identityRevision, locale, slug, explicitKids]);
  const owner = JSON.stringify([identity?.account.id, identity?.profile.id, slug]);
  const root = useRef<HTMLDivElement | null>(null);
  const release = useRef<(() => void) | null>(null);
  const positionAuthority = useRef<(() => boolean) | null>(null);
  const timeline = useRef<{
    owner: string;
    videoId: string;
    positionMs: number | undefined;
    autoPlay: boolean;
    preferences: AyinPlayerInitialPreferences;
  } | null>(null);
  const revalidationAttempted = useRef(false);
  const accounting = useRef<{
    owner: string;
    videoId: string;
    session: PlayerAnalyticsSession;
  } | null>(null);
  const [read, setRead] = useState<{
    key: string;
    data: PublicPlaybackResponse | null;
    status: number;
    initialPositionMs?: number | undefined;
    autoPlay?: boolean | undefined;
    initialPreferences?: AyinPlayerInitialPreferences | undefined;
    analyticsSession?: PlayerAnalyticsSession | undefined;
  } | null>(null);
  const onPlaybackReleaseReady = useCallback((stop: (() => void) | null) => {
    release.current = stop;
  }, []);
  const onPositionAuthorityReady = useCallback((read: (() => boolean) | null) => {
    positionAuthority.current = read;
  }, []);

  useLayoutEffect(
    () =>
      onAudienceInvalidated(() => {
        const video = root.current?.querySelector("video");
        const videoId = root.current?.dataset.watchVideoId;
        const priorPosition =
          timeline.current?.owner === owner && timeline.current.videoId === videoId
            ? timeline.current.positionMs
            : undefined;
        if (video && videoId)
          timeline.current = {
            owner,
            videoId,
            positionMs:
              positionAuthority.current?.() &&
              video.readyState >= 1 &&
              Number.isFinite(video.currentTime)
                ? Math.max(0, Math.floor(video.currentTime * 1000))
                : priorPosition,
            preferences: {
              captionId: video.dataset.selectedCaptionId || null,
              playbackRate: video.playbackRate,
              volume: video.volume,
              muted: video.muted,
            },
            // Before metadata, paused is the native initial state, not proof
            // that the viewer deliberately paused this generation.
            autoPlay: video.ended
              ? false
              : video.dataset.ayinAdContentIntent
                ? video.dataset.ayinAdContentIntent === "playing"
                : video.readyState >= 1
                  ? !video.paused
                  : root.current?.dataset.watchAutoplay !== "false",
          };
        // The shell already conceals this root. Stop decoders/ads synchronously,
        // before a deferred React commit or an obsolete source callback can run.
        release.current?.();
        root.current
          ?.querySelectorAll("video,audio")
          .forEach((media) => releaseHtmlMediaElement(media as HTMLMediaElement));
      }),
    [onAudienceInvalidated, owner],
  );

  useEffect(() => {
    revalidationAttempted.current = false;
  }, [slug, locale, explicitKids]);
  const retryPlayback = useCallback(() => {
    revalidationAttempted.current = false;
    retryNavigation();
  }, [retryNavigation]);

  useEffect(() => {
    if (audienceStatus !== "ready" || !isAudienceCurrent()) return;
    // Retain only counters across a same-viewer recheck. A newly verified
    // account/profile must not inherit the previous viewer's accounting.
    if (accounting.current?.owner !== owner) accounting.current = null;
    if (timeline.current?.owner !== owner) timeline.current = null;
    const controller = new AbortController();
    let disposed = false;
    const deadline = window.setTimeout(() => controller.abort(), 15000);
    void readPlayback(
      { slug, locale, explicitKids },
      { identity, isCurrent: isAudienceCurrent },
      controller.signal,
    )
      .then((data) => {
        if (!disposed && !controller.signal.aborted && isAudienceCurrent()) {
          revalidationAttempted.current = false;
          if (!accounting.current || accounting.current.videoId !== data.video.id) {
            accounting.current = {
              owner,
              videoId: data.video.id,
              session: createPlayerAnalyticsSession(data.video.id),
            };
          }
          const priorTimeline =
            timeline.current?.owner === owner && timeline.current.videoId === data.video.id
              ? timeline.current
              : null;
          setRead({
            key,
            data,
            status: 200,
            analyticsSession: accounting.current.session,
            initialPositionMs: priorTimeline?.positionMs,
            autoPlay: priorTimeline?.autoPlay,
            initialPreferences: priorTimeline?.preferences,
          });
        }
      })
      .catch((error: unknown) => {
        if (disposed || !isAudienceCurrent()) return;
        const status = error instanceof PlaybackReadError ? error.status : 0;
        setRead({ key, data: null, status });
        if (
          (status === 409 || (status === 401 && identity !== null)) &&
          !revalidationAttempted.current
        ) {
          // A deleted/unavailable default profile can keep returning 409. One
          // fresh audience read is useful; repeated failures need explicit retry.
          revalidationAttempted.current = true;
          retryNavigation();
        }
      })
      .finally(() => window.clearTimeout(deadline));
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(deadline);
    };
  }, [
    audienceStatus,
    explicitKids,
    identity,
    isAudienceCurrent,
    key,
    locale,
    owner,
    retryNavigation,
    slug,
  ]);

  const current = read?.key === key && isAudienceCurrent() ? read : null;
  if (audienceStatus === "error" || (current && !current.data))
    return (
      <main className={styles.page}>
        <EmptyState
          title={current?.status === 404 ? t("common.nothingHereYet") : t("watch.unavailable")}
          description={t("watch.loadError")}
          action={
            <button type="button" onClick={retryPlayback}>
              {t("common.retry")}
            </button>
          }
        />
      </main>
    );
  if (!current?.data)
    return (
      <main className={styles.page}>
        <p role="status">{t("common.loading")}</p>
      </main>
    );
  return (
    <main className={styles.page}>
      <div
        className={styles.audience}
        data-private-viewer-state
        data-watch-video-id={current.data.video.id}
        data-watch-autoplay={current.autoPlay ?? true}
        key={key}
        ref={root}
      >
        <WatchContent
          data={current.data}
          explicitKids={explicitKids}
          analyticsSession={current.analyticsSession}
          autoPlay={current.autoPlay}
          initialPreferences={current.initialPreferences}
          initialPositionMs={current.initialPositionMs}
          onPlaybackReleaseReady={onPlaybackReleaseReady}
          onPositionAuthorityReady={onPositionAuthorityReady}
        />
      </div>
    </main>
  );
}

export function WatchContent({
  data,
  explicitKids,
  analyticsSession,
  autoPlay = true,
  initialPreferences,
  initialPositionMs,
  onPlaybackReleaseReady,
  onPositionAuthorityReady,
}: {
  data: PublicPlaybackResponse;
  explicitKids: boolean;
  analyticsSession?: PlayerAnalyticsSession | undefined;
  autoPlay?: boolean | undefined;
  initialPreferences?: AyinPlayerInitialPreferences | undefined;
  initialPositionMs?: number | undefined;
  onPlaybackReleaseReady?: ((release: (() => void) | null) => void) | undefined;
  onPositionAuthorityReady?: ((read: (() => boolean) | null) => void) | undefined;
}) {
  const { locale, t } = useI18n();
  const kidsMode = explicitKids || data.viewer.isKids;
  const seriesContext =
    !kidsMode && data.detail.contentType === "SERIES_EPISODE" ? data.detail.seriesContext : null;
  const catalogText = (
    key: Parameters<typeof translateCatalogDetail>[1],
    values?: Parameters<typeof translateCatalogDetail>[2],
  ) => translateCatalogDetail(locale, key, values);
  const episodePosition = (seasonNumber: number, episodeNumber: number) =>
    `${catalogText("series.season", { count: formatNumber(seasonNumber, locale) })} · ${catalogText("series.episode", { count: formatNumber(episodeNumber, locale) })}`;
  const displayTitle = seriesContext?.episode.title ?? data.video.title;
  const displayDescription = seriesContext?.episode.synopsis || data.video.description;
  const sourceUrl = mediaAssetUrl(data.video.source.objectKey);
  if (!sourceUrl) throw new Error(t("watch.deliveryError"));
  const adaptiveSourceUrl = data.video.adaptiveSource
    ? mediaAssetUrl(data.video.adaptiveSource.objectKey)
    : null;
  const captions = data.video.captions.flatMap((track) => {
    const src = mediaAssetUrl(track.objectKey);
    return src
      ? [
          {
            id: track.id,
            src,
            label: track.label,
            language: track.language,
            kind: track.kind,
            default: track.default,
          },
        ]
      : [];
  });

  return (
    <>
      <AnalyticsAyinPlayer
        advertisingEnabled={!kidsMode}
        analytics={analyticsSession?.analytics}
        completedAdBreaks={analyticsSession?.completedAdBreaks}
        onContentImpression={analyticsSession?.recordImpression}
        initialPreferences={initialPreferences}
        initialPositionMs={initialPositionMs}
        onPlaybackReleaseReady={onPlaybackReleaseReady}
        onPositionAuthorityReady={onPositionAuthorityReady}
        adaptiveSourceUrl={adaptiveSourceUrl}
        autoPlay={autoPlay}
        className={styles.playerFrame}
        captions={captions}
        chapters={data.video.chapters}
        durationMs={data.video.durationMs}
        progressPolicy={data.playerPolicy}
        sourceUrl={sourceUrl}
        title={displayTitle}
        videoId={data.video.id}
      />
      <section className={styles.details}>
        {seriesContext ? (
          <nav
            className={styles.seriesNavigation}
            aria-label={catalogText("series.episodeNavigation")}
          >
            <ActionLink
              tone="secondary"
              href={localizePath(
                `/series/${encodeURIComponent(seriesContext.series.slug)}?season=${seriesContext.season.seasonNumber}`,
                locale,
              )}
              data-tv-focusable="true"
            >
              <span dir="auto">{seriesContext.series.title}</span>
              <span>{catalogText("series.allEpisodes")}</span>
            </ActionLink>
            <p dir="auto">
              {episodePosition(
                seriesContext.season.seasonNumber,
                seriesContext.episode.episodeNumber,
              )}
              {seriesContext.season.title ? ` · ${seriesContext.season.title}` : ""}
            </p>
            {seriesContext.nextEpisode ? (
              <ActionLink
                href={localizePath(
                  `/watch/${encodeURIComponent(seriesContext.nextEpisode.video.slug)}`,
                  locale,
                )}
                data-tv-focusable="true"
                data-tv-focus-id="watch-next-episode"
              >
                <span>{catalogText("series.nextEpisode")}</span>
                <span dir="auto">
                  {episodePosition(
                    seriesContext.nextEpisode.seasonNumber,
                    seriesContext.nextEpisode.episodeNumber,
                  )}{" "}
                  · {seriesContext.nextEpisode.title}
                </span>
              </ActionLink>
            ) : (
              <p>{catalogText("series.lastAvailableEpisode")}</p>
            )}
          </nav>
        ) : null}
        <PageHeader
          eyebrow={t("watch.eyebrow")}
          title={displayTitle}
          {...(displayDescription ? { description: displayDescription } : {})}
          {...(!kidsMode
            ? {
                actions: (
                  <ActionLink
                    tone="secondary"
                    data-tv-focusable="true"
                    data-tv-focus-id="watch-channel"
                    href={localizePath(
                      `/c/${encodeURIComponent(data.video.channel.handle)}`,
                      locale,
                    )}
                  >
                    <span dir="auto">{data.video.channel.name}</span> ·{" "}
                    <bdi dir="ltr">@{data.video.channel.handle}</bdi>
                  </ActionLink>
                ),
              }
            : {})}
        >
          {kidsMode ? (
            <p dir="auto">{data.video.channel.name}</p>
          ) : (
            <VideoSocialActions className={styles.actions} videoId={data.video.id} />
          )}
        </PageHeader>
      </section>
      {!kidsMode ? <PageAdSlot placementKey="watch_below_player" /> : null}
      {data.detail.related.length > 0 ? (
        <section className={styles.related}>
          <h2 dir="auto">{t("watch.moreFrom", { name: data.video.channel.name })}</h2>
          <div>
            {data.detail.related.map((item) => (
              <Link data-tv-focusable="true" href={localizePath(item.href, locale)} key={item.id}>
                <strong dir="auto">{item.title}</strong>
                {item.durationMs ? (
                  <span>{t("watch.minutes", { count: Math.ceil(item.durationMs / 60_000) })}</span>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      {!kidsMode ? (
        <CommentsPanel enabled={data.detail.commentsSlot.enabled} videoId={data.video.id} />
      ) : null}
    </>
  );
}
