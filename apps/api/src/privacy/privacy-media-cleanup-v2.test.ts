import { describe, expect, it } from "vitest";
import type {
  MediaProcessingOutputAttempt,
  MediaProcessingOutputWrite,
  MediaUploadOperation,
  MediaUploadSession,
} from "@ayin/db";
import { outputAttemptAddresses } from "../media/media-output-attempt.js";
import {
  FINITE_CLEANUP_RECHECK_MS,
  finiteAbortReceipt,
  finiteDebtKind,
  finiteOutputSnapshot,
  finiteRecheckAt,
  finiteSourceSnapshot,
} from "./privacy-media-cleanup-v2.js";

const now = new Date("2026-10-08T10:00:00Z");
const earlier = new Date(now.getTime() - 10000);
const session = {
  id: "session",
  revision: 2,
  sourceProtocolVersion: 2,
  mode: "MULTIPART",
  grantsRevokedAt: earlier,
  cleanupRequestedAt: earlier,
  state: "REVOKED",
  objectKey: "source-key",
  providerUploadId: "upload-1",
  lastGrantExpiresAt: earlier,
  grantlessReservationId: "reservation",
  grantReservationCount: 1,
} as MediaUploadSession;
function operation(input: Partial<MediaUploadOperation> = {}): MediaUploadOperation {
  return {
    id: "create",
    sessionId: session.id,
    kind: "CREATE",
    requestDigest: "a".repeat(64),
    dispatchStartedAt: earlier,
    providerOutcome: "ACKNOWLEDGED",
    providerTerminalAt: earlier,
    providerUploadId: "upload-1",
    grantExpiresAt: null,
    grantIssuedAt: null,
    ...input,
  } as MediaUploadOperation;
}
const attemptId = "33333333-3333-4333-8333-333333333333";
const namespace = {
  channelId: "11111111-1111-4111-8111-111111111111",
  videoId: "22222222-2222-4222-8222-222222222222",
  generation: 1,
  outputAttemptId: attemptId,
};
const addresses = outputAttemptAddresses(namespace);
const attempt = {
  ...namespace,
  ...addresses,
  id: attemptId,
  protocolVersion: 2,
  writesFrozenAt: earlier,
  createdAt: earlier,
  processingJobId: "job",
  claimToken: "claim",
  attempt: 1,
} as MediaProcessingOutputAttempt;
function write(input: Partial<MediaProcessingOutputWrite> = {}): MediaProcessingOutputWrite {
  return {
    id: "write",
    outputAttemptId: attemptId,
    processingJobId: "job",
    claimToken: "claim",
    attempt: 1,
    objectKey: addresses.canonicalR2ObjectKey,
    expectedSizeBytes: 10n,
    contentType: "video/mp4",
    status: "ACKNOWLEDGED",
    dispatchedAt: earlier,
    acknowledgedAt: earlier,
    outcomeUnknownAt: null,
    ...input,
  };
}

