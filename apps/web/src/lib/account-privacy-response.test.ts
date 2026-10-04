import { describe, expect, it } from "vitest";
import {
  MAX_PRIVACY_EXPORT_BYTES,
  parseCancellationAcknowledgment,
  parseDeletionAcknowledgment,
  parseDeletionRequest,
  parsePrivacyExport,
  parsePrivacyStatus,
} from "./account-privacy-response";
const id = "a0000000-0000-4000-8000-000000000001",
  now = "2026-10-04T10:00:00.000Z";
const request = {
  id,
  state: "REQUESTED",
  requestedAt: now,
  graceEndsAt: null,
  deactivatedAt: null,
  anonymizedAt: null,
  cancelledAt: null,
  mediaCleanupQueuedAt: null,
  mediaCleanupCompletedAt: null,
};
const policy = {
  gracePeriodDays: 14,
  deactivatedRecoveryHours: 24,
  finalDatabaseState: "ANONYMIZED",
};
describe("privacy response facts and actual acknowledgments", () => {
  it("projects only actual safe request fields, retaining real nullable dates", () => {
    expect(parseDeletionRequest({ ...request, internalSessionId: "never projected" })).toEqual(
      request,
    );
  });
  it("keeps actual no-request state without inventing a deletion request", () => {
    expect(parsePrivacyStatus({ policy, request: null })).toEqual({ policy, request: null });
  });
  it("validates policy numerics without coercion or fallback defaults", () => {
    for (const value of ["14", null, undefined, -1, NaN, Infinity, 14.5])
      expect(() =>
        parsePrivacyStatus({ policy: { ...policy, gracePeriodDays: value }, request: null }),
      ).toThrow();
    expect(() => parsePrivacyStatus({ request: null })).toThrow();
  });
  it("rejects unknown or coerced states", () => {
    for (const state of ["UNKNOWN", ["REQUESTED"], null, 1])
      expect(() => parseDeletionRequest({ ...request, state })).toThrow();
  });
  it("rejects missing or noncanonical lifecycle dates", () => {
    for (const value of [undefined, "", "2026-10-04", "not-a-date", 0])
      expect(() => parseDeletionRequest({ ...request, cancelledAt: value })).toThrow();
  });
  it("accepts a request ACK only for the actual REQUESTED state", () => {
    expect(parseDeletionAcknowledgment(request)).toEqual(request);
    expect(() => parseDeletionAcknowledgment({ ...request, state: "CANCELLED" })).toThrow();
  });
  it("accepts exact cancellation without inventing a timestamp or request ID", () => {
    expect(parseCancellationAcknowledgment({ cancelled: true })).toEqual({ cancelled: true });
    for (const value of [{ cancelled: false }, { cancelled: "true" }, {}])
      expect(() => parseCancellationAcknowledgment(value)).toThrow();
  });
  it("downloads only the verified export account with actual version/date filename", () => {
    const value = {
      exportVersion: 1,
      generatedAt: now,
      account: { id, displayName: "Actual user" },
      profiles: [],
    };
    const result = parsePrivacyExport(value, id);
    expect(JSON.parse(result.text)).toEqual(value);
    expect(result.filename).toBe("ayin-data-export-2026-10-04.json");
    expect(() => parsePrivacyExport(value, "b0000000-0000-4000-8000-000000000002")).toThrow();
  });
  it("rejects unsupported version, malformed scope and unsafe generated date", () => {
    for (const value of [
      { exportVersion: 2, generatedAt: now, account: { id } },
      { exportVersion: 1, generatedAt: "unsafe", account: { id } },
      { exportVersion: 1, generatedAt: now, account: { id: "fake" } },
    ])
      expect(() => parsePrivacyExport(value, id)).toThrow();
  });
  it("enforces the final serialized UTF8 download bound", () => {
    expect(() =>
      parsePrivacyExport(
        {
          exportVersion: 1,
          generatedAt: now,
          account: { id },
          data: "x".repeat(MAX_PRIVACY_EXPORT_BYTES),
        },
        id,
      ),
    ).toThrow();
  });
});
