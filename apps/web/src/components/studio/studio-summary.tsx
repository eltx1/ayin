"use client";

import { useEffect, useState } from "react";

import styles from "@/app/studio/studio.module.css";
import {
  getStudioAnalytics,
  getStudioOverview,
  type StudioAnalytics,
  type StudioOverview,
} from "@/lib/studio";

export function StudioSummary({ kind }: { kind: "analytics" | "monetization" }) {
  const [data, setData] = useState<StudioOverview | null>(null);
  const [analytics, setAnalytics] = useState<StudioAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const request =
      kind === "analytics"
        ? Promise.all([getStudioOverview(), getStudioAnalytics()])
        : Promise.all([getStudioOverview(), Promise.resolve(null)]);
    void request
      .then(([overview, nextAnalytics]) => {
        if (!active) return;
        setData(overview);
        setAnalytics(nextAnalytics);
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof Error ? caught.message : "Studio summary could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [kind]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!data || (kind === "analytics" && !analytics)) {
    return <p className={styles.muted}>Loading…</p>;
  }

  if (kind === "analytics" && analytics) {
    return (
      <>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Creator Studio</span>
            <h1>Analytics</h1>
            <p className={styles.muted}>
              Real sampled event metrics for the last {analytics.periodDays} days. Refresh is
              query-time, not realtime streaming.
            </p>
          </div>
        </header>
        <section className={styles.metrics}>
          <article className={styles.metric}>
            <span className={styles.muted}>Views</span>
            <strong>{analytics.views.toLocaleString()}</strong>
          </article>
          <article className={styles.metric}>
            <span className={styles.muted}>Watch time</span>
            <strong>{(analytics.watchTimeMs / 3_600_000).toFixed(1)} h</strong>
          </article>
          <article className={styles.metric}>
            <span className={styles.muted}>Avg view duration</span>
            <strong>{Math.round(analytics.averageViewDurationMs / 1000)} s</strong>
          </article>
          <article className={styles.metric}>
            <span className={styles.muted}>Completion</span>
            <strong>{(analytics.completionRate * 100).toFixed(1)}%</strong>
          </article>
          <article className={styles.metric}>
            <span className={styles.muted}>Subscribers</span>
            <strong>{analytics.subscribers.toLocaleString()}</strong>
          </article>
        </section>
        <section className={styles.panel}>
          <h2>Top videos</h2>
          {analytics.topVideos.length ? (
            analytics.topVideos.map((video) => (
              <p key={video.videoId}>
                <strong>{video.title}</strong> · {video.views.toLocaleString()} views
              </p>
            ))
          ) : (
            <p className={styles.muted}>No viewing events have been recorded in this period yet.</p>
          )}
        </section>
      </>
    );
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Creator Studio</span>
          <h1>Monetization</h1>
          <p className={styles.muted}>
            Current contract state is real; revenue stays unavailable until attribution exists.
          </p>
        </div>
      </header>
      <section className={styles.panel}>
        <p>
          Contract status: <strong>{data.monetization.contractStatus}</strong>
        </p>
        <p>
          Creator revenue share:{" "}
          <strong>
            {data.monetization.revenueShareBps === null
              ? "Not configured"
              : `${(data.monetization.revenueShareBps / 100).toFixed(2)}%`}
          </strong>
        </p>
        <p className={styles.muted}>{data.monetization.reason}</p>
      </section>
    </>
  );
}
