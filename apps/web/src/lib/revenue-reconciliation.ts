import { apiBaseUrl, readApiError } from "./api";

export type RevenueReconciliationStatus =
  "MATCHED" | "UNMATCHED" | "DUPLICATE" | "CORRECTED" | "FINALIZED" | "ANOMALOUS";

export interface RevenueReconciliationCapabilities {
  adapter: string;
  providerNeutral: true;
  automaticProviderSyncConfigured: boolean;
  supportedImportFormats: Array<"STRUCTURED" | "CSV">;
  maxRows: number;
  requiredEnvelopeFields: string[];
  csvColumns: { required: string[]; optional: string[] };
}

export interface RevenueReconciliationReport {
  id: string;
  source: string;
  sourceReportId: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  state: "ESTIMATED" | "FINAL";
  importFormat: "STRUCTURED" | "CSV";
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  duplicateRows: number;
  correctedRows: number;
  finalizedRows: number;
  anomalousRows: number;
  createdAt: string;
}

export interface RevenueReconciliationRow {
  id: string;
  rowNumber: number;
  externalRowId: string;
  channelRef: string | null;
  videoRef: string | null;
  contentRef: string | null;
  channelId: string | null;
  videoId: string | null;
  grossAmount: string;
  creatorAmount: string | null;
  currency: string;
  state: "ESTIMATED" | "FINAL";
  reconciliationStatus: RevenueReconciliationStatus;
  ledgerEntryId: string | null;
  priorRowId: string | null;
  reason: string | null;
  memo: string | null;
  createdAt: string;
}

export interface RevenueReportRowInput {
  externalRowId: string;
  grossAmount: string;
  channelId?: string;
  channelHandle?: string;
  videoId?: string;
  videoSlug?: string;
  contentId?: string;
  adSource?: string;
  memo?: string;
}

export type RevenueReconciliationImportInput = {
  source: string;
  sourceReportId: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  state: "ESTIMATED" | "FINAL";
} & ({ format: "CSV"; csv: string } | { format: "STRUCTURED"; rows: RevenueReportRowInput[] });

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as T;
}

export function getRevenueReconciliationCapabilities() {
  return request<RevenueReconciliationCapabilities>("/admin/revenue/reconciliation/capabilities");
}

export function importRevenueReconciliationReport(input: RevenueReconciliationImportInput) {
  return request<RevenueReconciliationReport & { idempotentReplay: boolean }>(
    "/admin/revenue/reconciliation/imports",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function getRevenueReconciliationReports(params = new URLSearchParams()) {
  const suffix = params.size ? `?${params.toString()}` : "";
  return request<{
    items: RevenueReconciliationReport[];
    pagination: { total: number; page: number; take: number; pages: number };
  }>(`/admin/revenue/reconciliation/reports${suffix}`);
}

export function getRevenueReconciliationReport(reportId: string) {
  return request<RevenueReconciliationReport & { rows: RevenueReconciliationRow[] }>(
    `/admin/revenue/reconciliation/reports/${encodeURIComponent(reportId)}`,
  );
}
