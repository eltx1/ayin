import { badRequest, conflict } from "./auth.errors.js";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

// This only narrows an already authenticated request; it never grants authority.
export function assertExpectedAccount(value: unknown, actualAccountId: string): void {
  if (value === undefined) return;
  if (typeof value !== "string" || !uuid.test(value))
    throw badRequest("EXPECTED_ACCOUNT_INVALID", "The expected signed-in account is invalid.");
  if (value.toLowerCase() !== actualAccountId.toLowerCase())
    throw conflict(
      "ACCOUNT_CHANGED",
      "The signed-in account changed. Read the current account before another operation.",
    );
}
