"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import {
  getAdminAnalytics,
  getAdminDashboard,
  getAdminSystemHealth,
  searchAdmin,
  type AdminAnalyticsMetrics,
  type AdminGlobalSearchResult,
  type AdminSystemHealth,
} from "@/lib/admin-control";
import { getAdminFinanceSummary } from "@/lib/revenue";

interface DashboardData {
  accounts: number;
  activeAccounts: number;
  channels: number;
  videos: number;
  publishedVideos: number;
  tvChannels: number;
  openReports: number;
  openCases: number;
}

type FinanceSummary = Awaited<ReturnType<typeof getAdminFinanceSummary>>;

export function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [analytics, setAnalytics] = useState<AdminAnalyticsMetrics | null>(null);
  const [health, setHealth] = useState<AdminSystemHealth | null>(null);
  const [finance, setFinance] = useState<FinanceSummary | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AdminGlobalSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getAdminDashboard(),
      getAdminAnalytics(),
      getAdminSystemHealth(),
      getAdminFinanceSummary(),
    ])
      .then(([body, nextAnalytics, nextHealth, nextFinance]) => {
        if (!active) return;
        setData(body as unknown as DashboardData);
        setAnalytics(nextAnalytics);
        setHealth(nextHealth);
        setFinance(nextFinance);
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

  async function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = query.trim();
    if (normalized.length < 2) return;
    setSearching(true);
    setError(null);
    try {
      const result = await searchAdmin(normalized);
      setSearchResults(result.items);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Global search failed.");
    } finally {
      setSearching(false);
    }
  }

  if (error && !data) return <p className={styles.error}>{error}</p>;
  if (!data || !analytics || !health || !finance)
    return <p className={styles.muted}>Loading Admin Control Center…</p>;

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
          <span className={styles.eyebrow}>Control Center</span>
          <h1>AYIN Admin</h1>
          <p className={styles.muted}>
            Search, operate, review revenue and observe platform health through protected, audited controls.
          </p>
        </div>
        <span className={styles.statusPill}>Query-time operational view</span>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.card}>
        <h2>Global search</h2>
        <p className={styles.muted}>Find accounts, channels, videos and payout records from one protected search.</p>
        <form className={styles.toolbar} onSubmit={runSearch}>
          <input
            aria-label="Search AYIN administration"
            minLength={2}
            placeholder="Email, creator, channel, video, payout reference…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className={styles.button} disabled={searching || query.trim().length < 2} type="submit">
            {searching ? "Searching…" : "Search"}
          </button>
        </form>
        {searchResults.length ? (
          <div className={styles.searchResults}>
            {searchResults.map((result) => (
              <Link className={styles.searchResult} href={result.href} key={`${result.kind}-${result.id}`}>
                <span>
                  <span className={styles.statusPill}>{result.kind}</span>{" "}
                  <strong>{result.label}</strong>
                  <br />
                  <span className={styles.muted}>{result.detail}</span>
                </span>
                <span>Open →</span>
              </Link>
            ))}
          </div>
        ) : query.trim().length >= 2 && !searching ? (
          <p className={styles.muted}>No search results loaded yet, or no matches were found.</p>
        ) : null}
      </section>

      <section aria-label="Platform counters" className={styles.metrics}>
        {metrics.map(([label, value]) => (
          <article className={styles.metric} key={label}>
            <span className={styles.muted}>{label}</span>
            <strong>{value.toLocaleString()}</strong>
          </article>
        ))}
      </section>

      <section className={styles.commandGrid}>
        <article className={styles.card}>
          <h2>Revenue operations</h2>
          <p><strong>{finance.pendingPayouts}</strong> pending payouts</p>
          <p><strong>{finance.processingPayouts}</strong> processing payouts</p>
          <p><strong>{finance.openDisputes}</strong> open revenue disputes</p>
          {finance.pendingValue.map((item) => (
            <p key={item.currency}>{item.currency} {item.amount} pending/processing</p>
          ))}
          <p className={styles.muted}>Provider mode: audited manual payout. External providers are not represented as connected.</p>
          <Link className={styles.button} href="/admin/revenue">Open Revenue Control Center</Link>
        </article>

        <article className={styles.card}>
          <h2>System health</h2>
          <p>API <strong>{health.api.status}</strong></p>
          <p>Database <strong>{health.database.status}</strong></p>
          <p>Media storage <strong>{health.mediaStorage.status}</strong></p>
          <p>Storage mode <strong>{health.mediaStorage.mode.toUpperCase()}</strong></p>
          <p className={styles.muted}>
            Direct client-to-storage upload architecture remains enabled. This view observes existing R2 readiness only.
          </p>
        </article>

        <article className={styles.card}>
          <h2>Priority queues</h2>
          <p><Link href="/admin/moderation">Moderation · {data.openReports} reports / {data.openCases} cases</Link></p>
          <p><Link href="/admin/videos">Video operations</Link></p>
          <p><Link href="/admin/tv">Creator TV operations</Link></p>
          <p><Link href="/admin/product-controls">Home & product controls</Link></p>
          <p><Link href="/admin/feature-flags">Feature flags</Link></p>
        </article>
      </section>

      <section className={styles.card} style={{ marginTop: 18 }}>
        <h2>Platform analytics</h2>
        <p className={styles.muted}>Query-time V1 metrics; intentionally not advertised as realtime.</p>
        <div className={styles.commandGrid}>
          {analyticsMetrics.map(([label, value]) => (
            <p key={label}>{label}: <strong>{value}</strong></p>
          ))}
        </div>
      </section>
    </>
  );
}
