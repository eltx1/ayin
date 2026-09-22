"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AdEnabledAyinPlayer } from "@/components/player/ad-enabled-ayin-player";
import { LiveAyinPlayer } from "@/components/player/live-ayin-player";
import { trackAnalyticsEvent } from "@/lib/analytics";
import { apiBaseUrl } from "@/lib/api";
import { mediaAssetUrl } from "@/lib/channel";
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
  const [data, setData] = useState(initialData);
  const [linear, setLinear] = useState(initialLinear);
  const [ssaiFallback, setSsaiFallback] = useState<{
    occurrenceKey: string | null;
    offsetMs: number;
  } | null>(null);
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
    () => selectCreatorTvMonetizedPlayback(linear, ssaiFailed),
    [linear, ssaiFailed],
  );
  const progressiveOffsetMs =
    ssaiFallback?.occurrenceKey === currentOccurrenceKey
      ? ssaiFallback.offsetMs
      : (current?.playbackOffsetMs ?? 0);

  useEffect(() => {
    if (monetizedPlayback.mode !== "GOOGLE_DAI_SSB") return;
    const identity =
      monetizedPlayback.providerResourceId + ":" + monetizedPlayback.assetKey;
    if (selectedSsaiRef.current === identity) return;
    selectedSsaiRef.current = identity;
    trackAnalyticsEvent("TV_SSAI_SELECTED", {
      channelId: data.channel.id,
      videoId: currentVideoId ?? undefined,
      metadata: {
        provider: "GOOGLE_AD_MANAGER_DAI",
        integration: "SSB",
        assetKey: monetizedPlayback.assetKey,
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
        videoId: currentVideoId ?? undefined,
        metadata: {
          reason,
          assetKey: monetizedPlayback.assetKey,
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
    [current, currentOccurrenceKey, currentVideoId, data.channel.id, data.schedule.generatedAt, monetizedPlayback],
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
        fetch(
          `${apiBaseUrl}/public/channels/${encodeURIComponent(data.canonicalHandle)}/tv`,
          { cache: "no-store" },
        ),
        fetchPublicCreatorTvLinear(data.canonicalHandle),
      ]);
      if (!response.ok) throw new Error("Creator TV could not refresh its guide.");
      setData((await response.json()) as PublicCreatorTvResponse);
      setLinear(nextLinear);
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Creator TV could not refresh.");
    } finally {
      setRefreshing(false);
    }
  }, [data.canonicalHandle, refreshing]);

  if (data.tv.state === "OFF_AIR" || !current) {
    return (
      <main className={styles.page} style={style}>
        <TvHero data={data} initial={initial} />
        <section className={styles.offAir}>
          <div>
            <div className={styles.offAirMark}>{initial}</div>
            <span className={styles.eyebrow}>AYIN Creator TV</span>
            <h2>{offAirTitle(data.tv.offAirReason)}</h2>
            <p>{offAirMessage(data.tv.offAirReason, data.channel.name)}</p>
            <button
              className={styles.refreshButton}
              type="button"
              onClick={() => void refreshSchedule()}
            >
              {refreshing ? "Checking…" : "Check again"}
            </button>
            {refreshError ? <p className={styles.error}>{refreshError}</p> : null}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page} style={style}>
      <TvHero data={data} initial={initial} />
      <div className={styles.layout}>
        <section className={styles.playerCard} aria-labelledby="now-playing-heading">
          {monetizedPlayback.mode === "GOOGLE_DAI_SSB" ? (
            <LiveAyinPlayer
              autoPlay
              channelId={data.channel.id}
              dvrWindowSeconds={null}
              key={monetizedPlayback.providerResourceId + ":" + monetizedPlayback.assetKey}
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
                <span className={styles.eyebrow}>Media configuration needed</span>
                <p>AYIN knows what is on air, but this client has no media delivery base URL.</p>
              </div>
            </div>
          )}
          <div className={styles.nowCopy}>
            <span className={styles.liveBadge}>
              <span className={styles.liveDot} /> Now Playing
            </span>
            <h2 id="now-playing-heading">{current.video.title}</h2>
            <p className={styles.meta}>
              {formatTime(current.startsAt)} – {formatTime(current.endsAt)} ·{" "}
              {formatDuration(current.video.durationMs)}
            </p>
            {current.video.description ? <p>{current.video.description}</p> : null}
            <p className={styles.limitation}>
              {monetizedPlayback.mode === "GOOGLE_DAI_SSB"
                ? "Playing the continuous linear HLS stream with server-side ad insertion."
                : data.playback.limitation}
            </p>
            {refreshError ? <p className={styles.error}>{refreshError}</p> : null}
          </div>
        </section>

        <aside className={styles.side}>
          <section className={styles.nextCard} aria-labelledby="up-next-heading">
            <span className={styles.eyebrow}>Up Next</span>
            <h2 id="up-next-heading">Coming up</h2>
            {data.schedule.upNext ? (
              <>
                <h3>{data.schedule.upNext.video.title}</h3>
                <p className={styles.meta}>{formatTime(data.schedule.upNext.startsAt)}</p>
              </>
            ) : (
              <p className={styles.muted}>The next program will appear when the guide refreshes.</p>
            )}
          </section>

          <Guide programs={data.schedule.guide} currentKey={current.occurrenceKey} />
        </aside>
      </div>
    </main>
  );
}

