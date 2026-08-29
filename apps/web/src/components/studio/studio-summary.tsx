"use client";

import { useEffect, useState } from "react";

import styles from "@/app/studio/studio.module.css";
import { getStudioOverview, type StudioOverview } from "@/lib/studio";

export function StudioSummary({ kind }: { kind: "analytics" | "monetization" }) {
  const [data, setData] = useState<StudioOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getStudioOverview()
      .then((overview) => {
        if (active) setData(overview);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Studio summary could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.muted}>Loading…</p>;

  if (kind === "analytics") {
    return (
      <>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Creator Studio</span>
            <h1>Analytics</h1>
            <p className={styles.muted}>Only real metrics are shown. No synthetic views or watch time are invented.</p>
          </div>
        </header>
        <section className={styles.metrics}>
          <article className={styles.metric}>
            <span className={styles.muted}>Subscribers</span>
            <strong>{data.counters.subscribers.toLocaleString()}</strong>
          </article>
          <article className={styles.metric}>
            <span className={styles.muted}>Published videos</span>
            <strong>{data.counters.publishedVideos.toLocaleString()}</strong>
          </article>
          <article className={styles.metric}>
            <span className={styles.muted}>Comments</span>
            <strong>{data.counters.comments.toLocaleString()}</strong>
          </article>
        </section>
        <section className={styles.panel}>
          <h2>Viewing analytics</h2>
          <p className={styles.muted}>{data.analytics.reason}</p>
          <p className={styles.muted}>Views and watch time will populate from Task 22 event analytics rather than guessed counters.</p>
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
          <p className={styles.muted}>Current contract state is real; revenue stays unavailable until attribution exists.</p>
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
