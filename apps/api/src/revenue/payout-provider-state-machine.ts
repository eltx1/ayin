import { createHash } from "node:crypto";

export type ProviderTransferState =
  | "READY"
  | "SUBMITTING"
  | "SUBMISSION_UNKNOWN"
  | "SUBMITTED"
  | "PROCESSING"
  | "CANCEL_REQUESTED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "UNKNOWN";

const TRANSITIONS: Record<ProviderTransferState, readonly ProviderTransferState[]> = {
  READY: ["SUBMITTING", "CANCELLED"],
  SUBMITTING: ["SUBMISSION_UNKNOWN", "SUBMITTED", "PROCESSING", "FAILED"],
  SUBMISSION_UNKNOWN: ["SUBMITTING", "SUBMITTED", "PROCESSING", "FAILED", "UNKNOWN"],
  SUBMITTED: ["PROCESSING", "CANCEL_REQUESTED", "COMPLETED", "FAILED", "CANCELLED", "UNKNOWN"],
  PROCESSING: ["PROCESSING", "CANCEL_REQUESTED", "COMPLETED", "FAILED", "CANCELLED", "UNKNOWN"],
  CANCEL_REQUESTED: [
    "PROCESSING",
    "CANCEL_REQUESTED",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
    "UNKNOWN",
  ],
  UNKNOWN: ["PROCESSING", "CANCEL_REQUESTED", "COMPLETED", "FAILED", "CANCELLED", "UNKNOWN"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export const MAX_PROVIDER_SUBMIT_ATTEMPTS = 5;
export const STALE_SUBMISSION_MS = 5 * 60 * 1000;

export function assertProviderTransferTransition(
  from: ProviderTransferState,
  to: ProviderTransferState,
): void {
  if (from === to) return;
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(`INVALID_PROVIDER_TRANSFER_TRANSITION:${from}->${to}`);
  }
}

export function buildPayoutProviderIdempotencyKey(provider: string, payoutId: string): string {
  const digest = createHash("sha256")
    .update(`${provider.trim()}\u001f${payoutId.trim()}`, "utf8")
    .digest("hex");
  return `payout:${digest}`;
}

export function providerSubmitRetryDelayMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.min(MAX_PROVIDER_SUBMIT_ATTEMPTS, Math.trunc(attempt)));
  return Math.min(15 * 60 * 1000, 30_000 * 2 ** (safeAttempt - 1));
}

export function canRetryProviderSubmission(input: {
  state: ProviderTransferState;
  submitAttempts: number;
  nextRetryAt: Date | null;
  now: Date;
}): boolean {
  if (input.state !== "SUBMISSION_UNKNOWN") return false;
  if (input.submitAttempts >= MAX_PROVIDER_SUBMIT_ATTEMPTS) return false;
  return input.nextRetryAt !== null && input.nextRetryAt <= input.now;
}

export function isTerminalProviderTransferState(state: ProviderTransferState): boolean {
  return state === "COMPLETED" || state === "FAILED" || state === "CANCELLED";
}
