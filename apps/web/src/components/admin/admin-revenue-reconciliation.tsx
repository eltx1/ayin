"use client";

import { useCallback, useEffect, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import {
  getRevenueReconciliationCapabilities,
  getRevenueReconciliationReport,
  getRevenueReconciliationReports,
  importRevenueReconciliationReport,
  type RevenueReconciliationCapabilities,
  type RevenueReconciliationImportInput,
  type RevenueReconciliationReport,
  type RevenueReconciliationRow,
  type RevenueReconciliationStatus,
  type RevenueReportRowInput,
} from "@/lib/revenue-reconciliation";

type ImportFormat = "CSV" | "STRUCTURED";

function toIso(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function statusCount(report: RevenueReconciliationReport, status: RevenueReconciliationStatus) {
  if (status === "MATCHED") return report.matchedRows;
  if (status === "UNMATCHED") return report.unmatchedRows;
  if (status === "DUPLICATE") return report.duplicateRows;
  if (status === "CORRECTED") return report.correctedRows;
  if (status === "FINALIZED") return report.finalizedRows;
  return report.anomalousRows;
}

const statuses: RevenueReconciliationStatus[] = [
  "MATCHED",
  "UNMATCHED",
  "DUPLICATE",
  "CORRECTED",
  "FINALIZED",
  "ANOMALOUS",
];

export function AdminRevenueReconciliation() {
  const [capabilities, setCapabilities] = useState<RevenueReconciliationCapabilities | null>(null);
  const [reports, setReports] = useState<RevenueReconciliationReport[]>([]);
  const [selectedRows, setSelectedRows] = useState<RevenueReconciliationRow[]>([]);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [source, setSource] = useState("");
  const [sourceReportId, setSourceReportId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [state, setState] = useState<"ESTIMATED" | "FINAL">("ESTIMATED");
  const [format, setFormat] = useState<ImportFormat>("CSV");
  const [payload, setPayload] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: "1", take: "50" });
    if (filterStatus) params.set("status", filterStatus);
    const [nextCapabilities, nextReports] = await Promise.all([
      getRevenueReconciliationCapabilities(),
      getRevenueReconciliationReports(params),
    ]);
    setCapabilities(nextCapabilities);
    setReports(nextReports.items);
  }, [filterStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error) => {
        setMessage(error instanceof Error ? error.message : "Reconciliation data could not load.");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function importReport() {
    const start = toIso(periodStart);
    const end = toIso(periodEnd);
    if (!start || !end) {
      setMessage("Choose a valid reporting period.");
      return;
    }
    if (!source.trim() || !sourceReportId.trim()) {
      setMessage("Source and source report ID are required.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      let input: RevenueReconciliationImportInput;
      if (format === "CSV") {
        if (!payload.trim()) throw new Error("Paste or choose a CSV report first.");
        input = {
          source: source.trim(),
          sourceReportId: sourceReportId.trim(),
          periodStart: start,
          periodEnd: end,
          currency: currency.trim().toUpperCase(),
          state,
          format: "CSV",
          csv: payload,
        };
      } else {
        const parsed = JSON.parse(payload) as unknown;
        if (!Array.isArray(parsed)) throw new Error("Structured import must be a JSON array.");
        input = {
          source: source.trim(),
          sourceReportId: sourceReportId.trim(),
          periodStart: start,
          periodEnd: end,
          currency: currency.trim().toUpperCase(),
          state,
          format: "STRUCTURED",
          rows: parsed as RevenueReportRowInput[],
        };
      }

      const result = await importRevenueReconciliationReport(input);
      setMessage(
        result.idempotentReplay
          ? "This source report was already reconciled. No ledger rows were written again."
          : `Reconciled ${result.totalRows} rows: ${result.finalizedRows} finalized, ${result.correctedRows} corrected, ${result.unmatchedRows} unmatched, ${result.anomalousRows} anomalous.`,
      );
      setSelectedReportId(result.id);
      const detail = await getRevenueReconciliationReport(result.id);
      setSelectedRows(detail.rows);
      setPayload("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Revenue reconciliation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function inspectReport(reportId: string) {
    setBusy(true);
    setMessage("");
    try {
      const detail = await getRevenueReconciliationReport(reportId);
      setSelectedReportId(reportId);
      setSelectedRows(detail.rows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Report details could not load.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.grid}>
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <span className={styles.eyebrow}>External Revenue Reconciliation</span>
            <h2>Validated source reports → immutable creator ledger</h2>
            <p className={styles.muted}>
              Provider-neutral reconciliation records every report and source row. Historical
              ledger amounts are never overwritten; corrections and finalization append new ledger
              effects.
            </p>
          </div>
          <span className={styles.statusPill}>
            {capabilities?.automaticProviderSyncConfigured
              ? "Provider sync configured"
              : "Validated import only"}
          </span>
        </div>

        {message ? (
          <p className={styles.notice} role="status">
            {message}
          </p>
        ) : null}

        <p className={styles.muted}>
          Automatic external reporting API sync is{" "}
          <strong>
            {capabilities?.automaticProviderSyncConfigured ? "configured" : "not configured"}
          </strong>
          . AYIN currently accepts validated CSV or structured input through the provider-neutral
          adapter boundary.
        </p>

        <div className={styles.formGrid}>
          <label>
            Source
            <input
              placeholder="External reporting source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            />
          </label>
          <label>
            Source report ID
            <input
              placeholder="Stable external report identity"
              value={sourceReportId}
              onChange={(event) => setSourceReportId(event.target.value)}
            />
          </label>
          <label>
            Report state
            <select
              value={state}
              onChange={(event) => setState(event.target.value as "ESTIMATED" | "FINAL")}
            >
              <option value="ESTIMATED">Estimated</option>
              <option value="FINAL">Final</option>
            </select>
          </label>
          <label>
            Currency
            <input
              maxLength={3}
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            Period start
            <input
              type="datetime-local"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
            />
          </label>
          <label>
            Period end
            <input
              type="datetime-local"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
            />
          </label>
          <label>
            Import format
            <select value={format} onChange={(event) => setFormat(event.target.value as ImportFormat)}>
              <option value="CSV">CSV</option>
              <option value="STRUCTURED">Structured JSON</option>
            </select>
          </label>
          {format === "CSV" ? (
            <label>
              CSV file
              <input
                accept=".csv,text/csv"
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void file.text().then(setPayload);
                }}
              />
            </label>
          ) : null}
          <label className={styles.fullField}>
            {format === "CSV" ? "CSV report" : "Structured rows JSON"}
            <textarea
              rows={12}
              placeholder={
                format === "CSV"
                  ? "externalRowId,grossAmount,channelId,channelHandle,videoId,videoSlug,contentId,adSource,memo"
                  : "Paste a JSON array of normalized source rows."
              }
              value={payload}
              onChange={(event) => setPayload(event.target.value)}
            />
          </label>
        </div>
        <p className={styles.muted}>
          CSV required columns:{" "}
          {capabilities?.csvColumns.required.join(", ") ?? "externalRowId, grossAmount"}. Optional
          attribution columns are validated when supplied.
        </p>
        <button
          className={styles.button}
          disabled={
            busy ||
            !source.trim() ||
            !sourceReportId.trim() ||
            !periodStart ||
            !periodEnd ||
            !payload.trim() ||
            currency.trim().length !== 3
          }
          type="button"
          onClick={() => void importReport()}
        >
          Reconcile report
        </button>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Reconciliation reports</h2>
            <p className={styles.muted}>
              Report identity is idempotent by source + source report ID.
            </p>
          </div>
          <select
            aria-label="Reconciliation status filter"
            value={filterStatus}
            onChange={(event) => setFilterStatus(event.target.value)}
          >
            <option value="">All reports</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                Contains {status.toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Source / report</th>
                <th>Period</th>
                <th>State</th>
                <th>Rows</th>
                <th>Reconciliation</th>
                <th>Inspect</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id}>
                  <td>
                    <strong>{report.source}</strong>
                    <br />
                    <span className={styles.muted}>{report.sourceReportId}</span>
                  </td>
                  <td>
                    {new Date(report.periodStart).toLocaleDateString()} –{" "}
                    {new Date(report.periodEnd).toLocaleDateString()}
                    <br />
                    <span className={styles.muted}>{report.currency}</span>
                  </td>
                  <td>{report.state}</td>
                  <td>{report.totalRows}</td>
                  <td>
                    {statuses
                      .filter((status) => statusCount(report, status) > 0)
                      .map((status) => `${status}: ${statusCount(report, status)}`)
                      .join(" · ") || "—"}
                  </td>
                  <td>
                    <button
                      className={styles.button}
                      disabled={busy}
                      type="button"
                      onClick={() => void inspectReport(report.id)}
                    >
                      View rows
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {reports.length === 0 ? (
          <p className={styles.muted}>No reconciliation reports match this filter.</p>
        ) : null}
      </section>

      {selectedReportId ? (
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2>Source row reconciliation</h2>
              <p className={styles.muted}>Report {selectedReportId}</p>
            </div>
            <span className={styles.statusPill}>{selectedRows.length} rows</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>External row</th>
                  <th>Status</th>
                  <th>Gross / creator</th>
                  <th>Attribution</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {selectedRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.rowNumber}</td>
                    <td>{row.externalRowId}</td>
                    <td>{row.reconciliationStatus}</td>
                    <td>
                      {row.currency} {row.grossAmount}
                      <br />
                      <span className={styles.muted}>
                        Creator: {row.creatorAmount ?? "not applied"}
                      </span>
                    </td>
                    <td>
                      {row.channelRef ?? row.channelId ?? "—"}
                      <br />
                      <span className={styles.muted}>
                        {row.videoRef ?? row.contentRef ?? row.videoId ?? "Channel-level"}
                      </span>
                    </td>
                    <td>{row.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
