import { createHash } from "node:crypto";
import type {
  MediaProcessingOutputAttempt,
  MediaProcessingOutputWrite,
  MediaUploadOperation,
  MediaUploadSession,
} from "@ayin/db";
import { outputAttemptAddresses } from "../media/media-output-attempt.js";

export const FINITE_CLEANUP_VERSION = "AYIN_CLEANUP_V2";
export const FINITE_CLEANUP_CONCLUSION = "FROZEN_ACKNOWLEDGED_AND_OBSERVED_ABSENT";
export const FINITE_CLEANUP_OBJECTS_PER_PASS = 25;
export const FINITE_CLEANUP_RECHECK_MS = 24 * 60 * 60 * 1000;
export const FINITE_CLEANUP_SLOW_RETRY_MS = 6 * 60 * 60 * 1000;

export class FiniteCleanupUnresolved extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export interface FiniteCleanupSnapshot {
  writeSetDigest: string;
  observationFloor: Date;
  unresolved: string | null;
  keys: string[];
  uploadIds: string[];
}

export interface FiniteCleanupEvidence {
  version: typeof FINITE_CLEANUP_VERSION;
  conclusion: typeof FINITE_CLEANUP_CONCLUSION;
  operationKey: string;
  kind: string;
  leaseToken: string;
  attempt: number;
  writeSetDigest: string;
  observedAbsentAt: string;
  observationStartedAt: string;
  sessionId: string | null;
  sessionRevision: number | null;
  outputAttemptId: string | null;
  exactObjectCount: number;
  abortAcknowledgedAt: string | null;
  abortUploadIdDigest: string | null;
  retentionCheckedAt: string | null;
}

/** The resolved receipt binds the exact retained job address without copying
 * the allocation ID into an immutable audit record that outlives minimization. */
