"use client";

import { useCallback, useEffect, useState } from "react";

import styles from "@/app/studio/studio.module.css";
import {
  downloadCreatorStatement,
  getCreatorMonetizationAnalytics,
  type CreatorMonetizationAnalytics,
} from "@/lib/revenue";

function money(currency: string, value: string | null) {
  if (value === null) return "Unavailable";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return `${currency} ${value}`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${currency} ${numeric.toFixed(2)}`;
  }
}

export function StudioMonetizationInsights() {
  const [analytics, setAnalytics] = useState<CreatorMonetizationAnalytics | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    try {
      setAnalytics(await getCreatorMonetizationAnalytics());
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Monetization analytics could not be loaded.",
      );
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function downloadStatement() {
    setDownloading(true);
    setError("");
    setMessage("");
    try {
      const statement = await downloadCreatorStatement();
      setMessage(`Statement generated ${new Date(statement.generatedAt).toLocaleString()}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The statement could not be generated.");
    } finally {
      setDownloading(false);
    }
  }

  if (!analytics && !error) {
    return <p className={styles.muted}>Loading monetization analytics…</p>;
  }

  if (!analytics) {
    return <p className={styles.error}>{error || "Monetization analytics are unavailable."}</p>;
  }

  const metrics = [
    ["Finalized · 30 days", money(analytics.currency, analytics.finalizedRevenue30d)],
    ["Creator RPM", money(analytics.currency, analytics.creatorRpm)],
    ["Creator CPM", money(analytics.currency, analytics.creatorCpm)],
    ["Video starts", analytics.videoStarts.toLocaleString()],
    ["Monetized ad starts", analytics.monetizedAdStarts.toLocaleString()],
  ];

  return (
    <section aria-labelledby="monetization-insights-heading" style={{ marginTop: 28 }}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Monetization Analytics</span>
          <h2 id="monetization-insights-heading">Performance & statements</h2>
          <p className={styles.muted}>
            Query-time creator revenue performance using attributable AYIN ledger and analytics
            data.
          </p>
        </div>
        <button
          className={styles.primary}
          disabled={downloading}
          onClick={() => void downloadStatement()}
          type="button"
        >
          {downloading ? "Generating…" : "Download CSV statement"}
        </button>
      </header>

      {message ? <p className={styles.notice}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {analytics.mixedCurrency ? (
        <p className={styles.notice}>
          Multiple currencies exist in the ledger. Metrics below use {analytics.currency} entries
          only and do not perform synthetic FX conversion.
        </p>
      ) : null}

      <div className={styles.metrics}>
        {metrics.map(([label, value]) => (
          <article className={styles.metric} key={label}>
            <span className={styles.muted}>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <h2>Daily revenue</h2>
          <p className={styles.muted}>
            Recent attributable estimated and finalized creator earnings.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Estimated</th>
                  <th>Finalized</th>
                </tr>
              </thead>
              <tbody>
                {analytics.byDay.slice(0, 30).map((row) => (
                  <tr key={row.day}>
                    <td>{new Date(`${row.day}T00:00:00Z`).toLocaleDateString()}</td>
                    <td>{money(analytics.currency, row.estimated)}</td>
                    <td>{money(analytics.currency, row.finalized)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!analytics.byDay.length ? (
            <p className={styles.muted}>No attributable daily revenue is available yet.</p>
          ) : null}
        </section>

        <section className={styles.panel}>
          <h2>Revenue by ad source</h2>
          <p className={styles.muted}>
            Only source labels present in trusted ledger records are shown.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Estimated</th>
                  <th>Finalized</th>
                </tr>
              </thead>
              <tbody>
                {analytics.byAdSource.map((row) => (
                  <tr key={row.source}>
                    <td>{row.source}</td>
                    <td>{money(analytics.currency, row.estimated)}</td>
                    <td>{money(analytics.currency, row.finalized)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!analytics.byAdSource.length ? (
            <p className={styles.muted}>No ad-source revenue attribution is available yet.</p>
          ) : null}
        </section>
      </div>

      <div className={styles.grid} style={{ marginTop: 18 }}>
        <section className={styles.panel}>
          <h2>Country attribution</h2>
          <span className={styles.statusPill}>
            {analytics.countryRevenueAttribution.available ? "Available" : "Not available"}
          </span>
          <p className={styles.muted}>{analytics.countryRevenueAttribution.reason}</p>
        </section>
        <section className={styles.panel}>
          <h2>Payout timing</h2>
          <strong>{analytics.estimatedPayoutDate ?? "No guaranteed payout date"}</strong>
          <p className={styles.muted}>{analytics.payoutTimingReason}</p>
        </section>
      </div>
    </section>
  );
}
