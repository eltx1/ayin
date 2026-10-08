import type {
  RecoverableUploadSession,
  UploadFileIdentity,
  UploadRecoveryCommandResponse,
} from "@ayin/types";
import { uploadId, uploadRecord } from "./quick-upload-contract";
import { UploadProtocolError, validateUploadUrl } from "./upload-session";

export interface RecoveryScope {
  accountId: string;
  profileId: string;
  channelId: string;
}
export type RecoveryCommand = "CREATE" | "RESUME" | "AUTHORIZE" | "COMPLETE" | "CANCEL";
export interface SavedRecovery {
  version: 1;
  scope: RecoveryScope;
  creationRequestId: string;
  session: RecoverableUploadSession | null;
  pending: { kind: RecoveryCommand; requestId: string } | null;
}
export type RecoveryObservation =
  | {
      kind: "PARTS_OBSERVED";
      parts: { partNumber: number; sizeBytes: number }[];
      uploadedBytes: number;
    }
  | { kind: "STORED_UNVERIFIED"; sizeBytes: number }
  | { kind: "UNAVAILABLE" | "NOT_INSPECTED" };
export interface RecoveryInspection {
  session: RecoverableUploadSession;
  observation: RecoveryObservation;
}

export function boundedInteger(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw new UploadProtocolError();
  return value;
}
function date(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    !/^\d{4}-\d\d-\d\dT/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new UploadProtocolError();
  return value;
}
export function parseRecoveryScope(value: unknown): RecoveryScope {
  const row = uploadRecord(value);
  return {
    accountId: uploadId(row.accountId),
    profileId: uploadId(row.profileId),
    channelId: uploadId(row.channelId),
  };
}
export function sameScope(a: RecoveryScope, b: RecoveryScope) {
  return a.accountId === b.accountId && a.profileId === b.profileId && a.channelId === b.channelId;
}
export function parseFileIdentity(value: unknown, sizeBytes: number): UploadFileIdentity {
  const row = uploadRecord(value);
  boundedInteger(sizeBytes, 1, 50 * 1024 ** 3);
  if (
    row.algorithm !== "AYIN_SHA256_CHUNKS_V1" ||
    row.version !== 1 ||
    row.sizeBytes !== sizeBytes ||
    row.chunkSizeBytes !== 4 * 1024 * 1024 ||
    row.leafCount !== Math.ceil(sizeBytes / (4 * 1024 * 1024)) ||
    typeof row.rootSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.rootSha256)
  )
    throw new UploadProtocolError();
  return {
    algorithm: row.algorithm,
    version: 1,
    sizeBytes,
    chunkSizeBytes: row.chunkSizeBytes,
    leafCount: row.leafCount as number,
    rootSha256: row.rootSha256,
  };
}
const states = [
  "PREPARING",
  "OPEN",
  "FINALIZING",
  "COMPLETED",
  "CANCELLING",
  "ABORTED",
  "EXPIRED",
  "REVOKED",
  "UNRESOLVED",
];
export function parseRecoverySession(
  value: unknown,
  scope: RecoveryScope,
  previous?: RecoverableUploadSession | null,
): RecoverableUploadSession {
  const row = uploadRecord(value);
  if (
    row.protocolVersion !== 1 ||
    row.actorAccountId !== scope.accountId ||
    row.channelId !== scope.channelId ||
    !states.includes(String(row.state)) ||
    !["SINGLE", "MULTIPART"].includes(String(row.mode))
  )
    throw new UploadProtocolError();
  const sizeBytes = boundedInteger(row.sizeBytes, 1, 50 * 1024 ** 3);
  const partSizeBytes = boundedInteger(row.partSizeBytes);
  const partCount = boundedInteger(row.partCount, 1, 10000);
  if (
    partCount !== (row.mode === "SINGLE" ? 1 : Math.ceil(sizeBytes / partSizeBytes)) ||
    typeof row.mimeType !== "string" ||
    !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(row.mimeType) ||
    row.mimeType.length > 128
  )
    throw new UploadProtocolError();
  const session: RecoverableUploadSession = {
    protocolVersion: 1,
    actorAccountId: scope.accountId,
    channelId: scope.channelId,
    sessionId: uploadId(row.sessionId),
    assetId: row.assetId === null ? null : uploadId(row.assetId),
    videoId: row.videoId === null ? null : uploadId(row.videoId),
    state: row.state as RecoverableUploadSession["state"],
    revision: boundedInteger(row.revision, 1, 2147483647),
    mode: row.mode as "SINGLE" | "MULTIPART",
    sizeBytes,
    mimeType: row.mimeType,
    partSizeBytes,
    partCount,
    expiresAt: date(row.expiresAt),
  };
  if (previous) {
    for (const field of [
      "sessionId",
      "assetId",
      "videoId",
      "sizeBytes",
      "mimeType",
      "mode",
      "partSizeBytes",
      "partCount",
      "expiresAt",
    ] as const)
      if (session[field] !== previous[field]) throw new UploadProtocolError();
    if (session.revision < previous.revision) throw new UploadProtocolError();
  }
  return session;
}
export function parseRecoveryResponse(
  value: unknown,
  scope: RecoveryScope,
  requestId: string,
  previous: RecoverableUploadSession | null,
  authorizePart?: number,
): UploadRecoveryCommandResponse {
  const row = uploadRecord(value),
    operation = uploadRecord(row.operation);
  const session = parseRecoverySession(row.session, scope, previous);
  if (
    operation.requestId !== requestId ||
    !["SUCCEEDED", "PENDING", "UNKNOWN"].includes(String(operation.status)) ||
    typeof operation.replayed !== "boolean"
  )
    throw new UploadProtocolError();
  const result: UploadRecoveryCommandResponse = {
    session,
    operation: {
      requestId,
      status: operation.status as "SUCCEEDED" | "PENDING" | "UNKNOWN",
      replayed: operation.replayed,
    },
  };
  if (row.cleanup !== undefined) {
    const cleanup = uploadRecord(row.cleanup);
    if (cleanup.authorityRevoked !== true || cleanup.settlement !== "PENDING")
      throw new UploadProtocolError();
    result.cleanup = { authorityRevoked: true, settlement: "PENDING" };
  }
  if (row.grant !== undefined) {
    const grant = uploadRecord(row.grant),
      headers = uploadRecord(grant.headers);
    const expiresAt = date(grant.expiresAt);
    if (
      !authorizePart ||
      grant.partNumber !== authorizePart ||
      grant.method !== "PUT" ||
      operation.status !== "SUCCEEDED" ||
      operation.replayed ||
      session.state !== "OPEN" ||
      Date.parse(expiresAt) <= Date.now() ||
      Date.parse(expiresAt) > Date.parse(session.expiresAt) ||
      !validGrantHeaders(headers, session)
    )
      throw new UploadProtocolError();
    result.grant = {
      url: validateUploadUrl(grant.url),
      method: "PUT",
      headers: Object.fromEntries(
        Object.entries(headers).map(([name, header]) => [name, String(header)]),
      ),
      expiresAt,
      partNumber: authorizePart,
    };
  }
  return result;
}
function validGrantHeaders(headers: Record<string, unknown>, session: RecoverableUploadSession) {
  const normalized = new Map<string, unknown>();
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (normalized.has(key) || typeof value !== "string") return false;
    normalized.set(key, value);
    if (key === "content-type") {
      if (value !== session.mimeType) return false;
    } else if (session.mode !== "SINGLE") return false;
    else if (key === "x-amz-meta-ayin-upload-session") {
      if (value !== session.sessionId) return false;
    } else if (key === "x-amz-meta-ayin-source-asset") {
      if (value !== session.assetId) return false;
    } else if (key === "x-amz-meta-ayin-identity-root") {
      if (!/^[a-f0-9]{64}$/.test(value)) return false;
    } else return false;
  }
  const metadataCount = [...normalized.keys()].filter((key) => key !== "content-type").length;
  // Dormant adapters may issue content-type-only grants. Provider identity
  // metadata, when present, must be the complete exact-bound SINGLE triplet.
  return metadataCount === 0 || metadataCount === 3;
}
export function parseRecoveryInspection(
  value: unknown,
  scope: RecoveryScope,
  previous: RecoverableUploadSession,
): RecoveryInspection {
  const row = uploadRecord(value),
    session = parseRecoverySession(row, scope, previous),
    observation = uploadRecord(row.observation);
  if (observation.kind === "PARTS_OBSERVED") {
    if (
      session.mode !== "MULTIPART" ||
      !Array.isArray(observation.parts) ||
      observation.parts.length > session.partCount
    )
      throw new UploadProtocolError();
    const seen = new Set<number>();
    const parts = observation.parts.map((value: unknown) => {
      const part = uploadRecord(value),
        partNumber = boundedInteger(part.partNumber, 1, session.partCount),
        sizeBytes = boundedInteger(part.sizeBytes);
      if (
        seen.has(partNumber) ||
        sizeBytes !==
          Math.min(
            session.partSizeBytes,
            session.sizeBytes - (partNumber - 1) * session.partSizeBytes,
          )
      )
        throw new UploadProtocolError();
      seen.add(partNumber);
      return { partNumber, sizeBytes };
    });
    const uploadedBytes = parts.reduce((total, part) => total + part.sizeBytes, 0);
    if (observation.uploadedBytes !== uploadedBytes) throw new UploadProtocolError();
    return { session, observation: { kind: "PARTS_OBSERVED", parts, uploadedBytes } };
  }
  if (observation.kind === "STORED_UNVERIFIED") {
    if (observation.sizeBytes !== session.sizeBytes) throw new UploadProtocolError();
    return { session, observation: { kind: "STORED_UNVERIFIED", sizeBytes: session.sizeBytes } };
  }
  if (observation.kind !== "UNAVAILABLE" && observation.kind !== "NOT_INSPECTED")
    throw new UploadProtocolError();
  return { session, observation: { kind: observation.kind } };
}
/** Rebuild from the allowlist both when loading AND saving. Never stringify a server object. */
export function parseSavedRecovery(value: unknown, scope: RecoveryScope): SavedRecovery {
  const row = uploadRecord(value),
    savedScope = parseRecoveryScope(row.scope);
  if (row.version !== 1 || !sameScope(savedScope, scope)) throw new UploadProtocolError();
  const session = row.session === null ? null : parseRecoverySession(row.session, scope);
  const pending = row.pending === null ? null : uploadRecord(row.pending);
  if (
    pending &&
    !["CREATE", "RESUME", "AUTHORIZE", "COMPLETE", "CANCEL"].includes(String(pending.kind))
  )
    throw new UploadProtocolError();
  if (!session && (!pending || pending.kind !== "CREATE")) throw new UploadProtocolError();
  return {
    version: 1,
    scope: savedScope,
    creationRequestId: uploadId(row.creationRequestId),
    session,
    pending: pending
      ? { kind: pending.kind as RecoveryCommand, requestId: uploadId(pending.requestId) }
      : null,
  };
}
