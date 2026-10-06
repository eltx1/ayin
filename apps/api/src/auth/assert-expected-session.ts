import { badRequest, conflict } from "./auth.errors.js";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

// Non-authenticating metadata: this can only narrow an authenticated request.
export function assertExpectedSession(value: unknown, actualSessionId: string): void {
  if (value === undefined) return;
  if (typeof value !== "string" || !uuid.test(value))
    throw badRequest("EXPECTED_SESSION_INVALID", "The expected signed-in session is invalid.");
  if (value.toLowerCase() !== actualSessionId.toLowerCase())
    throw conflict(
      "SESSION_CHANGED",
      "The signed-in session changed. Read the current account before another operation.",
    );
}
