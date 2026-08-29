"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { AyinPlayer } from "@/components/player/ayin-player";
import { apiBaseUrl } from "@/lib/api";
import { mediaAssetUrl } from "@/lib/channel";
import type { CreatorTvProgram, PublicCreatorTvResponse } from "@/lib/creator-tv";

import styles from "./creator-tv.module.css";

export function CreatorTvPlayer({ initialData }: { initialData: PublicCreatorTvResponse }) {
  const [data, setData] = useState(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const current = data.schedule.nowPlaying;
  const mediaUrl = mediaAssetUrl(current?.video.source.objectKey);
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
      const response = await fetch(
        `${apiBaseUrl}/public/channels/${encodeURIComponent(data.canonicalHandle)}/tv`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Creator TV could not refresh its guide.");
      setData((await response.json()) as PublicCreatorTvResponse);
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
          {mediaUrl ? (
            <AyinPlayer
              autoPlay
              initialPositionMs={current.playbackOffsetMs}
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
            <p className={styles.limitation}>{data.playback.limitation}</p>
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