function TvHero({ data, initial }: { data: PublicCreatorTvResponse; initial: string }) {
  return (
    <header className={styles.hero}>
      <div className={styles.heroInner}>
        <div className={styles.avatar}>{data.appearance.avatar ? null : initial}</div>
        <div>
          <span className={styles.eyebrow}>Automatic Creator TV</span>
          <h1>{data.tv.name}</h1>
          <Link
            className={styles.channelLink}
            href={`/c/${encodeURIComponent(data.canonicalHandle)}`}
          >
            {data.channel.name} · @{data.canonicalHandle}
          </Link>
        </div>
      </div>
    </header>
  );
}

function Guide({ programs, currentKey }: { programs: CreatorTvProgram[]; currentKey: string }) {
  const visible = programs.slice(0, 12);
  return (
    <section className={styles.guide} aria-labelledby="guide-heading">
      <span className={styles.eyebrow}>Linear guide</span>
      <h2 id="guide-heading">Schedule</h2>
      <ol className={styles.guideList}>
        {visible.map((program) => (
          <li className={styles.guideItem} key={program.occurrenceKey}>
            <span className={styles.guideTime}>
              {program.occurrenceKey === currentKey ? "Now" : formatTime(program.startsAt)}
            </span>
            <span>
              <span className={styles.guideTitle}>{program.video.title}</span>
              <span className={styles.videoMeta}>
                {program.source === "ADMIN"
                  ? "Scheduled by AYIN"
                  : formatDuration(program.video.durationMs)}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
}

function formatDuration(value: number | null): string {
  if (!value) return "Duration estimated for guide";
  const totalMinutes = Math.max(1, Math.round(value / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function offAirTitle(reason: PublicCreatorTvResponse["tv"]["offAirReason"]): string {
  if (reason === "NO_ELIGIBLE_VIDEOS") return "Programming starts with the first eligible video";
  if (reason === "TV_DISABLED") return "This TV is currently unavailable";
  if (reason === "AUTOMATIC_SCHEDULING_DISABLED") return "Automatic programming is paused";
  return "Off air for now";
}

function offAirMessage(
  reason: PublicCreatorTvResponse["tv"]["offAirReason"],
  channelName: string,
): string {
  if (reason === "NO_ELIGIBLE_VIDEOS") {
    return `${channelName} TV is ready. Published public MP4 videos will automatically enter this continuous rotation.`;
  }
  if (reason === "AUTOMATIC_SCHEDULING_DISABLED") {
    return "The channel remains branded and ready while automatic programming is disabled.";
  }
  return "This Creator TV keeps its channel identity while programming is unavailable.";
}