describe("finite source cleanup evidence", () => {
  it("binds acknowledged dispatches without turning absence into a future theorem", () => {
    const result = finiteSourceSnapshot(session, [operation()], now);
    expect(result.unresolved).toBeNull();
    expect(result.writeSetDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.keys).toEqual(["source-key"]);
    expect(result.uploadIds).toEqual(["upload-1"]);
    expect(result.observationFloor).toEqual(earlier);
  });
  it("does not expire lost CREATE or COMPLETE acknowledgements", () => {
    const muchLater = new Date("2030-10-08T10:00:00Z");
    for (const kind of ["CREATE", "COMPLETE"]) {
      const result = finiteSourceSnapshot(
        session,
        [operation({ kind, providerOutcome: "UNKNOWN", providerTerminalAt: null })],
        muchLater,
      );
      expect(result.unresolved).toBe(
        kind === "CREATE" ? "ALLOCATION_OUTCOME_UNKNOWN" : "SOURCE_WRITE_OUTCOME_UNKNOWN",
      );
    }
  });
  it("permits a provably undispatched reservation without inventing an ACK", () => {
    const result = finiteSourceSnapshot(
      session,
      [
        operation(),
        operation({
          id: "complete",
          kind: "COMPLETE",
          providerOutcome: "NOT_DISPATCHED",
          dispatchStartedAt: null,
          providerTerminalAt: null,
          providerUploadId: null,
        }),
      ],
      now,
    );
    expect(result.unresolved).toBeNull();
  });
  it("treats a dispatched operation without its provider outcome as unresolved", () => {
    expect(
      finiteSourceSnapshot(
        session,
        [operation({ providerOutcome: "NOT_DISPATCHED", providerTerminalAt: null })],
        now,
      ).unresolved,
    ).toBe("ALLOCATION_OUTCOME_UNKNOWN");
  });
  it("uses a late CREATE receipt even after the session lost authority", () => {
    const result = finiteSourceSnapshot({ ...session, providerUploadId: null }, [operation()], now);
    expect(result.uploadIds).toEqual(["upload-1"]);
  });
  it("waits for every durable grant cutoff, including an operation later than the session snapshot", () => {
    const future = new Date(now.getTime() + 1000);
    const result = finiteSourceSnapshot(
      session,
      [
        operation(),
        operation({
          id: "grant",
          kind: "PART",
          grantIssuedAt: earlier,
          grantExpiresAt: future,
        }),
      ],
      now,
    );
    expect(result.unresolved).toBe("GRANT_CUTOFF_PENDING");
    expect(result.observationFloor).toEqual(future);
  });
  it("accepts explicit grantless history but fails closed on missing grant history", () => {
    expect(
      finiteSourceSnapshot(
        { ...session, lastGrantExpiresAt: null, grantReservationCount: 0 },
        [operation()],
        now,
      ).unresolved,
    ).toBeNull();
    expect(() =>
      finiteSourceSnapshot({ ...session, lastGrantExpiresAt: null }, [operation()], now),
    ).toThrow("GRANT_HISTORY_UNVERIFIED");
    expect(() =>
      finiteSourceSnapshot(
        {
          ...session,
          lastGrantExpiresAt: null,
          grantReservationCount: 0,
          grantlessReservationId: null,
        },
        [],
        now,
      ),
    ).toThrow("GRANT_HISTORY_UNVERIFIED");
  });
  it("rejects V1, single PUT, unfrozen sessions and duplicate dispatches", () => {
    for (const patch of [
      { sourceProtocolVersion: 1 },
      { mode: "SINGLE" as const },
      { grantsRevokedAt: null },
    ])
      expect(() => finiteSourceSnapshot({ ...session, ...patch }, [operation()], now)).toThrow(
        "INVALID_FINITE_SOURCE_CONTRACT",
      );
    expect(() =>
      finiteSourceSnapshot(session, [operation(), operation({ id: "duplicate" })], now),
    ).toThrow("SOURCE_DISPATCH_HISTORY_INVALID");
  });
  it("invalidates evidence when revision, acknowledgement or allocation changes", () => {
    const first = finiteSourceSnapshot(session, [operation()], now).writeSetDigest;
    expect(
      finiteSourceSnapshot({ ...session, revision: 3 }, [operation()], now).writeSetDigest,
    ).not.toBe(first);
    expect(
      finiteSourceSnapshot(session, [operation({ providerTerminalAt: now })], now).writeSetDigest,
    ).not.toBe(first);
    expect(
      finiteSourceSnapshot(session, [operation({ providerUploadId: "another" })], now)
        .writeSetDigest,
    ).not.toBe(first);
  });
});

