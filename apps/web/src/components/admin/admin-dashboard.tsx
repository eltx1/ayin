"use client";

import { useEffect, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import {
  getAdminAnalytics,
  getAdminDashboard,
  type AdminAnalyticsMetrics,
} from "@/lib/admin-control";

interface DashboardData {
  accounts: number;
  activeAccounts: number;
  channels: number;
  videos: number;
  publishedVideos: number;
  tvChannels: number;
  openReports: number;
  openCases: number;
  analytics: { watchTimeMs: null; revenue: null; available: boolean; reason: string };
}

export function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [analytics, setAnalytics] = useState<AdminAnalyticsMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([getAdminDashboard(), getAdminAnalytics()])
      .then(([body, nextAnalytics]) => {
        if (!active) return;
        setData(body as unknown as DashboardData);
        setAnalytics(nextAnalytics);
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof Error ? caught.message : "Admin dashboard could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!data || !analytics) return <p className={styles.muted}>Loading Admin…</p>;

  const metrics = [
    ["Accounts", data.accounts],
    ["Active accounts", data.activeAccounts],
    ["Channels", data.channels],
    ["Videos", data.videos],
    ["Published", data.publishedVideos],
    ["Creator TVs", data.tvChannels],
    ["Open reports", data.openReports],
    ["Open cases", data.openCases],
  ] as const;

  const analyticsMetrics = [
    ["DAU approx", analytics.dauApprox.toLocaleString()],
    ["MAU approx", analytics.mauApprox.toLocaleString()],
    ["Watch hours / 30d", analytics.watchHours.toFixed(1)],
    ["Uploads / 30d", analytics.uploads.toLocaleString()],
    ["TV starts / 30d", analytics.tvStarts.toLocaleString()],
    ["Ad events / 30d", analytics.adEvents.toLocaleString()],
    ["Tracked errors / 30d", analytics.errors.toLocaleString()],
  ] as const;

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Control Plane</span>
          <h1>AYIN Admin</h1>
          <p className={styles.muted}>
            Operational control with server-side authorization and audit logs.
          </p>
        </div>
      </header>
      <section aria-label="Platform counters" className={styles.metrics}>
        {metrics.map(([label, value]) => (
          <article className={styles.metric} key={label}>
            <span className={styles.muted}>{label}</span>
            <strong>{value.toLocaleString()}</strong>
          </article>
        ))}
      </section>
      <section className={styles.card}>
        <h2>Platform analytics</h2>
        <p className={styles.muted}>Query-time V1 metrics; not advertised as realtime.</p>
        {analyticsMetrics.map(([label, value]) => (
          <p key={label}>
            {label}: <strong>{value}</strong>
          </p>
        ))}
      </section>
      <section className={styles.card}>
        <h2>Revenue</h2>
        <p className={styles.muted}>
          Revenue remains unavailable until Task 23 attribution and ledger processing are enabled.
        </p>
      </section>
    </>
  );
}
