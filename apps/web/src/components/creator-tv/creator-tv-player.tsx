"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AdEnabledAyinPlayer } from "@/components/player/ad-enabled-ayin-player";
import { LiveAyinPlayer } from "@/components/player/live-ayin-player";
import { ActionButton, StatusNotice } from "@/components/ui/design-system";
import { useI18n } from "@/components/i18n/i18n-provider";
import { trackAnalyticsEvent } from "@/lib/analytics";
import { apiBaseUrl } from "@/lib/api";
import { getAdvertisingConsentSnapshot } from "@/lib/advertising-consent";
import { mediaAssetUrl } from "@/lib/channel";
import { formatDate, formatNumber } from "@/lib/i18n/format";
import {
  translatePublicCreator,
  type PublicCreatorTranslationKey,
} from "@/lib/i18n/public-creator";
import type { TranslationValues } from "@/lib/i18n/translator";
import {
  fetchPublicCreatorTvLinear,
  selectCreatorTvMonetizedPlayback,
  type CreatorTvLinearCapability,
  type CreatorTvProgram,
  type PublicCreatorTvResponse,
} from "@/lib/creator-tv";

import styles from "./creator-tv.module.css";

export function CreatorTvPlayer({
  initialData,
  initialLinear,
}: {
  initialData: PublicCreatorTvResponse;
  initialLinear: CreatorTvLinearCapability | null;
}) {
  const { locale } = useI18n();
  const t = useCallback(
    (key: PublicCreatorTranslationKey, values: TranslationValues = {}) =>
      translatePublicCreator(locale, key, values),
    [locale],
  );
  const [data, setData] = useState(initialData);
  const [linear, setLinear] = useState(initialLinear);
  const [ssaiFallback, setSsaiFallback] = useState<{
    occurrenceKey: string | null;
    offsetMs: number;
  } | null>(null);
  const [advertisingConsent] = useState(() => getAdvertisingConsentSnapshot());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const selectedSsaiRef = useRef<string | null>(null);
  const opportunityEventsRef = useRef(new Set<string>());

  const current = data.schedule.nowPlaying;
  const currentOccurrenceKey = current?.occurrenceKey;
  const currentVideoId = current?.video.id;
  useEffect(() => {
    if (!currentVideoId) return;
    trackAnalyticsEvent("TV_START", {
      channelId: data.channel.id,
      videoId: currentVideoId,
    });
  }, [currentOccurrenceKey, currentVideoId, data.channel.id]);
  const mediaUrl = mediaAssetUrl(current?.video.source.objectKey);
  const ssaiFailed = ssaiFallback !== null;
  const monetizedPlayback = useMemo(
    () => selectCreatorTvMonetizedPlayback(linear, ssaiFailed, advertisingConsent.mode),
    [advertisingConsent.mode, linear, ssaiFailed],
  );
  const progressiveOffsetMs =
    ssaiFallback && ssaiFallback.occurrenceKey === currentOccurrenceKey
      ? ssaiFallback.offsetMs
      : (current?.playbackOffsetMs ?? 0);

  useEffect(() => {
    if (monetizedPlayback.mode !== "GOOGLE_DAI_SSB") return;
    const identity = monetizedPlayback.providerResourceId + ":" + monetizedPlayback.assetKey;
    if (selectedSsaiRef.current === identity) return;
    selectedSsaiRef.current = identity;
    trackAnalyticsEvent("TV_SSAI_SELECTED", {
      channelId: data.channel.id,
      ...(currentVideoId ? { videoId: currentVideoId } : {}),
      metadata: {
        provider: "GOOGLE_AD_MANAGER_DAI",
        integration: "SSB",
        assetKey: monetizedPlayback.assetKey,
        networkCode: monetizedPlayback.networkCode,
        providerResourceId: monetizedPlayback.providerResourceId,
      },
    });
  }, [currentVideoId, data.channel.id, monetizedPlayback]);

  useEffect(() => {
    if (monetizedPlayback.mode !== "GOOGLE_DAI_SSB" || !linear) return;
    const timers: number[] = [];
    const now = Date.now();

    const emitOpportunity = (
      kind: "OPEN" | "CLOSE",
      opportunity: CreatorTvLinearCapability["monetization"]["opportunities"][number],
    ) => {
      const key = opportunity.opportunityId + ":" + kind;
      if (opportunityEventsRef.current.has(key)) return;
      opportunityEventsRef.current.add(key);
      trackAnalyticsEvent(kind === "OPEN" ? "TV_AD_BREAK_OPEN" : "TV_AD_BREAK_CLOSE", {
        channelId: data.channel.id,
        ...(opportunity.videoId ? { videoId: opportunity.videoId } : {}),
        metadata: {
          opportunityId: opportunity.opportunityId,
          occurrenceKey: opportunity.occurrenceKey,
          source: opportunity.source,
          assetKey: monetizedPlayback.assetKey,
          networkCode: monetizedPlayback.networkCode,
          providerResourceId: monetizedPlayback.providerResourceId,
          durationMs: opportunity.durationMs,
        },
      });
    };

    for (const opportunity of linear.monetization.opportunities) {
      if (!opportunity.startsAt || !opportunity.endsAt) continue;
      const startsAt = Date.parse(opportunity.startsAt);
      const endsAt = Date.parse(opportunity.endsAt);
      if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= now) continue;

      if (startsAt <= now) emitOpportunity("OPEN", opportunity);
      else {
        timers.push(
          window.setTimeout(
            () => emitOpportunity("OPEN", opportunity),
            Math.min(startsAt - now, 2_147_000_000),
          ),
        );
      }
      timers.push(
        window.setTimeout(
          () => emitOpportunity("CLOSE", opportunity),
          Math.min(endsAt - now, 2_147_000_000),
        ),
      );
    }

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [data.channel.id, linear, monetizedPlayback]);

  const handleDaiFatal = useCallback(
    (reason: string) => {
      if (monetizedPlayback.mode !== "GOOGLE_DAI_SSB") return;
      trackAnalyticsEvent("TV_SSAI_FALLBACK", {
        channelId: data.channel.id,
        ...(currentVideoId ? { videoId: currentVideoId } : {}),
        metadata: {
          reason,
          assetKey: monetizedPlayback.assetKey,
          networkCode: monetizedPlayback.networkCode,
          providerResourceId: monetizedPlayback.providerResourceId,
          fallback: "CLIENT_IMA_MP4",
        },
      });
      const fallbackOffsetMs = current
        ? Math.min(
            Math.max(0, Date.parse(current.endsAt) - Date.parse(current.startsAt) - 250),
            Math.max(
              0,
              current.playbackOffsetMs +
                Math.max(0, Date.now() - Date.parse(data.schedule.generatedAt)),
            ),
          )
        : 0;
      setSsaiFallback({ occurrenceKey: currentOccurrenceKey ?? null, offsetMs: fallbackOffsetMs });
    },
    [
      current,
      currentOccurrenceKey,
      currentVideoId,
      data.channel.id,
      data.schedule.generatedAt,
      monetizedPlayback,
    ],
  );

  const accent = data.appearance.accentColor ?? "#63D1CC";
  const avatar = mediaAssetUrl(data.appearance.avatar?.objectKey);
  const banner = mediaAssetUrl(data.appearance.banner?.objectKey);
  const initial = data.channel.name.trim().charAt(0).toUpperCase() || "A";
  const style = useMemo(
    () =>
      ({
        "--tv-accent": accent,
        "--tv-avatar": avatar ? `url("${avatar}")` : "none",
        "--tv-banner": banner ? `url("${banner}")` : "none",
      }) as React.CSSProperties,
    [accent, avatar, banner],
  );

  const refreshSchedule = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const [response, nextLinear] = await Promise.all([
        fetch(`${apiBaseUrl}/public/channels/${encodeURIComponent(data.canonicalHandle)}/tv`, {
          cache: "no-store",
        }),
        fetchPublicCreatorTvLinear(data.canonicalHandle),
      ]);
      if (!response.ok) throw new Error("CREATOR_TV_REFRESH_FAILED");
      const nextData = (await response.json()) as PublicCreatorTvResponse;
      if (
        monetizedPlayback.mode === "GOOGLE_DAI_SSB" &&
        nextLinear &&
        selectCreatorTvMonetizedPlayback(nextLinear, false, advertisingConsent.mode).mode !==
          "GOOGLE_DAI_SSB"
      ) {
        const reason =
          nextLinear.monetization.dai.reason ??
          nextLinear.monetization.signaling.reason ??
          "CAPABILITY_DISABLED";
        handleDaiFatal("CAPABILITY_" + reason);
      }
      setData(nextData);
      if (nextLinear) setLinear(nextLinear);
    } catch {
      setRefreshError(t("tv.refreshError"));
    } finally {
      setRefreshing(false);
    }
  }, [
    advertisingConsent.mode,
    data.canonicalHandle,
    handleDaiFatal,
    monetizedPlayback.mode,
    refreshing,
    t,
  ]);

  useEffect(() => {
    if (monetizedPlayback.mode !== "GOOGLE_DAI_SSB") return;
    let cancelled = false;
    const poll = async () => {
      const nextLinear = await fetchPublicCreatorTvLinear(data.canonicalHandle);
      if (cancelled || !nextLinear) return;
      if (
        monetizedPlayback.mode === "GOOGLE_DAI_SSB" &&
        selectCreatorTvMonetizedPlayback(nextLinear, false, advertisingConsent.mode).mode !==
          "GOOGLE_DAI_SSB"
      ) {
        const reason =
          nextLinear.monetization.dai.reason ??
          nextLinear.monetization.signaling.reason ??
          "CAPABILITY_DISABLED";
        handleDaiFatal("CAPABILITY_" + reason);
      }
      setLinear(nextLinear);
    };

    const timer = window.setInterval(() => void poll(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [advertisingConsent.mode, data.canonicalHandle, handleDaiFatal, monetizedPlayback.mode]);

  useEffect(() => {
    if (monetizedPlayback.mode !== "GOOGLE_DAI_SSB" || !current?.endsAt) return;
    const endsAt = Date.parse(current.endsAt);
    if (!Number.isFinite(endsAt)) return;
    const delayMs = Math.min(Math.max(500, endsAt - Date.now() + 250), 2_147_000_000);
    const timer = window.setTimeout(() => {
      void refreshSchedule();
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [current?.endsAt, currentOccurrenceKey, monetizedPlayback.mode, refreshSchedule]);

  if (data.tv.state === "OFF_AIR" || !current) {
    return (
      <main className={styles.page} style={style}>
        <TvHero data={data} initial={initial} locale={locale} />
        <section className={styles.offAir}>
          <div>
            <div className={styles.offAirMark}>{initial}</div>
            <span className={styles.eyebrow}>{t("tv.eyebrow")}</span>
            <h2>{offAirTitle(data.tv.offAirReason, locale)}</h2>
            <p>{offAirMessage(data.tv.offAirReason, data.channel.name, locale)}</p>
            <ActionButton
              className={styles.refreshButton}
              data-tv-focusable="true"
              data-tv-focus-id="creator-tv-refresh"
              pending={refreshing}
              type="button"
              onClick={() => void refreshSchedule()}
            >
              {refreshing ? t("tv.checking") : t("tv.checkAgain")}
            </ActionButton>
            {refreshError ? (
              <StatusNotice tone="danger" announce="polite">
                {refreshError}
              </StatusNotice>
            ) : null}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page} style={style}>
      <TvHero data={data} initial={initial} locale={locale} />
      <div className={styles.layout}>
        <section className={styles.playerCard} aria-labelledby="now-playing-heading">
          {monetizedPlayback.mode === "GOOGLE_DAI_SSB" ? (
            <LiveAyinPlayer
              analyticsEnabled={false}
              autoPlay
              channelId={data.channel.id}
              dvrWindowSeconds={null}
              key={monetizedPlayback.providerResourceId + ":" + monetizedPlayback.assetKey}
              maxReconnectAttempts={2}
              muted
              onFatal={handleDaiFatal}
              playbackUrl={monetizedPlayback.playbackUrl}
              status="LIVE"
              streamId={data.tv.id}
              title={current.video.title}
            />
          ) : mediaUrl ? (
            <AdEnabledAyinPlayer
              autoPlay
              initialPositionMs={progressiveOffsetMs}
              muted
              onNext={() => void refreshSchedule()}
              progressEnabled={false}
              sourceUrl={mediaUrl}
              title={current.video.title}
              upNext={
                data.schedule.upNext
                  ? {
                      title: data.schedule.upNext.video.title,
                      detail: formatTime(data.schedule.upNext.startsAt),
                    }
                  : null
              }
              videoId={current.video.id}
            />
          ) : (
            <div className={styles.offAir}>
              <div>
                <span className={styles.eyebrow}>{t("tv.mediaNeeded")}</span>
                <p>{t("tv.mediaNeededDescription")}</p>
              </div>
            </div>
          )}
          <div className={styles.nowCopy}>
            <span className={styles.liveBadge}>
              <span className={styles.liveDot} /> {t("tv.nowPlaying")}
            </span>
            <h2 id="now-playing-heading">{current.video.title}</h2>
            <p className={styles.meta}>
              {formatTime(current.startsAt, locale)} – {formatTime(current.endsAt, locale)} ·{" "}
              {formatDuration(current.video.durationMs, locale)}
            </p>
            {current.video.description ? <p>{current.video.description}</p> : null}
            <p className={styles.limitation}>
              {monetizedPlayback.mode === "GOOGLE_DAI_SSB"
                ? t("tv.playbackContinuous")
                : t("tv.playbackProgram")}
            </p>
            {refreshError ? (
              <StatusNotice tone="warning" announce="polite">
                {refreshError}
              </StatusNotice>
            ) : null}
          </div>
        </section>

        <aside className={styles.side}>
          <section className={styles.nextCard} aria-labelledby="up-next-heading">
            <span className={styles.eyebrow}>{t("tv.upNext")}</span>
            <h2 id="up-next-heading">{t("tv.comingUp")}</h2>
            {data.schedule.upNext ? (
              <>
                <h3>{data.schedule.upNext.video.title}</h3>
                <p className={styles.meta}>{formatTime(data.schedule.upNext.startsAt, locale)}</p>
              </>
            ) : (
              <p className={styles.muted}>{t("tv.nextPending")}</p>
            )}
          </section>

          <Guide programs={data.schedule.guide} currentKey={current.occurrenceKey} locale={locale} />
        </aside>
      </div>
    </main>
  );
}

function TvHero({
  data,
  initial,
  locale,
}: {
  data: PublicCreatorTvResponse;
  initial: string;
  locale: "en" | "ar";
}) {
  return (
    <header className={styles.hero}>
      <div className={styles.heroInner}>
        <div className={styles.avatar}>{data.appearance.avatar ? null : initial}</div>
        <div>
          <span className={styles.eyebrow}>
            {translatePublicCreator(locale, "tv.automaticEyebrow")}
          </span>
          <h1>{data.tv.name}</h1>
          <Link
            className={styles.channelLink}
            data-tv-focusable="true"
            data-tv-focus-id="creator-tv-channel-link"
            href={hrefForLocale(locale, `/c/${encodeURIComponent(data.canonicalHandle)}`)}
          >
            {data.channel.name} · @{data.canonicalHandle}
          </Link>
        </div>
      </div>
    </header>
  );
}

function Guide({
  programs,
  currentKey,
  locale,
}: {
  programs: CreatorTvProgram[];
  currentKey: string;
  locale: "en" | "ar";
}) {
  const visible = programs.slice(0, 12);
  return (
    <section className={styles.guide} aria-labelledby="guide-heading">
      <span className={styles.eyebrow}>{translatePublicCreator(locale, "tv.linearGuide")}</span>
      <h2 id="guide-heading">{translatePublicCreator(locale, "tv.schedule")}</h2>
      <ol className={styles.guideList}>
        {visible.map((program) => (
          <li className={styles.guideItem} key={program.occurrenceKey}>
            <span className={styles.guideTime}>
              {program.occurrenceKey === currentKey
                ? translatePublicCreator(locale, "tv.now")
                : formatTime(program.startsAt, locale)}
            </span>
            <span>
              <span className={styles.guideTitle}>{program.video.title}</span>
              <span className={styles.videoMeta}>
                {program.source === "ADMIN"
                  ? translatePublicCreator(locale, "tv.scheduledByAyin")
                  : formatDuration(program.video.durationMs, locale)}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function formatTime(value: string, locale: "en" | "ar"): string {
  return formatDate(value, locale, { hour: "numeric", minute: "2-digit" });
}

function formatDuration(value: number | null, locale: "en" | "ar"): string {
  if (!value) return translatePublicCreator(locale, "tv.durationEstimated");
  const totalMinutes = Math.max(1, Math.round(value / 60_000));
  if (totalMinutes < 60) {
    return translatePublicCreator(locale, "tv.minute", {
      count: formatNumber(totalMinutes, locale),
    });
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes
    ? translatePublicCreator(locale, "tv.hoursMinutes", {
        hours: formatNumber(hours, locale),
        minutes: formatNumber(minutes, locale),
      })
    : translatePublicCreator(locale, "tv.hours", { count: formatNumber(hours, locale) });
}

function offAirTitle(
  reason: PublicCreatorTvResponse["tv"]["offAirReason"],
  locale: "en" | "ar",
): string {
  if (reason === "NO_ELIGIBLE_VIDEOS")
    return translatePublicCreator(locale, "tv.offAirNoEligibleTitle");
  if (reason === "TV_DISABLED")
    return translatePublicCreator(locale, "tv.offAirDisabledTitle");
  if (reason === "AUTOMATIC_SCHEDULING_DISABLED")
    return translatePublicCreator(locale, "tv.offAirAutomaticPausedTitle");
  return translatePublicCreator(locale, "tv.offAirDefaultTitle");
}

function offAirMessage(
  reason: PublicCreatorTvResponse["tv"]["offAirReason"],
  channelName: string,
  locale: "en" | "ar",
): string {
  if (reason === "NO_ELIGIBLE_VIDEOS") {
    return translatePublicCreator(locale, "tv.offAirNoEligibleDescription", {
      channel: channelName,
    });
  }
  if (reason === "AUTOMATIC_SCHEDULING_DISABLED") {
    return translatePublicCreator(locale, "tv.offAirAutomaticPausedDescription");
  }
  return translatePublicCreator(locale, "tv.offAirDefaultDescription");
}

function hrefForLocale(locale: "en" | "ar", path: string): string {
  return locale === "ar" ? `/ar${path}` : path;
}