describe("finite immutable output cleanup evidence", () => {
  it("enumerates every exact journal address plus reserved fallback/thumbnail/master", () => {
    const segment = write({
      id: "segment",
      objectKey: `${addresses.hlsR2Prefix}360p/segment-000001.ts`,
      contentType: "video/mp2t",
    });
    const result = finiteOutputSnapshot(attempt, [write(), segment]);
    expect(result.unresolved).toBeNull();
    expect(result.keys).toHaveLength(4);
    expect(result.keys).toContain(segment.objectKey);
    expect(result.keys).toContain(addresses.thumbnailR2ObjectKey);
    expect(result.keys).toContain(`${addresses.hlsR2Prefix}master.m3u8`);
    expect(finiteOutputSnapshot(attempt, [segment, write()]).writeSetDigest).toBe(
      result.writeSetDigest,
    );
  });
  it("never settles UNKNOWN or crash-unacknowledged DISPATCHED output", () => {
    for (const status of ["UNKNOWN", "DISPATCHED"] as const)
      expect(
        finiteOutputSnapshot(attempt, [write({ status, acknowledgedAt: null })]).unresolved,
      ).toBe("OUTPUT_WRITE_OUTCOME_UNKNOWN");
  });
  it("requires monotonic freeze and exact attempt ownership", () => {
    expect(() => finiteOutputSnapshot({ ...attempt, writesFrozenAt: null }, [])).toThrow(
      "OUTPUT_WRITES_NOT_FROZEN",
    );
    expect(() => finiteOutputSnapshot({ ...attempt, protocolVersion: 1 }, [])).toThrow(
      "OUTPUT_WRITES_NOT_FROZEN",
    );
    for (const patch of [
      { claimToken: "new-owner" },
      { objectKey: "other-prefix/file.mp4" },
      { objectKey: `${attempt.prefix}../other.mp4` },
    ])
      expect(() => finiteOutputSnapshot(attempt, [write(patch)])).toThrow(
        "OUTPUT_ADDRESS_HISTORY_INVALID",
      );
  });
  it("binds byte count, terminal receipt and every newly recorded address", () => {
    const first = finiteOutputSnapshot(attempt, [write()]).writeSetDigest;
    expect(
      finiteOutputSnapshot(attempt, [write({ expectedSizeBytes: 11n })]).writeSetDigest,
    ).not.toBe(first);
    expect(finiteOutputSnapshot(attempt, [write({ acknowledgedAt: now })]).writeSetDigest).not.toBe(
      first,
    );
    expect(finiteOutputSnapshot(attempt, []).writeSetDigest).not.toBe(first);
  });
});

it("bounds tombstone cadence and guarantees a retention-boundary observation", () => {
  expect(finiteRecheckAt(now, new Date(now.getTime() + 2 * FINITE_CLEANUP_RECHECK_MS))).toEqual(
    new Date(now.getTime() + FINITE_CLEANUP_RECHECK_MS),
  );
  const expiry = new Date(now.getTime() + 1000);
  expect(finiteRecheckAt(now, expiry)).toEqual(expiry);
  expect(finiteRecheckAt(now, earlier)).toBeNull();
  expect(finiteDebtKind("ALLOCATION_OUTCOME_UNKNOWN")).toBe("ALLOCATION_RESOURCE");
  expect(finiteDebtKind("OUTPUT_WRITE_OUTCOME_UNKNOWN")).toBe("UNKNOWN_WRITE");
});

it("keeps resolved abort evidence address-free after the exact job address is minimized", () => {
  const rawUploadId = "private-provider-allocation-123";
  const receipt = finiteAbortReceipt(rawUploadId, now);
  expect(receipt).toEqual({
    abortUploadIdDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    abortAcknowledgedAt: now.toISOString(),
  });
  expect(JSON.stringify(receipt)).not.toContain(rawUploadId);
  expect(receipt.abortUploadIdDigest).not.toBe(
    finiteAbortReceipt("different-allocation", now).abortUploadIdDigest,
  );
  expect(finiteAbortReceipt(null, null)).toEqual({
    abortUploadIdDigest: null,
    abortAcknowledgedAt: null,
  });
});
