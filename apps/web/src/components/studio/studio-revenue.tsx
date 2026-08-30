"use client";

import { useEffect, useState } from "react";

import styles from "@/app/studio/studio.module.css";
import { getCreatorRevenue, type CreatorRevenueOverview } from "@/lib/revenue";

function money(value: string, currency: string) {
  return `${currency} ${value}`;
}

export function StudioRevenue() {
  const [data, setData] = useState<CreatorRevenueOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getCreatorRevenue()
      .then((result) => {
        if (active) setData(result);
      })
      .catch((caught) => {
        if (active)
          setError(caught instanceof Error ? caught.message : "Revenue could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.muted}>Loading revenue…</p>;

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Creator Studio</span>
          <h1>Monetization</h1>
          <p className={styles.muted}>
            Ledger-backed estimates, finalized earnings and payout records. Payment execution is not
            connected yet.
          </p>
        </div>
      </header>
      <section className={styles.metrics}>
        <article className={styles.metric}>
          <span className={styles.muted}>Estimated Revenue</span>
          <strong>{money(data.estimatedRevenue, data.currency)}</strong>
        </article>
        <article className={styles.metric}>
          <span className={styles.muted}>Finalized Revenue</span>
          <strong>{money(data.finalizedRevenue, data.currency)}</strong>
        </article>
        <article className={styles.metric}>
          <span className={styles.muted}>Available for payout</span>
          <strong>{money(data.availableForPayout, data.currency)}</strong>
        </article>
        <article className={styles.metric}>
          <span className={styles.muted}>Current creator share</span>
          <strong>{(data.contract.revenueShareBps / 100).toFixed(2)}%</strong>
        </article>
      </section>
      <section className={styles.panel}>
        <h2>Revenue by period</h2>
        {data.byPeriod.length ? (
          data.byPeriod.map((row) => (
            <p key={row.period}>
              <strong>{row.period}</strong> · estimated {money(row.estimated, data.currency)} ·
              finalized {money(row.finalized, data.currency)}
            </p>
          ))
        ) : (
          <p className={styles.muted}>No revenue ledger entries yet.</p>
        )}
      </section>
      <section className={styles.panel}>
        <h2>Revenue by video</h2>
        {data.byVideo.length ? (
          data.byVideo.map((row) => (
            <p key={row.videoId}>
              <strong>{row.title}</strong> · estimated {money(row.estimated, data.currency)} ·
              finalized {money(row.finalized, data.currency)}
            </p>
          ))
        ) : (
          <p className={styles.muted}>No video-attributed revenue yet.</p>
        )}
      </section>
      <section className={styles.panel}>
        <h2>Payout history</h2>
        {data.payouts.length ? (
          data.payouts.map((payout) => (
            <p key={payout.id}>
              <strong>{money(payout.amount, payout.currency)}</strong> · {payout.status} ·{" "}
              {new Date(payout.requestedAt).toLocaleDateString()}
            </p>
          ))
        ) : (
          <p className={styles.muted}>No payout records yet.</p>
        )}
      </section>
    </>
  );
}
