"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "@/app/studio/studio.module.css";
import { getStudioAnalytics } from "@/lib/studio";

type Breakdown = {
  available: boolean;
  coverage: number;
  items: Array<{ value: string; count: number }>;
};

type CohortMilestone = {
  retainedProfiles: number;
  retentionRate: number;
  sessions: number;
  sessionsPerRetainedProfile: number;
  watchTimeMs: number;
  averageWatchTimeMsPerRetainedProfile: number;
  contentReturnProfiles?: number;
  contentReturnRate?: number;
};

type CreatorAnalytics = {
  periodDays: number;
  dateRange: { from: string; to: string; timezone: "UTC" };
  refresh: "rollup";
  lastRollupCheck: string | null;
  freshnessNote: string;
  views: number;
  uniqueViewersApprox: number;
  uniqueViewerMethod: string;
  watchTimeMs: number;
  averageViewDurationMs: number;
  completionRate: number;
  subscribersGained: number;
  subscribersTotal: number;
  retention: {
    available: boolean;
    coverage: number;
    buckets: Array<{
      bucket: string;
      threshold: number;
      viewers: number;
      rate: number;
    }>;
  };
  trafficSources: Breakdown;
  devices: Breakdown;
  geography: Breakdown & { note: string };
  topVideos: Array<{ videoId: string; title: string; views: number }>;
  playbackQuality: {
    available: boolean;
    protocols: Breakdown;
    startup: {
      available: boolean;
      sampleCount: number;
      averageMs: number | null;
    };
    buffering: {
      events: number;
      measuredDurationSamples: number;
      totalDurationMs: number;
      averageDurationMs: number | null;
      eventsPerView: number;
    };
    hlsFatalEvents: number;
    mp4FallbackEvents: number;
    qualitySwitchEvents: number;
  };
  advertising: {
    available: boolean;
    opportunities: number | null;
    fills: number | null;
    fillRate: number | null;
    note: string;
  };
  cohorts: {
    minimumCohortSize: number;
    identityScope: "SIGNED_IN_PROFILE_PSEUDONYMS";
    privacyNote: string;
    audienceDaily: Array<{
      date: string;
      activeProfiles: number;
      newProfiles: number;
      returningProfiles: number;
      returningRate: number;
      sessions: number;
      sessionsPerActiveProfile: number;
      watchTimeMs: number;
      contentReturnProfiles: number;
      contentReturnRate: number;
    }>;
    retention: Array<{
      cohortDate: string;
      cohortSize: number;
      d1: CohortMilestone | null;
      d7: CohortMilestone | null;
      d30: CohortMilestone | null;
    }>;
    subscriberTrackingStartedAt: string | null;
    subscriberRetention: Array<{
      cohortDate: string;
      cohortSize: number;
      d1: CohortMilestone | null;
      d7: CohortMilestone | null;
      d30: CohortMilestone | null;
    }>;
  };
};

type AnalyticsTab = "overview" | "content" | "audience" | "engagement" | "playback";