export function finiteAbortReceipt(uploadId: string | null, acknowledgedAt: Date | null) {
  return {
    abortUploadIdDigest:
      uploadId === null ? null : createHash("sha256").update(uploadId).digest("hex"),
    abortAcknowledgedAt: acknowledgedAt?.toISOString() ?? null,
  };
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** The cutoff permits a finite residual-part observation. It is never evidence
 * that an earlier UploadPart request cannot finish after the observation. */
export function finiteSourceSnapshot(
  session: MediaUploadSession,
  operations: readonly MediaUploadOperation[],
  now: Date,
): FiniteCleanupSnapshot {
  if (
    session.sourceProtocolVersion !== 2 ||
    session.mode !== "MULTIPART" ||
    !session.grantsRevokedAt ||
    !session.cleanupRequestedAt ||
    !["REVOKED", "EXPIRED", "ABORTED", "COMPLETED"].includes(session.state)
  )
    throw new FiniteCleanupUnresolved("INVALID_FINITE_SOURCE_CONTRACT");
  const creating = operations
    .filter((operation) => ["CREATE", "COMPLETE"].includes(operation.kind))
    .sort((a, b) => a.id.localeCompare(b.id));
  const dispatched = creating.filter(
    (operation) => operation.dispatchStartedAt || operation.providerOutcome !== "NOT_DISPATCHED",
  );
  const grantExpiry = operations.reduce(
    (latest, operation) => Math.max(latest, operation.grantExpiresAt?.getTime() ?? 0),
    session.lastGrantExpiresAt?.getTime() ?? 0,
  );
  if (
    (!grantExpiry && (!session.grantlessReservationId || session.grantReservationCount !== 0)) ||
    operations.some((operation) => operation.grantIssuedAt && !operation.grantExpiresAt)
  )
    throw new FiniteCleanupUnresolved("GRANT_HISTORY_UNVERIFIED");
  let unresolved: string | null = null;
  if (grantExpiry > now.getTime()) unresolved = "GRANT_CUTOFF_PENDING";
  if (
    dispatched.some(
      (operation) =>
        !operation.dispatchStartedAt ||
        operation.providerOutcome !== "ACKNOWLEDGED" ||
        !operation.providerTerminalAt,
    )
  )
    unresolved = dispatched.some(
      (operation) => operation.kind === "CREATE" && operation.providerOutcome !== "ACKNOWLEDGED",
    )
      ? "ALLOCATION_OUTCOME_UNKNOWN"
      : "SOURCE_WRITE_OUTCOME_UNKNOWN";
  if (["CREATE", "COMPLETE"].some((kind) => dispatched.filter((op) => op.kind === kind).length > 1))
    throw new FiniteCleanupUnresolved("SOURCE_DISPATCH_HISTORY_INVALID");
  const uploadIds = [
    ...new Set([
      ...(session.providerUploadId ? [session.providerUploadId] : []),
      ...creating.flatMap((operation) =>
        operation.providerUploadId ? [operation.providerUploadId] : [],
      ),
    ]),
  ].sort();
  const observationFloor = new Date(
    Math.max(
      session.grantsRevokedAt.getTime(),
      session.cleanupRequestedAt.getTime(),
      grantExpiry,
      ...dispatched.map((operation) => operation.providerTerminalAt?.getTime() ?? 0),
    ),
  );
  return {
    writeSetDigest: digest({
      sessionId: session.id,
      revision: session.revision,
      key: session.objectKey,
      frozenAt: session.grantsRevokedAt.toISOString(),
      cleanupRequestedAt: session.cleanupRequestedAt.toISOString(),
      grantExpiry,
      grantReservationCount: session.grantReservationCount,
      grantlessReservationId: session.grantlessReservationId,
      uploadIds,
      operations: creating.map((operation) => ({
        id: operation.id,
        kind: operation.kind,
        requestDigest: operation.requestDigest,
        dispatchedAt: operation.dispatchStartedAt?.toISOString() ?? null,
        outcome: operation.providerOutcome,
        terminalAt: operation.providerTerminalAt?.toISOString() ?? null,
        uploadId: operation.providerUploadId,
      })),
    }),
    observationFloor,
    unresolved,
    keys: [session.objectKey],
    uploadIds,
  };
}

export function finiteOutputSnapshot(
  attempt: MediaProcessingOutputAttempt,
  writes: readonly MediaProcessingOutputWrite[],
): FiniteCleanupSnapshot {
  if (attempt.protocolVersion !== 2 || !attempt.writesFrozenAt)
    throw new FiniteCleanupUnresolved("OUTPUT_WRITES_NOT_FROZEN");
  const addresses = outputAttemptAddresses({
    channelId: attempt.channelId,
    videoId: attempt.videoId,
    generation: attempt.generation,
    outputAttemptId: attempt.id,
  });
  if (
    [
      [attempt.prefix, addresses.prefix],
      [attempt.canonicalR2ObjectKey, addresses.canonicalR2ObjectKey],
      [attempt.hlsR2Prefix, addresses.hlsR2Prefix],
      [attempt.thumbnailR2ObjectKey, addresses.thumbnailR2ObjectKey],
    ].some(([reserved, expected]) => reserved !== expected) ||
    writes.some(
      (write) =>
        write.outputAttemptId !== attempt.id ||
        write.processingJobId !== attempt.processingJobId ||
        write.claimToken !== attempt.claimToken ||
        write.attempt !== attempt.attempt ||
        !write.objectKey.startsWith(attempt.prefix) ||
        write.objectKey.slice(attempt.prefix.length).includes(".."),
    )
  )
    throw new FiniteCleanupUnresolved("OUTPUT_ADDRESS_HISTORY_INVALID");
  const ordered = [...writes].sort((a, b) => a.objectKey.localeCompare(b.objectKey));
  const keys = [
    ...new Set([
      attempt.canonicalR2ObjectKey,
      attempt.thumbnailR2ObjectKey,
      `${attempt.hlsR2Prefix}master.m3u8`,
      ...ordered.map((write) => write.objectKey),
    ]),
  ].sort();
  return {
    writeSetDigest: digest({
      attemptId: attempt.id,
      frozenAt: attempt.writesFrozenAt.toISOString(),
      keys,
      writes: ordered.map((write) => ({
        id: write.id,
        key: write.objectKey,
        bytes: write.expectedSizeBytes.toString(),
        contentType: write.contentType,
        status: write.status,
        dispatchedAt: write.dispatchedAt.toISOString(),
        acknowledgedAt: write.acknowledgedAt?.toISOString() ?? null,
      })),
    }),
    observationFloor: new Date(
      ordered.reduce(
        (latest, write) => Math.max(latest, write.acknowledgedAt?.getTime() ?? 0),
        attempt.writesFrozenAt.getTime(),
      ),
    ),
    unresolved: ordered.some((write) => write.status !== "ACKNOWLEDGED" || !write.acknowledgedAt)
      ? "OUTPUT_WRITE_OUTCOME_UNKNOWN"
      : null,
    keys,
    uploadIds: [],
  };
}

export function finiteRecheckAt(now: Date, retainUntil: Date | null) {
  if (!retainUntil || retainUntil <= now) return null;
  return new Date(Math.min(retainUntil.getTime(), now.getTime() + FINITE_CLEANUP_RECHECK_MS));
}

export function finiteDebtKind(code: string) {
  if (code === "ALLOCATION_OUTCOME_UNKNOWN") return "ALLOCATION_RESOURCE";
  if (code.includes("OUTCOME_UNKNOWN")) return "UNKNOWN_WRITE";
  if (code === "OUTPUT_STILL_LIVE") return "LIVE_REFERENCE";
  return "CLEANUP_OBSERVATION";
}
