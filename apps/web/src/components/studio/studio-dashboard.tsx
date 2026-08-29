"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "@/app/studio/studio.module.css";
import { getStudioOverview, type StudioOverview } from "@/lib/studio";

export function StudioDashboard() {
  const [data, setData] = useState<StudioOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getStudioOverview()
      .then((overview) => {
        if (active) setData(overview);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Studio could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.muted}>Loading Studio…</p>;

  const metrics = [
    ["Videos", data.counters.videos],
    ["Published", data.counters.publishedVideos],
    ["Subscribers", data.counters.subscribers],
    ["Comments", data.counters.comments],
    ["Playlists", data.counters.playlists],
  ] as const;

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Creator Studio</span>
          <h1>{data.channel.name}</h1>
          <p className={styles.muted}>Manage your channel without adding friction to Quick Upload.</p>
        </div>
        <Link className={styles.primary} href="/upload">
          Quick upload
        </Link>
      </header>

      <section aria-label="Channel counters" className={styles.metrics}>
        {metrics.map(([label, value]) => (
          <article className={styles.metric} key={label}>
            <span className={styles.muted}>{label}</span>
            <strong>{value.toLocaleString()}</strong>
          </article>
        ))}
      </section>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <h2>Recent uploads</h2>
          {data.recentUploads.length ? (
            <ul className={styles.list}>
              {data.recentUploads.map((video) => (
                <li key={video.id}>
                  <span>{video.title}</span>
                  <span className={styles.muted}>{video.status.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>No uploads yet. Quick Upload stays one click away.</p>
          )}
          <div className={styles.actions}>
            <Link className={styles.secondary} href="/studio/content">
              Manage content
            </Link>
          </div>
        </section>

        <section className={styles.panel}>
          <h2>Analytics</h2>
          {data.analytics.available ? (
            <p className={styles.muted}>Analytics are available.</p>
          ) : (
            <p className={styles.muted}>{data.analytics.reason}</p>
          )}
          <Link className={styles.secondary} href="/studio/analytics">
            Open analytics
          </Link>
        </section>

        <section className={styles.panel}>
          <h2>Monetization</h2>
          <p>
            Contract status: <strong>{data.monetization.contractStatus}</strong>
          </p>
          {data.monetization.revenueShareBps === null ? null : (
            <p className={styles.muted}>
              Creator share: {(data.monetization.revenueShareBps / 100).toFixed(2)}%
            </p>
          )}
          <p className={styles.muted}>{data.monetization.reason}</p>
          <Link className={styles.secondary} href="/studio/monetization">
            View summary
          </Link>
        </section>

        <section className={styles.panel}>
          <h2>Creator TV</h2>
          <p className={styles.muted}>Your automatically created TV channel remains managed separately from upload.</p>
          <Link className={styles.secondary} href="/studio/tv">
            Manage TV
          </Link>
        </section>
      </div>
    </>
  );
}