const tabs: Array<{ key: AnalyticsTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "content", label: "Content" },
  { key: "audience", label: "Audience" },
  { key: "engagement", label: "Engagement" },
  { key: "playback", label: "Playback quality" },
];

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function duration(ms: number) {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remaining}s` : `${remaining}s`;
}

function BreakdownPanel({
  title,
  breakdown,
  empty,
}: {
  title: string;
  breakdown: Breakdown;
  empty: string;
}) {
  return (
    <section className={styles.panel}>
      <h2>{title}</h2>
      {breakdown.available ? (
        <>
          <p className={styles.muted}>Measured coverage: {percent(breakdown.coverage)}</p>
          {breakdown.items.map((item) => (
            <p key={item.value}>
              <strong>{item.value}</strong> · {item.count.toLocaleString()}
            </p>
          ))}
        </>
      ) : (
        <p className={styles.muted}>{empty}</p>
      )}
    </section>
  );
}

export function StudioCreatorAnalytics() {
  const [days, setDays] = useState(28);
  const [tab, setTab] = useState<AnalyticsTab>("overview");
  const [loadState, setLoadState] = useState<{
    days: number;
    data: CreatorAnalytics | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void getStudioAnalytics(days)
      .then((result) => {
        if (active) {
          setLoadState({
            days,
            data: result as unknown as CreatorAnalytics,
            error: null,
          });
        }
      })
      .catch((caught) => {
        if (active) {
          setLoadState({
            days,
            data: null,
            error: caught instanceof Error ? caught.message : "Analytics could not be loaded.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [days]);

  const currentLoadState = loadState?.days === days ? loadState : null;
  const data = currentLoadState?.data ?? null;
  const error = currentLoadState?.error ?? null;
  const loading = currentLoadState === null;

  const rangeLabel = useMemo(() => {
    if (!data) return "";
    const format = new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: data.dateRange.timezone,
    });
    return `${format.format(new Date(data.dateRange.from))} – ${format.format(
      new Date(data.dateRange.to),
    )} (${data.dateRange.timezone})`;
  }, [data]);

  if (error) return <p className={styles.error}>{error}</p>;

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Creator Studio</span>
          <h1>Analytics</h1>
          <p className={styles.muted}>
            Persisted UTC rollups built from raw analytics; not realtime.{" "}
            {data?.freshnessNote ?? "Loading measured data…"}
          </p>
          {data ? <p className={styles.muted}>Date range: {rangeLabel}</p> : null}
        </div>
        <label>
          <span className={styles.muted}>Range </span>
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={28}>Last 28 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last 365 days</option>
          </select>
        </label>
      </header>

      <nav aria-label="Analytics sections" className={styles.panel}>
        {tabs.map((item) => (
          <button
            aria-pressed={tab === item.key}
            key={item.key}
            onClick={() => setTab(item.key)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>

      {loading || !data ? <p className={styles.muted}>Loading measured analytics…</p> : null}

      {!loading && data && tab === "overview" ? (
        <>
          <section className={styles.metrics}>
            <article className={styles.metric}>
              <span className={styles.muted}>Views</span>
              <strong>{data.views.toLocaleString()}</strong>
            </article>
            <article className={styles.metric}>
              <span className={styles.muted}>Unique viewers (approx.)</span>
              <strong>{data.uniqueViewersApprox.toLocaleString()}</strong>
            </article>
            <article className={styles.metric}>
              <span className={styles.muted}>Watch time</span>
              <strong>{(data.watchTimeMs / 3_600_000).toFixed(1)} h</strong>
            </article>
            <article className={styles.metric}>
              <span className={styles.muted}>Average view duration</span>
              <strong>{duration(data.averageViewDurationMs)}</strong>
            </article>
            <article className={styles.metric}>
              <span className={styles.muted}>Completion rate</span>
              <strong>{percent(data.completionRate)}</strong>
            </article>
            <article className={styles.metric}>
              <span className={styles.muted}>Subscribers gained</span>
              <strong>{data.subscribersGained.toLocaleString()}</strong>
            </article>
          </section>
          <section className={styles.panel}>
            <h2>Data quality</h2>
            <p>{data.uniqueViewerMethod}</p>
            <p className={styles.muted}>
              Watch time is accumulated from persisted progress checkpoints. Coverage-dependent
              metrics explicitly show measured coverage.
            </p>
          </section>
        </>
      ) : null}

      {!loading && data && tab === "content" ? (
        <section className={styles.panel}>
          <h2>Top videos</h2>
          {data.topVideos.length ? (
            data.topVideos.map((video) => (
              <p key={video.videoId}>
                <strong>{video.title}</strong> · {video.views.toLocaleString()} views
              </p>
            ))
          ) : (
            <p className={styles.muted}>No measured video starts exist in this date range.</p>
          )}
        </section>
      ) : null}

      {!loading && data && tab === "audience" ? (
        <>
          <BreakdownPanel
            title="Traffic sources"
            breakdown={data.trafficSources}
            empty="Traffic-source categories were not measured for this period."
          />
          <BreakdownPanel
            title="Device classes"
            breakdown={data.devices}
            empty="Device-class telemetry is unavailable for this period."
          />
          <BreakdownPanel
            title="Coarse geography"
            breakdown={data.geography}
            empty={data.geography.note}
          />
          <section className={styles.panel}>
            <p className={styles.muted}>{data.geography.note}</p>
          </section>
          <section className={styles.panel}>
            <h2>Audience return cohorts</h2>
            <p className={styles.muted}>{data.cohorts.privacyNote}</p>
            <p className={styles.muted}>
              Minimum exposed cohort: {data.cohorts.minimumCohortSize.toLocaleString()} profiles.
            </p>
            {data.cohorts.retention.length ? (
              data.cohorts.retention.slice(-8).map((cohort) => (
                <p key={cohort.cohortDate}>
                  <strong>{new Date(cohort.cohortDate).toLocaleDateString()}</strong> ·{" "}
                  {cohort.cohortSize.toLocaleString()} profiles · D1{" "}
                  {cohort.d1 ? percent(cohort.d1.retentionRate) : "pending"} · D7{" "}
                  {cohort.d7 ? percent(cohort.d7.retentionRate) : "pending"} · D30{" "}
                  {cohort.d30 ? percent(cohort.d30.retentionRate) : "pending"}
                </p>
              ))
            ) : (
              <p className={styles.muted}>
                No audience cohort is large enough to expose for this period.
              </p>
            )}
          </section>
          <section className={styles.panel}>
            <h2>New vs returning audience</h2>
            {data.cohorts.audienceDaily.length ? (
              data.cohorts.audienceDaily.slice(-7).map((row) => (
                <p key={row.date}>
                  <strong>{new Date(row.date).toLocaleDateString()}</strong> ·{" "}
                  {row.newProfiles.toLocaleString()} new ·{" "}
                  {row.returningProfiles.toLocaleString()} returning ·{" "}
                  {row.sessionsPerActiveProfile.toFixed(2)} sessions/profile ·{" "}
                  {percent(row.contentReturnRate)} returned to previously watched content
                </p>
              ))
            ) : (
              <p className={styles.muted}>
                Daily audience rows are suppressed until the privacy threshold is met.
              </p>
            )}
          </section>
        </>
      ) : null}

      {!loading && data && tab === "engagement" ? (
        <>
          <section className={styles.metrics}>
            <article className={styles.metric}>
              <span className={styles.muted}>Subscribers gained</span>
              <strong>{data.subscribersGained.toLocaleString()}</strong>
            </article>
            <article className={styles.metric}>
              <span className={styles.muted}>Subscribers total</span>
              <strong>{data.subscribersTotal.toLocaleString()}</strong>
            </article>
          </section>
          <section className={styles.panel}>
            <h2>Subscriber retention cohorts</h2>
            <p className={styles.muted}>
              Available only for subscription cohorts recorded after cohort tracking started
              {data.cohorts.subscriberTrackingStartedAt
                ? ` on ${new Date(data.cohorts.subscriberTrackingStartedAt).toLocaleDateString()}`
                : ""}.
            </p>
            {data.cohorts.subscriberRetention.length ? (
              data.cohorts.subscriberRetention.slice(-8).map((cohort) => (
                <p key={cohort.cohortDate}>
                  <strong>{new Date(cohort.cohortDate).toLocaleDateString()}</strong> ·{" "}
                  {cohort.cohortSize.toLocaleString()} subscribers · D1{" "}
                  {cohort.d1 ? percent(cohort.d1.retentionRate) : "pending"} · D7{" "}
                  {cohort.d7 ? percent(cohort.d7.retentionRate) : "pending"} · D30{" "}
                  {cohort.d30 ? percent(cohort.d30.retentionRate) : "pending"}
                </p>
              ))
            ) : (
              <p className={styles.muted}>
                No subscriber cohort is currently large enough and mature enough to expose.
              </p>
            )}
          </section>
          <section className={styles.panel}>
            <h2>Audience retention</h2>
            {data.retention.available ? (
              <>
                <p className={styles.muted}>
                  Eligible-duration coverage: {percent(data.retention.coverage)}
                </p>
                {data.retention.buckets.map((bucket) => (
                  <p key={bucket.bucket}>
                    <strong>{bucket.bucket}</strong> · {percent(bucket.rate)} ·{" "}
                    {bucket.viewers.toLocaleString()} sessions
                  </p>
                ))}
              </>
            ) : (
              <p className={styles.muted}>
                Retention is unavailable until duration-backed progress telemetry exists.
              </p>
            )}
          </section>
        </>
      ) : null}

      {!loading && data && tab === "playback" ? (
        <>
          <BreakdownPanel
            title="HLS / MP4 starts"
            breakdown={data.playbackQuality.protocols}
            empty="Playback-protocol telemetry is unavailable for this period."
          />
          <section className={styles.metrics}>
            <article className={styles.metric}>
              <span className={styles.muted}>Average startup</span>
              <strong>
                {data.playbackQuality.startup.averageMs === null
                  ? "Unavailable"
                  : `${data.playbackQuality.startup.averageMs} ms`}
              </strong>
            </article>
            <article className={styles.metric}>
              <span className={styles.muted}>Buffer events</span>
              <strong>{data.playbackQuality.buffering.events.toLocaleString()}</strong>
            </article>
            <article className={styles.metric}>
              <span className={styles.muted}>HLS fatal events</span>
              <strong>{data.playbackQuality.hlsFatalEvents.toLocaleString()}</strong>
            </article>
            <article className={styles.metric}>
              <span className={styles.muted}>MP4 fallbacks</span>
              <strong>{data.playbackQuality.mp4FallbackEvents.toLocaleString()}</strong>
            </article>
          </section>
          <section className={styles.panel}>
            <h2>Buffering detail</h2>
            <p>Events per view: {data.playbackQuality.buffering.eventsPerView.toFixed(3)}</p>
            <p>
              Measured duration samples:{" "}
              {data.playbackQuality.buffering.measuredDurationSamples.toLocaleString()}
            </p>
            <p className={styles.muted}>
              {data.playbackQuality.buffering.averageDurationMs === null
                ? "Buffer duration is not estimated when duration samples are absent."
                : `Average measured buffer duration: ${data.playbackQuality.buffering.averageDurationMs} ms.`}
            </p>
          </section>
          <section className={styles.panel}>
            <h2>Ad opportunity / fill telemetry</h2>
            {data.advertising.available ? (
              <p>
                <strong>{data.advertising.opportunities?.toLocaleString()}</strong> measured
                requests · <strong>{data.advertising.fills?.toLocaleString()}</strong> fills ·{" "}
                <strong>
                  {data.advertising.fillRate === null
                    ? "Unavailable"
                    : percent(data.advertising.fillRate)}
                </strong>{" "}
                fill rate
              </p>
            ) : null}
            <p className={styles.muted}>{data.advertising.note}</p>
          </section>
        </>
      ) : null}
    </>
  );
}
