"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import {
  getAdminOperationsDashboard,
  type AdminOperationsDashboard,
} from "@/lib/admin-control";

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function bps(value: number | null): string {
  return value === null ? "Unavailable" : `${(value / 100).toFixed(1)}%`;
}

function duration(valueMs: number): string {
  if (!Number.isFinite(valueMs) || valueMs <= 0) return "0s";
  if (valueMs < 60_000) return `${(valueMs / 1000).toFixed(1)}s`;
  return `${(valueMs / 60_000).toFixed(1)}m`;
}

function money(value: string | null, currency: string | null): string {
  return value && currency ? `${currency} ${value}` : "Unavailable";
}

function statusLabel(available: boolean, value: string | null): string {
  if (!available) return "Unavailable";
  return value ? value.toUpperCase() : "UNKNOWN";
}

export function AdminOperationsCapacityDashboard() {
  const [data, setData] = useState<AdminOperationsDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getAdminOperationsDashboard()
      .then((body) => {
        if (active) setData(body);
      })
      .catch((caught) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Production operations metrics could not be loaded.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const liability = useMemo(
    () =>
      data?.revenue.payoutLiability.map((row) => `${row.currency} ${row.amount}`).join(" · ") ??
      "None",
    [data],
  );

  if (error) {
    return (
      <section className={styles.card}>
        <h2>Production operating view</h2>
        <p className={styles.error}>{error}</p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className={styles.card}>
        <h2>Production operating view</h2>
        <p className={styles.muted}>Loading capacity, reliability and unit economics…</p>
      </section>
    );
  }

  return (
    <section aria-label="Production operating dashboard" className={styles.grid}>
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <span className={styles.eyebrow}>Tasks 39–87 operating view</span>
            <h2>Capacity, reliability & unit economics</h2>
            <p className={styles.muted}>
              One evidence-based view. Missing invoices, no-fill facts or external status are shown
              as unavailable instead of estimated silently.
            </p>
          </div>
          <div>
            <span className={styles.statusPill}>
              {data.alerts.criticalCount} critical · {data.alerts.warningCount} warning
            </span>
            <p className={styles.muted}>Generated {new Date(data.generatedAt).toLocaleString()}</p>
          </div>
        </div>

        {data.alerts.items.length ? (
          <div className={styles.auditList}>
            {data.alerts.items.map((alert) => (
              <article className={styles.auditItem} key={alert.code}>
                <div>
                  <strong>
                    {alert.severity} · {alert.code}
                  </strong>
                  <span className={styles.muted}>{alert.message}</span>
                </div>
                <div>
                  <span className={styles.statusBadge}>
                    {alert.observed === null ? "unavailable" : String(alert.observed)}
                  </span>
                  {alert.threshold !== null ? (
                    <small className={styles.muted}>threshold {String(alert.threshold)}</small>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.notice}>No configured danger threshold is currently breached.</p>
        )}
      </div>

      <div>
        <span className={styles.eyebrow}>Product · complete 30-day UTC window</span>
        <section className={styles.metrics} aria-label="Product operating metrics">
          {[
            ["DAU approx", data.product.dauApprox.toLocaleString()],
            ["MAU approx", data.product.mauApprox.toLocaleString()],
            ["Watch hours", data.product.watchHours.toLocaleString()],
            ["Uploads", data.product.uploads.toLocaleString()],
            ["Active creators", data.product.activeCreators.toLocaleString()],
            ["Active videos", data.product.activeVideos.toLocaleString()],
          ].map(([label, value]) => (
            <article className={styles.metric} key={label}>
              <span className={styles.muted}>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </section>
        <p className={styles.muted}>{data.product.activeCreatorsDefinition}</p>
      </div>

      <div className={styles.commandGrid}>
        <article className={styles.card}>
          <h2>Media processing</h2>
          <p>
            Queue <strong>{data.media.queue.queueDepth}</strong> · oldest{" "}
            <strong>{data.media.queue.oldestQueuedAgeSeconds}s</strong>
          </p>
          <p>
            Active jobs <strong>{data.media.queue.currentActiveJobs}</strong> / global cap{" "}
            <strong>{data.media.queue.globalConcurrencyLimit}</strong>
          </p>
          <p>
            30d terminal <strong>{data.media.processing.terminalJobs}</strong> · failed{" "}
            <strong>{data.media.processing.failedJobs}</strong> (
            {percent(data.media.processing.failureRate)})
          </p>
          <p>
            Processing avg <strong>{duration(data.media.processing.averageDurationMs)}</strong> · p95{" "}
            <strong>{duration(data.media.processing.p95DurationMs)}</strong>
          </p>
          <p>
            Uploaded content <strong>{data.media.uploadedContentHours.toFixed(2)}h</strong>
          </p>
        </article>

        <article className={styles.card}>
          <h2>Playback readiness</h2>
          <p>
            HLS <strong>{data.media.hls.readyVideos}</strong> / {data.media.hls.playableVideos} (
            {percent(data.media.hls.readinessRate)})
          </p>
          <p>
            MP4 fallback <strong>{percent(data.media.mp4Fallback.rate)}</strong> ·{" "}
            {data.media.mp4Fallback.events} fallback events / {data.media.mp4Fallback.starts} starts
          </p>
          <p>
            Generated storage <strong>{data.media.generatedStorage.totalGiB.toFixed(3)} GiB</strong>
          </p>
          <p className={styles.muted}>
            Includes processed canonical MP4 bytes plus READY HLS output bytes.
          </p>
        </article>

        <article className={styles.card}>
          <h2>Worker capacity</h2>
          <p>
            Fresh workers <strong>{data.infrastructure.workers.activeWorkerCount}</strong>
          </p>
          <p>
            Local concurrency <strong>{data.infrastructure.workers.totalWorkerConcurrency}</strong>{" "}
            · global cap <strong>{data.infrastructure.workers.globalConcurrencyLimit}</strong>
          </p>
          <p>
            Active worker jobs <strong>{data.infrastructure.workers.activeWorkerJobs}</strong>
          </p>
          <p className={styles.muted}>
            Processing versions and per-host CPU/concurrency metadata are sourced from the Task 85
            worker registry.
          </p>
        </article>
      </div>

      <div className={styles.commandGrid}>
        <article className={styles.card}>
          <h2>API</h2>
          <p>
            p95 <strong>{data.infrastructure.api.latencyMs.p95} ms</strong> · max{" "}
            <strong>{data.infrastructure.api.latencyMs.max} ms</strong>
          </p>
          <p>
            5xx rate <strong>{bps(data.infrastructure.api.error5xxRateBps)}</strong>
          </p>
          <p>
            Requests in {data.infrastructure.api.windowSeconds}s{" "}
            <strong>{data.infrastructure.api.requests}</strong>
          </p>
        </article>

        <article className={styles.card}>
          <h2>PostgreSQL</h2>
          <p>
            Health <strong>{data.infrastructure.database.status}</strong>
          </p>
          <p>
            Connections <strong>{data.infrastructure.database.server.totalConnections}</strong> /{" "}
            {data.infrastructure.database.server.maxConnections ?? "?"}
          </p>
          <p>
            Connection utilization{" "}
            <strong>{bps(data.infrastructure.database.connectionUtilizationBps)}</strong>
          </p>
          <p>
            Idle in transaction{" "}
            <strong>{data.infrastructure.database.server.idleInTransactionConnections}</strong>
          </p>
        </article>

        <article className={styles.card}>
          <h2>Backup & synthetic</h2>
          <p>
            Backup{" "}
            <strong>
              {statusLabel(
                data.infrastructure.backup.available,
                data.infrastructure.backup.status,
              )}
            </strong>
          </p>
          <p>
            Backup age{" "}
            <strong>
              {data.infrastructure.backup.ageHours === null
                ? "Unavailable"
                : `${data.infrastructure.backup.ageHours}h`}
            </strong>
          </p>
          <p>
            Synthetic{" "}
            <strong>
              {statusLabel(
                data.infrastructure.syntheticMonitoring.available,
                data.infrastructure.syntheticMonitoring.status,
              )}
            </strong>
          </p>
          {data.infrastructure.syntheticMonitoring.reason ? (
            <p className={styles.muted}>{data.infrastructure.syntheticMonitoring.reason}</p>
          ) : null}
        </article>
      </div>

      <div className={styles.commandGrid}>
        <article className={styles.card}>
          <h2>Advertising</h2>
          <p>
            Requests <strong>{data.advertising.requests.toLocaleString()}</strong> · fills{" "}
            <strong>{data.advertising.fills.toLocaleString()}</strong>
          </p>
          <p>
            Impressions <strong>{data.advertising.impressions.toLocaleString()}</strong> · starts{" "}
            <strong>{data.advertising.starts.toLocaleString()}</strong>
          </p>
          <p>
            Fill rate <strong>{percent(data.advertising.fillRate)}</strong> · technical errors{" "}
            <strong>{data.advertising.technicalErrors.toLocaleString()}</strong>
          </p>
          <p className={styles.muted}>No-fill: {data.advertising.noFill.reason}</p>
        </article>

        <article className={styles.card}>
          <h2>Revenue & creator liability</h2>
          {data.revenue.rows.length ? (
            data.revenue.rows.map((row) => (
              <div className={styles.cardInset} key={row.currency}>
                <p>
                  <strong>{row.currency}</strong>
                </p>
                <p>
                  Estimated gross{" "}
                  <strong>
                    {row.estimatedGrossComplete ? row.estimatedGross : `${row.estimatedGross} partial`}
                  </strong>
                </p>
                <p>
                  Final gross{" "}
                  <strong>
                    {row.finalizedGrossComplete ? row.finalizedGross : `${row.finalizedGross} partial`}
                  </strong>
                </p>
                <p>
                  Estimated creator share <strong>{row.estimatedCreatorShare}</strong>
                </p>
                <p>
                  Final creator share <strong>{row.finalizedCreatorShare}</strong>
                </p>
              </div>
            ))
          ) : (
            <p className={styles.muted}>No revenue ledger facts in this complete 30-day window.</p>
          )}
          <p>
            Outstanding payout liability <strong>{liability}</strong>
          </p>
        </article>

        <article className={styles.card}>
          <h2>Cost model</h2>
          <p>
            Mode <strong>{data.cost.mode}</strong> · currency <strong>{data.cost.currency}</strong>
          </p>
          <p>
            Total monthly{" "}
            <strong>{money(data.cost.totalMonthly, data.cost.complete ? data.cost.currency : null)}</strong>
          </p>
          <div className={styles.auditList}>
            {data.cost.categories.map((item) => (
              <div className={styles.cardInset} key={item.category}>
                <span className={styles.muted}>{item.category}</span>
                <strong>
                  {item.configured && item.monthly
                    ? `${data.cost.currency} ${item.monthly}`
                    : "Not configured"}
                </strong>
              </div>
            ))}
          </div>
          <p className={styles.muted}>{data.cost.note}</p>
          <Link className={styles.button} href="/admin/settings">
            Configure costs & thresholds
          </Link>
        </article>
      </div>

      <div className={styles.card}>
        <h2>Unit economics</h2>
        <section className={styles.metrics}>
          {[
            ["Cost / watch hour", money(data.unitEconomics.costPerWatchHour, data.unitEconomics.currency)],
            [
              "Storage cost / active video",
              money(data.unitEconomics.storageCostPerActiveVideo, data.unitEconomics.currency),
            ],
            [
              "Processing cost / uploaded hour",
              money(data.unitEconomics.processingCostPerUploadedHour, data.unitEconomics.currency),
            ],
            [
              "Revenue / 1k qualified plays",
              money(
                data.unitEconomics.revenuePerThousandQualifiedPlays.value,
                data.unitEconomics.revenuePerThousandQualifiedPlays.currency,
              ),
            ],
            [
              "Gross margin",
              data.unitEconomics.grossMarginEstimate.available
                ? `${money(
                    data.unitEconomics.grossMarginEstimate.amount,
                    data.unitEconomics.currency,
                  )} · ${percent(data.unitEconomics.grossMarginEstimate.rate ?? 0)}`
                : "Unavailable",
            ],
          ].map(([label, value]) => (
            <article className={styles.metric} key={label}>
              <span className={styles.muted}>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </section>
        {!data.unitEconomics.grossMarginEstimate.available ? (
          <p className={styles.muted}>{data.unitEconomics.grossMarginEstimate.reason}</p>
        ) : null}
        <p className={styles.muted}>
          Qualified play definition:{" "}
          {data.unitEconomics.revenuePerThousandQualifiedPlays.definition}
        </p>
      </div>

      <div className={styles.card}>
        <h2>Evidence boundary</h2>
        <p>
          Provider invoices fetched: <strong>No</strong> · Replica data used: <strong>No</strong>
        </p>
        <div className={styles.auditList}>
          {data.evidence.notes.map((note) => (
            <div className={styles.cardInset} key={note}>
              {note}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
