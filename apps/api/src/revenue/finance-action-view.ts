import type { Prisma } from "@ayin/db";

// An actor's recent decisions help explicit recovery; this is not the global audit API.
export const financeRecoveryActions = [
  "REVENUE_SETTINGS_UPDATED",
  "CREATOR_CONTRACT_CREATED",
  "REVENUE_IMPORTED",
  "REVENUE_ADJUSTMENT_CREATED",
  "PAYOUT_CREATED",
  "PAYOUT_STATUS_UPDATED",
  "revenue.dispute_updated",
  "creator.compliance_status_overridden",
  "REVENUE_REPORT_RECONCILED",
] as const;

const referenceKeys = new Set([
  "channelId",
  "payoutId",
  "paymentProfileId",
  "videoId",
  "campaignId",
]);
const amountKeys = new Set(["amount", "payoutThresholdMicros"]);
const countKeys = new Set([
  "defaultCreatorRevenueShareBps",
  "revenueShareBps",
  "created",
  "duplicates",
  "requested",
  "entryCount",
  "totalRows",
  "matchedRows",
  "unmatchedRows",
  "duplicateRows",
  "correctedRows",
  "finalizedRows",
  "anomalousRows",
]);
const labelKeys = new Set([
  "currency",
  "source",
  "sourceReportId",
  "provider",
  "requestSource",
  "status",
  "from",
  "to",
  "field",
  "effectiveFrom",
  "effectiveTo",
]);
const flagKeys = new Set([
  "beneficiarySnapshotted",
  "rawIdentityDataAccessed",
  "taxIdentifierAccessed",
  "bankDataAccessed",
  "automaticProviderSyncConfigured",
]);

export function financeRecoveryMetadata(value: Prisma.JsonValue | null) {
  const result: Record<string, string | number | boolean | null> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [key, item] of Object.entries(value)) {
    if (
      referenceKeys.has(key) &&
      (item === null || (typeof item === "string" && /^[0-9a-f-]{36}$/i.test(item)))
    )
      result[key] = item;
    else if (
      amountKeys.has(key) &&
      typeof item === "string" &&
      item.length <= 128 &&
      /^-?\d+(?:\.\d{1,6})?$/.test(item)
    )
      result[key] = item;
    else if (
      countKeys.has(key) &&
      (item === null || (typeof item === "number" && Number.isSafeInteger(item) && item >= 0))
    )
      result[key] = item;
    else if (
      labelKeys.has(key) &&
      (item === null || (typeof item === "string" && item.length <= 160))
    )
      result[key] = item;
    else if (flagKeys.has(key) && typeof item === "boolean") result[key] = item;
  }
  return result;
}
