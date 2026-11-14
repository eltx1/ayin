import {
  AccountScopeError,
  requestAccountScope,
  type AccountScopeOptions,
} from "@/lib/account-scope";

export const reportReasons = [
  "COPYRIGHT",
  "SPAM",
  "HARASSMENT",
  "HATE",
  "SEXUAL_CONTENT",
  "VIOLENCE",
  "MISLEADING",
  "OTHER",
] as const;
export type ReportReason = (typeof reportReasons)[number];
export type ReportTarget = { videoId: string } | { commentId: string } | { channelId: string };
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function contentReportInput(target: ReportTarget, reason: ReportReason, details: string) {
  const keys = Object.keys(target);
  if (
    keys.length !== 1 ||
    !["videoId", "commentId", "channelId"].includes(keys[0]!) ||
    !uuid.test(Object.values(target)[0] ?? "") ||
    !reportReasons.includes(reason) ||
    typeof details !== "string" ||
    details.trim().length > 4000
  )
    throw new Error("INVALID_REPORT");
  return { ...target, reason, ...(details.trim() ? { details: details.trim() } : {}) };
}

export async function submitContentReport(
  target: ReportTarget,
  reason: ReportReason,
  details: string,
  options: AccountScopeOptions = {},
) {
  const input = contentReportInput(target, reason, details);
  const key = Object.keys(target)[0]!;
  return requestAccountScope(
    "/trust/reports",
    "POST",
    (raw) => {
      if (!raw || typeof raw !== "object") throw new Error("INVALID_REPORT_ACK");
      const value = raw as Record<string, unknown>;
      if (
        typeof value.id !== "string" ||
        !uuid.test(value.id) ||
        value[key] !== Object.values(target)[0]
      )
        throw new Error("INVALID_REPORT_ACK");
      return { id: value.id };
    },
    { ...options, maxResponseBytes: 64 * 1024 },
    input,
  );
}

export function reportFailureIsUncertain(error: unknown) {
  if (!(error instanceof AccountScopeError)) return false;
  return (
    error.writeStarted &&
    (error.acknowledged || error.status < 400 || error.status >= 500 || error.status === 408)
  );
}
