const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export type DeletionState =
  "REQUESTED" | "GRACE_PERIOD" | "DEACTIVATED" | "ANONYMIZED" | "CANCELLED";
export interface DeletionRequest {
  id: string;
  state: DeletionState;
  requestedAt: string;
  graceEndsAt: string | null;
  deactivatedAt: string | null;
  anonymizedAt: string | null;
  cancelledAt: string | null;
  mediaCleanupQueuedAt: string | null;
  mediaCleanupCompletedAt: string | null;
}
export interface PrivacyStatus {
  policy: {
    gracePeriodDays: number;
    deactivatedRecoveryHours: number;
    finalDatabaseState: "ANONYMIZED";
  };
  request: DeletionRequest | null;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid privacy response");
  return value as Record<string, unknown>;
}
function date(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 32 ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw Error("Invalid privacy date");
  return value;
}
const nullableDate = (value: unknown) => (value === null ? null : date(value));
export function parseDeletionRequest(value: unknown): DeletionRequest {
  const row = object(value);
  if (
    typeof row.id !== "string" ||
    !uuid.test(row.id) ||
    typeof row.state !== "string" ||
    !["REQUESTED", "GRACE_PERIOD", "DEACTIVATED", "ANONYMIZED", "CANCELLED"].includes(row.state)
  )
    throw Error("Invalid deletion request");
  return {
    id: row.id,
    state: row.state as DeletionState,
    requestedAt: date(row.requestedAt),
    graceEndsAt: nullableDate(row.graceEndsAt),
    deactivatedAt: nullableDate(row.deactivatedAt),
    anonymizedAt: nullableDate(row.anonymizedAt),
    cancelledAt: nullableDate(row.cancelledAt),
    mediaCleanupQueuedAt: nullableDate(row.mediaCleanupQueuedAt),
    mediaCleanupCompletedAt: nullableDate(row.mediaCleanupCompletedAt),
  };
}
export function parseDeletionAcknowledgment(value: unknown): DeletionRequest {
  const request = parseDeletionRequest(value);
  if (request.state !== "REQUESTED") throw Error("Invalid deletion acknowledgment");
  return request;
}
export function parsePrivacyStatus(value: unknown): PrivacyStatus {
  const row = object(value),
    policy = object(row.policy);
  if (
    !Number.isSafeInteger(policy.gracePeriodDays) ||
    (policy.gracePeriodDays as number) < 0 ||
    (policy.gracePeriodDays as number) > 3650 ||
    !Number.isSafeInteger(policy.deactivatedRecoveryHours) ||
    (policy.deactivatedRecoveryHours as number) < 0 ||
    (policy.deactivatedRecoveryHours as number) > 87600 ||
    policy.finalDatabaseState !== "ANONYMIZED"
  )
    throw Error("Invalid deletion policy");
  return {
    policy: {
      gracePeriodDays: policy.gracePeriodDays as number,
      deactivatedRecoveryHours: policy.deactivatedRecoveryHours as number,
      finalDatabaseState: "ANONYMIZED",
    },
    request: row.request === null ? null : parseDeletionRequest(row.request),
  };
}
export function parseCancellationAcknowledgment(value: unknown): { cancelled: true } {
  if (object(value).cancelled !== true) throw Error("Invalid cancellation acknowledgment");
  return { cancelled: true };
}
export const MAX_PRIVACY_EXPORT_BYTES = 10 * 1024 * 1024;
export function parsePrivacyExport(
  value: unknown,
  expectedAccountId: string,
): { text: string; filename: string } {
  const row = object(value),
    account = object(row.account);
  if (
    !uuid.test(expectedAccountId) ||
    row.exportVersion !== 1 ||
    typeof account.id !== "string" ||
    !uuid.test(account.id) ||
    account.id.toLowerCase() !== expectedAccountId.toLowerCase()
  )
    throw Error("Invalid privacy export scope");
  const generatedAt = date(row.generatedAt);
  const text = JSON.stringify(row);
  if (new TextEncoder().encode(text).byteLength > MAX_PRIVACY_EXPORT_BYTES)
    throw Error("Privacy export exceeds download limit");
  return { text, filename: `ayin-data-export-${generatedAt.slice(0, 10)}.json` };
}
