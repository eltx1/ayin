import { randomUUID } from "node:crypto";
import {
  type MediaUploadSession,
  type PrivacyMediaDeletionJob,
  type PrismaClient,
  Prisma,
} from "@ayin/db";
import {
  type MediaStorageAdapter,
  MediaStorageObservationError,
  type UploadCleanupSettlementBinding,
  type UploadCleanupSettlementEvidence,
} from "../media/media-storage.adapter.js";
import { R2HttpError } from "../media/r2-sigv4.js";
import {
  cleanupOperationKey,
  MAX_MEDIA_CLEANUP_ATTEMPTS,
  registerUploadCleanupInTransaction,
} from "../media/media-upload-cleanup.js";
import {
  assertChannelMediaOwners,
  observeChannelMediaOwners,
} from "../media/media-privacy-account-fence.js";
import { lockMediaGeneration } from "../media/media-generation-safety.js";
import {
  FINITE_CLEANUP_CONCLUSION,
  FINITE_CLEANUP_OBJECTS_PER_PASS,
  FINITE_CLEANUP_SLOW_RETRY_MS,
  FINITE_CLEANUP_VERSION,
  FiniteCleanupUnresolved,
  finiteAbortReceipt,
  finiteDebtKind,
  finiteOutputSnapshot,
  finiteRecheckAt,
  finiteSourceSnapshot,
  type FiniteCleanupEvidence,
  type FiniteCleanupSnapshot,
} from "./privacy-media-cleanup-v2.js";

const LEASE_MS = 5 * 60 * 1000;
export { MAX_MEDIA_CLEANUP_ATTEMPTS } from "../media/media-upload-cleanup.js";

type Claim = PrivacyMediaDeletionJob & { leaseToken: string; leaseExpiresAt: Date; target: string };
class UnresolvedCleanup extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function observationCode(error: unknown): string {
  if (error instanceof UnresolvedCleanup || error instanceof FiniteCleanupUnresolved)
    return error.code;
  if (error instanceof MediaStorageObservationError) return error.code;
  // Never persist provider error bodies, keys, tokens or signed URLs.
  return "PROVIDER_ERROR";
}

export async function claimMediaCleanupJob(db: PrismaClient, now: Date): Promise<Claim | null> {
  const eligible = Prisma.sql`"target" IS NOT NULL AND
    ("cleanupContractVersion" = 2 OR "attempts" < ${MAX_MEDIA_CLEANUP_ATTEMPTS}) AND
    (("status" = 'PENDING' AND "availableAt" <= ${now}) OR
     ("status" = 'PROCESSING' AND COALESCE("leaseExpiresAt", "claimedAt" + interval '5 minutes') <= ${now}) OR
     ("cleanupContractVersion" = 2 AND "status" = 'DONE' AND "recheckAt" <= ${now}) OR
     ("cleanupContractVersion" = 2 AND "status" = 'FAILED' AND "availableAt" <= ${now}))`;
  // A small unlocked candidate window avoids head-of-line blocking while
  // preserving request-before-job locking. Each try owns a separate transaction
  // so no contender accumulates differently ordered request locks.
  const candidates = await db.$queryRaw<
    Array<{
      id: string;
      requestId: string | null;
      cleanupContractVersion: number;
    }>
  >(Prisma.sql`SELECT id, "requestId", "cleanupContractVersion"
    FROM "PrivacyMediaDeletionJob" WHERE ${eligible} ORDER BY "createdAt", id LIMIT 16`);
  for (const selected of candidates) {
    try {
      const claim = await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '3000ms'`;
          if (selected.cleanupContractVersion === 2 && selected.requestId) {
            const request = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM "AccountDeletionRequest" WHERE id=${selected.requestId}::uuid
            FOR UPDATE SKIP LOCKED`;
            if (request.length !== 1) return null;
          }
          const token = randomUUID();
          const claims = await tx.$queryRaw<Claim[]>(Prisma.sql`
          WITH candidate AS (
            SELECT id FROM "PrivacyMediaDeletionJob" WHERE id=${selected.id}::uuid AND ${eligible}
            FOR UPDATE SKIP LOCKED LIMIT 1
          )
          UPDATE "PrivacyMediaDeletionJob" j SET "status" = 'PROCESSING',
            "attempts" = j."attempts" + 1, "claimedAt" = ${now},
            "recheckCount" = j."recheckCount" + CASE WHEN j.status = 'DONE' THEN 1 ELSE 0 END,
            "leaseToken" = ${token}::uuid, "leaseExpiresAt" = ${new Date(now.getTime() + LEASE_MS)}, "updatedAt" = ${now}
          FROM candidate WHERE j.id = candidate.id RETURNING j.*`);
          const claimed = claims[0] ?? null;
          // Adoption could change the observed request. Never acquire a new
          // request after job: rollback so a later pass can use its current owner.
          if (claimed && claimed.requestId !== selected.requestId)
            throw new FiniteCleanupUnresolved("CLEANUP_REQUEST_CHANGED");
          // One commit makes both the new observation and reopened privacy state
          // durable, even if the worker crashes immediately after claiming.
          if (claimed?.cleanupContractVersion === 2 && claimed.requestId)
            await tx.accountDeletionRequest.update({
              where: { id: claimed.requestId },
              data: {
                mediaCleanupCompletedAt: null,
              },
            });
          return claimed;
        },
        { maxWait: 2000, timeout: 5000 },
      );
      if (claim) return claim;
    } catch (error) {
      if (!(error instanceof FiniteCleanupUnresolved && error.code === "CLEANUP_REQUEST_CHANGED"))
        throw error;
    }
  }
  return null;
}

async function withClaim<T>(
  db: PrismaClient,
  claim: Claim,
  work: (tx: Prisma.TransactionClient, session: MediaUploadSession | null) => Promise<T>,
): Promise<T | null> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '3000ms'`;
      let session: MediaUploadSession | null = null;
      if (claim.cleanupContractVersion === 2 && claim.outputAttemptId) {
        const attempt = await tx.mediaProcessingOutputAttempt.findUnique({
          where: { id: claim.outputAttemptId },
        });
        if (!attempt || attempt.processingJobId !== claim.processingJobId) return null;
        const owners = await observeChannelMediaOwners(tx, attempt.channelId);
        if (owners.length)
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "Account" WHERE id IN (${Prisma.join(owners.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`,
          );
        await assertChannelMediaOwners(tx, attempt.channelId, owners);
        await lockMediaGeneration(tx, attempt.videoId);
        await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE "r2ObjectKey"=${attempt.thumbnailR2ObjectKey}
          AND kind='THUMBNAIL' ORDER BY id FOR NO KEY UPDATE`;
        await tx.$queryRaw`SELECT id FROM "MediaProcessingJob" WHERE id=${attempt.processingJobId}::uuid FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM "MediaProcessingOutputAttempt" WHERE id=${attempt.id}::uuid FOR SHARE`;
        // Automatic thumbnail reservations precede their PUT. A frozen attempt
        // can no longer validate one, so its exact still-PENDING reservation is
        // retired under the normal asset-before-job fence. Published or uploaded
        // thumbnails remain protected by the live-reference checks below.
        const frozen = await tx.mediaProcessingOutputAttempt.findUnique({
          where: { id: attempt.id },
        });
        if (frozen?.protocolVersion === 2 && frozen.writesFrozenAt)
          await tx.mediaAsset.updateMany({
            where: {
              r2ObjectKey: frozen.thumbnailR2ObjectKey,
              kind: "THUMBNAIL",
              status: "PENDING",
              removedAt: null,
            },
            data: { status: "REMOVED", removedAt: new Date() },
          });
      }
      if (claim.uploadSessionId) {
        // Privacy/revocation uses the same session -> obligation lock order.
        await tx.$queryRaw`SELECT id FROM "MediaUploadSession" WHERE id=${claim.uploadSessionId}::uuid FOR SHARE /* ayin-cleanup-result-session-lock */`;
        session = await tx.mediaUploadSession.findUnique({ where: { id: claim.uploadSessionId } });
        if (
          !session ||
          session.revision !== claim.sessionRevision ||
          !session.grantsRevokedAt ||
          !session.cleanupRequestedAt ||
          !["REVOKED", "EXPIRED", "ABORTED", "COMPLETED"].includes(session.state) ||
          session.objectKey !== claim.target
        )
          return null;
      }
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "PrivacyMediaDeletionJob" WHERE id=${claim.id}::uuid
        AND status='PROCESSING' AND "leaseToken"=${claim.leaseToken}::uuid
        AND attempts=${claim.attempts} AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
      FOR UPDATE /* ayin-cleanup-result-lease-lock */`;
      if (rows.length !== 1) return null;
      return work(tx, session);
    },
    { maxWait: 2000, timeout: 5000 },
  );
}

export async function finishMediaCleanupJob(
  db: PrismaClient,
  claim: Claim,
  now = new Date(),
  evidence?: UploadCleanupSettlementEvidence,
) {
  if (claim.cleanupContractVersion === 2 || claim.kind === "OUTPUT_SETTLEMENT") return false;
  if (claim.scope !== "PRIVACY" && !evidence) return false;
  const finished = await withClaim(db, claim, async (tx, session) => {
    if (
      claim.scope !== "PRIVACY" &&
      (!session ||
        !evidence ||
        evidence.binding.sessionId !== session.id ||
        evidence.binding.sessionRevision !== session.revision ||
        evidence.binding.grantsRevokedAt !== session.grantsRevokedAt?.toISOString() ||
        evidence.binding.lastGrantExpiresAt !==
          (session.lastGrantExpiresAt?.toISOString() ?? null) ||
        evidence.binding.key !== claim.target ||
        evidence.binding.uploadId !== claim.providerUploadId ||
        evidence.binding.operationKey !== claim.operationKey ||
        evidence.binding.kind !== claim.kind ||
        evidence.binding.leaseToken !== claim.leaseToken ||
        evidence.binding.attempt !== claim.attempts)
    )
      return null;
    await tx.privacyMediaDeletionJob.update({
      where: { id: claim.id },
      data: {
        status: "DONE",
        completedAt: now,
        lastError: null,
        lastObservation: "CLEANUP_VERIFIED",
        ...(evidence
          ? {
              settlementProofReference: evidence.provenance.proofReference,
              settlementVerifiedAt: evidence.verifiedAt,
              settlementLeaseToken: claim.leaseToken,
            }
          : {}),
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    const job = await tx.privacyMediaDeletionJob.findUniqueOrThrow({ where: { id: claim.id } });
    return { requestId: job.requestId };
  });
  // Release session/job locks before request locking: privacy takes the request
  // before session/jobs. Holding them here would invert that accepted order.
  if (finished?.requestId)
    await db.$transaction((tx) => finalizeMediaCleanup(tx, finished.requestId!, now));
  return finished !== null;
}

async function finalizeMediaCleanup(tx: Prisma.TransactionClient, requestId: string, now: Date) {
  // Registration/adoption holds the request row through the privacy transaction.
  // Count and completion are one serialized transaction; FAILED blocks completion.
  await tx.$queryRaw`SELECT id FROM "AccountDeletionRequest" WHERE id=${requestId}::uuid FOR UPDATE /* ayin-media-cleanup-request-lock */`;
  const request = await tx.accountDeletionRequest.findUnique({ where: { id: requestId } });
  if (!request?.mediaCleanupQueuedAt || request.state !== "ANONYMIZED") return;
  const remaining = await tx.privacyMediaDeletionJob.count({
    where: { requestId, status: { not: "DONE" } },
  });
  if (remaining === 0)
    await tx.accountDeletionRequest.update({
      where: { id: requestId },
      data: { mediaCleanupCompletedAt: now, lastError: null },
    });
}

async function retryMediaCleanupJob(db: PrismaClient, claim: Claim, now: Date, error: unknown) {
  const code = observationCode(error);
  const failed = await withClaim(db, claim, async (tx) => {
    const current = await tx.privacyMediaDeletionJob.findUniqueOrThrow({ where: { id: claim.id } });
    const finite = claim.cleanupContractVersion === 2;
    await tx.privacyMediaDeletionJob.update({
      where: { id: claim.id },
      data: {
        status: !finite && claim.attempts >= MAX_MEDIA_CLEANUP_ATTEMPTS ? "FAILED" : "PENDING",
        availableAt: new Date(
          Math.max(Date.now(), now.getTime()) +
            (finite && code.startsWith("LATE_")
              ? 1000
              : finite && claim.attempts >= MAX_MEDIA_CLEANUP_ATTEMPTS
                ? FINITE_CLEANUP_SLOW_RETRY_MS
                : Math.min(60000, 2 ** Math.min(claim.attempts, 6) * 1000)),
        ),
        ...(finite
          ? {
              completedAt: null,
              ...(code.startsWith("LATE_") || code.includes("OUTCOME_UNKNOWN")
                ? { cleanupEvidence: Prisma.JsonNull, observedAbsentAt: null }
                : {}),
              debtKind: finiteDebtKind(code),
              debtSince: current.debtSince ?? now,
              recheckAt: null,
            }
          : {}),
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: code,
        lastObservation: code,
      },
    });
    const job = await tx.privacyMediaDeletionJob.findUniqueOrThrow({ where: { id: claim.id } });
    return { requestId: job.requestId };
  });
  if (failed?.requestId && claim.attempts >= MAX_MEDIA_CLEANUP_ATTEMPTS)
    await db.accountDeletionRequest.update({
      where: { id: failed.requestId },
      data: {
        lastError: "One or more media obligations require operator review/retry.",
        mediaCleanupCompletedAt: null,
      },
    });
}

async function verifySettlement(
  storage: MediaStorageAdapter,
  job: Claim,
  session: MediaUploadSession,
) {
  if (!session.grantsRevokedAt || job.kind === "PREFIX" || job.kind === "OUTPUT_SETTLEMENT")
    throw new UnresolvedCleanup("INVALID_CLEANUP_CONTRACT");
  const binding: UploadCleanupSettlementBinding = {
    provider: storage.kind,
    operationKey: job.operationKey,
    kind: job.kind,
    key: job.target,
    uploadId: job.providerUploadId,
    sessionId: session.id,
    sessionRevision: session.revision,
    mode: session.mode,
    grantsRevokedAt: session.grantsRevokedAt.toISOString(),
    lastGrantExpiresAt: session.lastGrantExpiresAt?.toISOString() ?? null,
    leaseToken: job.leaseToken,
    attempt: job.attempts,
  };
  if (!storage.verifyUploadCleanupSettlement) throw new UnresolvedCleanup("SETTLEMENT_UNVERIFIED");
  if (!session.lastGrantExpiresAt) throw new UnresolvedCleanup("GRANT_HISTORY_UNVERIFIED");
  const evidence = await storage.verifyUploadCleanupSettlement(binding);
  if (!evidence) throw new UnresolvedCleanup("SETTLEMENT_UNVERIFIED");
  if (
    !evidence.binding ||
    Object.keys(binding).some(
      (key) =>
        evidence.binding[key as keyof typeof binding] !== binding[key as keyof typeof binding],
    ) ||
    evidence.conclusion !== "NO_FUTURE_ALLOCATION_OR_WRITE" ||
    evidence.provenance?.provider !== storage.kind ||
    evidence.provenance?.verifierVersion !== "AYIN_UPLOAD_SETTLEMENT_V1" ||
    typeof evidence.provenance?.proofReference !== "string" ||
    !/^[a-zA-Z0-9_.:-]{1,200}$/.test(evidence.provenance.proofReference) ||
    !(evidence.verifiedAt instanceof Date) ||
    !Number.isFinite(evidence.verifiedAt.getTime()) ||
    evidence.verifiedAt < job.claimedAt! ||
    evidence.verifiedAt < session.grantsRevokedAt ||
    evidence.verifiedAt > new Date() ||
    evidence.verifiedAt >= job.leaseExpiresAt ||
    (session.lastGrantExpiresAt && evidence.verifiedAt < session.lastGrantExpiresAt)
  )
    throw new UnresolvedCleanup("INVALID_SETTLEMENT_EVIDENCE");
  return evidence;
}

async function multipartAbsent(storage: MediaStorageAdapter, job: Claim) {
  if (!job.providerUploadId) throw new UnresolvedCleanup("INVALID_CLEANUP_CONTRACT");
  try {
    await storage.listParts({ key: job.target, uploadId: job.providerUploadId });
    return false;
  } catch (error) {
    if (
      error instanceof MediaStorageObservationError &&
      error.operation === "listParts" &&
      error.code === "NO_SUCH_UPLOAD" &&
      error.providerStatus === 404
    )
      return true;
    throw error;
  }
}

async function requireObjectAbsent(storage: MediaStorageAdapter, target: string) {
  try {
    await storage.headObject(target);
  } catch (error) {
    // HEAD absence is point-in-time evidence only; settlement is separately required.
    if (error instanceof R2HttpError && error.method === "HEAD" && error.status === 404) return;
    throw error;
  }
  throw new UnresolvedCleanup("OBJECT_PRESENT");
}

async function processDurableClaim(db: PrismaClient, storage: MediaStorageAdapter, job: Claim) {
  const session = await withClaim(db, job, async (_tx, value) => value);
  if (!session) return;
  let evidence: UploadCleanupSettlementEvidence;
  if (job.kind === "ALLOCATION") {
    const uploads = await storage.listMultipartUploads(job.target);
    if (!Array.isArray(uploads) || uploads.length > 10000)
      throw new UnresolvedCleanup("INVALID_RESPONSE");
    const exact = uploads.filter((upload) => upload.key === job.target);
    const seen = new Set<string>();
    for (const upload of exact) {
      if (
        typeof upload.uploadId !== "string" ||
        !upload.uploadId.trim() ||
        Buffer.byteLength(upload.uploadId) > 1024 ||
        seen.has(upload.uploadId)
      )
        throw new UnresolvedCleanup("INVALID_RESPONSE");
      seen.add(upload.uploadId);
    }
    const persisted = await withClaim(db, job, async (tx) => {
      const current = await tx.privacyMediaDeletionJob.findUniqueOrThrow({ where: { id: job.id } });
      if (exact.length)
        await tx.privacyMediaDeletionJob.createMany({
          data: exact.map((upload) => ({
            operationKey: cleanupOperationKey(`upload:${session.id}`, "multipart", upload.uploadId),
            scope: job.scope,
            processingJobId: job.processingJobId,
            requestId: current.requestId,
            accountId: current.accountId,
            channelId: session.channelId,
            uploadSessionId: session.id,
            sessionRevision: session.revision,
            sourceAssetId: job.sourceAssetId,
            kind: "MULTIPART",
            target: job.target,
            providerUploadId: upload.uploadId,
            retainUntil: job.retainUntil,
          })),
          skipDuplicates: true,
        });
      return true;
    });
    if (!persisted) return;
    if (exact.length) throw new UnresolvedCleanup("ALLOCATIONS_REMAIN");
    evidence = await verifySettlement(storage, job, session);
    // Re-observe AFTER the certified settlement fence. Prefix matches are not adopted.
    if (
      (await storage.listMultipartUploads(job.target)).some((upload) => upload.key === job.target)
    )
      throw new UnresolvedCleanup("ALLOCATIONS_REMAIN");
  } else if (job.kind === "MULTIPART") {
    if (!(await multipartAbsent(storage, job))) {
      try {
        await storage.abortMultipartUpload({ key: job.target, uploadId: job.providerUploadId! });
      } catch (error) {
        if (!(
          error instanceof R2HttpError &&
          error.status === 404 &&
          error.providerCode === "NoSuchUpload"
        ))
          throw error;
      }
    }
    if (!(await multipartAbsent(storage, job))) throw new UnresolvedCleanup("MULTIPART_PRESENT");
    evidence = await verifySettlement(storage, job, session);
    if (!(await multipartAbsent(storage, job))) throw new UnresolvedCleanup("MULTIPART_PRESENT");
    // NoSuchUpload is not evidence that complete did not create an object.
    await requireObjectAbsent(storage, job.target);
  } else if (job.kind === "OBJECT") {
    await storage.deleteObject(job.target);
    await requireObjectAbsent(storage, job.target);
    evidence = await verifySettlement(storage, job, session);
    // Delete again after settlement, then verify absence at the settled address.
    await storage.deleteObject(job.target);
    await requireObjectAbsent(storage, job.target);
  } else throw new UnresolvedCleanup("INVALID_CLEANUP_CONTRACT");
  await finishMediaCleanupJob(db, job, new Date(), evidence);
}

function evidenceRecord(value: Prisma.JsonValue | null): Prisma.JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

async function requireOutputRetired(tx: Prisma.TransactionClient, claim: Claim) {
  if (!claim.outputAttemptId || claim.kind !== "OUTPUT_SETTLEMENT")
    throw new FiniteCleanupUnresolved("INVALID_FINITE_OUTPUT_CONTRACT");
  const attempt = await tx.mediaProcessingOutputAttempt.findUnique({
    where: { id: claim.outputAttemptId },
  });
  if (
    !attempt ||
    attempt.processingJobId !== claim.processingJobId ||
    attempt.channelId !== claim.channelId ||
    attempt.canonicalR2ObjectKey !== claim.target
  )
    throw new FiniteCleanupUnresolved("OUTPUT_ADDRESS_HISTORY_INVALID");
  // A frozen journal forbids more dispatches, but freezing alone does not retire
  // winning playback. Also protect a retired generation still being consumed by
  // a newer in-progress reprocess, and all live thumbnail/canonical references.
  const [assets, consumers, generations, renditions] = await Promise.all([
    tx.mediaAsset.count({
      where: {
        r2ObjectKey: { startsWith: attempt.prefix },
        removedAt: null,
        status: { in: ["PENDING", "UPLOADED", "VALIDATED"] },
      },
    }),
    tx.mediaProcessingJob.count({
      where: {
        status: {
          in: ["INGESTING", "QUEUED", "INTEGRITY_QUEUED", "PROCESSING", "UPLOADING", "VERIFYING"],
        },
        OR: [
          { inputR2ObjectKey: { startsWith: attempt.prefix } },
          { currentOutputAttemptId: attempt.id },
        ],
      },
    }),
    tx.mediaPlaybackGeneration.count({
      where: {
        status: { not: "SUPERSEDED" },
        OR: [
          { outputAttemptId: attempt.id, status: "READY" },
          { fallbackR2ObjectKey: { startsWith: attempt.prefix }, fallbackStatus: "READY" },
          { hlsMasterR2ObjectKey: { startsWith: attempt.prefix }, hlsMasterStatus: "READY" },
        ],
      },
    }),
    tx.mediaPlaybackRendition.count({
      where: {
        status: "READY",
        playlistR2ObjectKey: { startsWith: attempt.prefix },
        playbackGeneration: { status: { not: "SUPERSEDED" } },
      },
    }),
  ]);
  if (assets || consumers || generations || renditions)
    throw new FiniteCleanupUnresolved("OUTPUT_STILL_LIVE");
  return attempt;
}

async function finiteSnapshot(
  tx: Prisma.TransactionClient,
  claim: Claim,
  session: MediaUploadSession | null,
): Promise<FiniteCleanupSnapshot> {
  if (claim.uploadSessionId) {
    if (!session) throw new FiniteCleanupUnresolved("INVALID_FINITE_SOURCE_CONTRACT");
    return finiteSourceSnapshot(
      session,
      await tx.mediaUploadOperation.findMany({
        where: { sessionId: session.id },
        orderBy: { id: "asc" },
      }),
      new Date(),
    );
  }
  const attempt = await requireOutputRetired(tx, claim);
  return finiteOutputSnapshot(
    attempt,
    await tx.mediaProcessingOutputWrite.findMany({
      where: { outputAttemptId: attempt.id },
      orderBy: { objectKey: "asc" },
    }),
  );
}

async function objectAbsent(storage: MediaStorageAdapter, key: string) {
  try {
    await storage.headObject(key);
    return false;
  } catch (error) {
    if (error instanceof R2HttpError && error.method === "HEAD" && error.status === 404)
      return true;
    throw error;
  }
}

/** Finite evidence is validated again against the current frozen journal while
 * holding the same lease/ownership fences used to take its initial snapshot. */
export async function finishFiniteMediaCleanupJob(
  db: PrismaClient,
  claim: Claim,
  evidence: FiniteCleanupEvidence,
  now = new Date(),
) {
  if (claim.cleanupContractVersion !== 2) return false;
  const finished = await withClaim(db, claim, async (tx, session) => {
    const snapshot = await finiteSnapshot(tx, claim, session);
    const observed = new Date(evidence.observedAbsentAt);
    const started = new Date(evidence.observationStartedAt);
    if (
      snapshot.unresolved ||
      evidence.version !== FINITE_CLEANUP_VERSION ||
      evidence.conclusion !== FINITE_CLEANUP_CONCLUSION ||
      evidence.operationKey !== claim.operationKey ||
      evidence.kind !== claim.kind ||
      evidence.leaseToken !== claim.leaseToken ||
      evidence.attempt !== claim.attempts ||
      evidence.sessionId !== claim.uploadSessionId ||
      evidence.sessionRevision !== claim.sessionRevision ||
      evidence.outputAttemptId !== claim.outputAttemptId ||
      evidence.writeSetDigest !== snapshot.writeSetDigest ||
      evidence.exactObjectCount !== snapshot.keys.length ||
      !Number.isFinite(observed.getTime()) ||
      !Number.isFinite(started.getTime()) ||
      started < snapshot.observationFloor ||
      observed < started ||
      observed > now ||
      observed < claim.claimedAt! ||
      observed >= claim.leaseExpiresAt ||
      (claim.kind === "MULTIPART" &&
        (evidence.abortUploadIdDigest !==
          finiteAbortReceipt(claim.providerUploadId, null).abortUploadIdDigest ||
          !evidence.abortAcknowledgedAt ||
          !Number.isFinite(new Date(evidence.abortAcknowledgedAt).getTime()) ||
          new Date(evidence.abortAcknowledgedAt) > observed))
    )
      return null;
    const finalRetentionObservation = !!claim.retainUntil && started >= claim.retainUntil;
    await tx.privacyMediaDeletionJob.update({
      where: { id: claim.id },
      data: {
        status: "DONE",
        completedAt: now,
        observedAbsentAt: observed,
        settlementLeaseToken: claim.leaseToken,
        cleanupEvidence: {
          ...evidence,
          retentionCheckedAt: finalRetentionObservation ? observed.toISOString() : null,
        },
        lastError: null,
        lastObservation: "FROZEN_ACKNOWLEDGED_OBSERVED_ABSENT",
        debtKind: null,
        debtSince: null,
        // A sweep begun before retention ended is not the final recheck, even
        // when its last page completed afterward.
        recheckAt: finalRetentionObservation
          ? null
          : (finiteRecheckAt(now, claim.retainUntil) ?? (claim.retainUntil ? now : null)),
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    const current = await tx.privacyMediaDeletionJob.findUniqueOrThrow({ where: { id: claim.id } });
    return { requestId: current.requestId };
  });
  if (finished?.requestId)
    await db.$transaction((tx) => finalizeMediaCleanup(tx, finished.requestId!, now));
  return finished !== null;
}

async function persistFiniteProgress(
  db: PrismaClient,
  claim: Claim,
  snapshot: FiniteCleanupSnapshot,
  nextObjectIndex: number,
  observationStartedAt: Date,
  recheck: boolean,
) {
  return withClaim(db, claim, async (tx) => {
    const current = await tx.privacyMediaDeletionJob.findUniqueOrThrow({ where: { id: claim.id } });
    await tx.privacyMediaDeletionJob.update({
      where: { id: claim.id },
      data: {
        status: "PENDING",
        availableAt: new Date(Date.now() + 1000),
        leaseToken: null,
        leaseExpiresAt: null,
        completedAt: null,
        debtKind: "CLEANUP_OBSERVATION",
        debtSince: current.debtSince ?? new Date(),
        lastObservation: "EXACT_OBSERVATION_IN_PROGRESS",
        lastError: null,
        cleanupEvidence: {
          version: "AYIN_CLEANUP_V2_PROGRESS",
          writeSetDigest: snapshot.writeSetDigest,
          operationKey: claim.operationKey,
          outputAttemptId: claim.outputAttemptId,
          nextObjectIndex,
          observationStartedAt: observationStartedAt.toISOString(),
          recheck,
        },
      },
    });
    return true;
  });
}

async function persistDiscoveredAllocations(
  db: PrismaClient,
  claim: Claim,
  snapshot: FiniteCleanupSnapshot,
  uploads: Array<{ key: string; uploadId: string }>,
) {
  if (!claim.uploadSessionId || uploads.length > 10000)
    throw new FiniteCleanupUnresolved("INVALID_RESPONSE");
  const ids = [...new Set([...snapshot.uploadIds, ...uploads.map((upload) => upload.uploadId)])];
  if (ids.some((id) => !id.trim() || Buffer.byteLength(id) > 1024))
    throw new FiniteCleanupUnresolved("INVALID_RESPONSE");
  return withClaim(db, claim, async (tx) => {
    const current = await tx.privacyMediaDeletionJob.findUniqueOrThrow({ where: { id: claim.id } });
    if (ids.length) {
      await tx.privacyMediaDeletionJob.createMany({
        data: ids.map((id) => ({
          operationKey: cleanupOperationKey(`upload:${claim.uploadSessionId}`, "multipart", id),
          scope: claim.scope,
          processingJobId: claim.processingJobId,
          requestId: current.requestId,
          accountId: current.accountId,
          channelId: claim.channelId,
          uploadSessionId: claim.uploadSessionId,
          sessionRevision: claim.sessionRevision,
          sourceAssetId: claim.sourceAssetId,
          kind: "MULTIPART",
          target: claim.target,
          providerUploadId: id,
          cleanupContractVersion: 2,
          retainUntil: claim.retainUntil,
        })),
        skipDuplicates: true,
      });
      const present = uploads.map((upload) =>
        cleanupOperationKey(`upload:${claim.uploadSessionId}`, "multipart", upload.uploadId),
      );
      if (present.length)
        await tx.privacyMediaDeletionJob.updateMany({
          where: { operationKey: { in: present }, cleanupContractVersion: 2, status: "DONE" },
          data: {
            status: "PENDING",
            availableAt: new Date(),
            completedAt: null,
            observedAbsentAt: null,
            settlementLeaseToken: null,
            cleanupEvidence: Prisma.JsonNull,
            debtKind: "CLEANUP_OBSERVATION",
            debtSince: new Date(),
            recheckAt: null,
            lastObservation: "LATE_ALLOCATION_FOUND",
            sessionRevision: claim.sessionRevision,
          },
        });
    }
    return true;
  });
}

async function processFiniteClaim(db: PrismaClient, storage: MediaStorageAdapter, claim: Claim) {
  const snapshot = await withClaim(db, claim, (tx, session) => finiteSnapshot(tx, claim, session));
  if (!snapshot) return;
  const previous = evidenceRecord(claim.cleanupEvidence);
  const progress =
    previous?.version === "AYIN_CLEANUP_V2_PROGRESS" &&
    previous.writeSetDigest === snapshot.writeSetDigest &&
    previous.operationKey === claim.operationKey &&
    previous.outputAttemptId === claim.outputAttemptId;
  const recheck =
    previous?.version === FINITE_CLEANUP_VERSION || (progress && previous?.recheck === true);
  let started =
    progress && typeof previous?.observationStartedAt === "string"
      ? new Date(previous.observationStartedAt)
      : new Date();
  let cursor =
    progress && typeof previous?.nextObjectIndex === "number" ? previous.nextObjectIndex : 0;
  if (
    !Number.isSafeInteger(cursor) ||
    cursor < 0 ||
    cursor > snapshot.keys.length ||
    !Number.isFinite(started.getTime()) ||
    started < snapshot.observationFloor
  ) {
    cursor = 0;
    started = new Date();
  }
  let abortAcknowledgedAt: Date | null = null;
  if (claim.uploadSessionId) {
    if (claim.kind === "ALLOCATION") {
      const uploads = await storage.listMultipartUploads(claim.target);
      if (
        !Array.isArray(uploads) ||
        uploads.length > 10000 ||
        uploads.some(
          (upload) => typeof upload.key !== "string" || typeof upload.uploadId !== "string",
        )
      )
        throw new FiniteCleanupUnresolved("INVALID_RESPONSE");
      const exact = uploads.filter((upload) => upload.key === claim.target);
      if (!(await persistDiscoveredAllocations(db, claim, snapshot, exact))) return;
      if (exact.length)
        throw new FiniteCleanupUnresolved(recheck ? "LATE_ALLOCATION_FOUND" : "ALLOCATIONS_REMAIN");
    } else if (claim.kind === "MULTIPART") {
      if (!claim.providerUploadId)
        throw new FiniteCleanupUnresolved("INVALID_FINITE_SOURCE_CONTRACT");
      if (recheck && !(await multipartAbsent(storage, claim)))
        throw new FiniteCleanupUnresolved("LATE_MULTIPART_FOUND");
      try {
        await storage.abortMultipartUpload({ key: claim.target, uploadId: claim.providerUploadId });
      } catch (error) {
        if (!(
          error instanceof R2HttpError &&
          error.status === 404 &&
          error.providerCode === "NoSuchUpload"
        ))
          throw error;
      }
      abortAcknowledgedAt = new Date();
      // A terminal abort response is recorded separately from both the source
      // CREATE/COMPLETE journal and the later residual-parts observation.
      if (
        !(await withClaim(db, claim, async (tx) => {
          await tx.privacyMediaDeletionJob.update({
            where: { id: claim.id },
            data: {
              cleanupEvidence: {
                version: "AYIN_CLEANUP_V2_ABORT",
                operationKey: claim.operationKey,
                leaseToken: claim.leaseToken,
                attempt: claim.attempts,
                uploadId: claim.providerUploadId,
                abortAcknowledgedAt: abortAcknowledgedAt!.toISOString(),
              },
            },
          });
          return true;
        }))
      )
        return;
      if (!(await multipartAbsent(storage, claim)))
        throw new FiniteCleanupUnresolved("MULTIPART_PRESENT");
    } else if (claim.kind !== "OBJECT") {
      throw new FiniteCleanupUnresolved("INVALID_FINITE_SOURCE_CONTRACT");
    }
  } else if (claim.kind !== "OUTPUT_SETTLEMENT") {
    throw new FiniteCleanupUnresolved("INVALID_FINITE_OUTPUT_CONTRACT");
  }
  let count = 0;
  for (
    ;
    cursor < snapshot.keys.length && count < FINITE_CLEANUP_OBJECTS_PER_PASS;
    cursor++, count++
  ) {
    if (Date.now() >= claim.leaseExpiresAt.getTime() - 10000) break;
    const key = snapshot.keys[cursor]!;
    if (recheck && !(await objectAbsent(storage, key)))
      throw new FiniteCleanupUnresolved("LATE_OBJECT_FOUND");
    await storage.deleteObject(key);
    await requireObjectAbsent(storage, key);
  }
  if (cursor < snapshot.keys.length) {
    await persistFiniteProgress(db, claim, snapshot, cursor, started, recheck);
    return;
  }
  // UNKNOWN never becomes ACKNOWLEDGED by deletion, absence or elapsed time.
  // Complete each bounded sweep before resetting its cursor for a slow retry.
  if (snapshot.unresolved) throw new FiniteCleanupUnresolved(snapshot.unresolved);
  const observed = new Date();
  await finishFiniteMediaCleanupJob(
    db,
    claim,
    {
      version: FINITE_CLEANUP_VERSION,
      conclusion: FINITE_CLEANUP_CONCLUSION,
      operationKey: claim.operationKey,
      kind: claim.kind,
      leaseToken: claim.leaseToken,
      attempt: claim.attempts,
      writeSetDigest: snapshot.writeSetDigest,
      observedAbsentAt: observed.toISOString(),
      observationStartedAt: started.toISOString(),
      sessionId: claim.uploadSessionId,
      sessionRevision: claim.sessionRevision,
      outputAttemptId: claim.outputAttemptId,
      exactObjectCount: snapshot.keys.length,
      ...finiteAbortReceipt(
        claim.kind === "MULTIPART" ? claim.providerUploadId : null,
        abortAcknowledgedAt,
      ),
      retentionCheckedAt: null,
    },
    observed,
  );
}

export async function expireUploadSessions(db: PrismaClient, now: Date, limit: number) {
  const candidates = await db.mediaUploadSession.findMany({
    where: {
      hardExpiresAt: { lte: now },
      state: { in: ["PREPARING", "OPEN", "FINALIZING", "CANCELLING", "UNRESOLVED"] },
    },
    select: { id: true },
    orderBy: [{ hardExpiresAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  for (const candidate of candidates)
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '3000ms'`;
        const observed = await tx.mediaUploadSession.findUnique({ where: { id: candidate.id } });
        if (!observed) return;
        const owners = await observeChannelMediaOwners(tx, observed.channelId);
        const accountIds = [
          ...new Set([
            ...owners,
            ...(observed.initiatingAccountId ? [observed.initiatingAccountId] : []),
          ]),
        ].sort();
        // The session/channel snapshots own orphan cleanup when account FKs have
        // disappeared; no invented account identity and no dropped obligation.
        if (accountIds.length)
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "Account" WHERE id IN (${Prisma.join(accountIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE /* ayin-upload-expiry-account-lock */`,
          );
        await assertChannelMediaOwners(tx, observed.channelId, owners);
        if (observed.videoId) await lockMediaGeneration(tx, observed.videoId);
        if (observed.sourceAssetId)
          await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${observed.sourceAssetId}::uuid FOR NO KEY UPDATE /* ayin-upload-expiry-source-lock */`;
        await tx.$queryRaw`SELECT id FROM "MediaUploadSession" WHERE id=${candidate.id}::uuid FOR UPDATE /* ayin-upload-expiry-session-lock */`;
        const current = await tx.mediaUploadSession.findUnique({ where: { id: candidate.id } });
        if (
          !current ||
          current.revision !== observed.revision ||
          current.hardExpiresAt > now ||
          !["PREPARING", "OPEN", "FINALIZING", "CANCELLING", "UNRESOLVED"].includes(current.state)
        )
          return;
        await registerUploadCleanupInTransaction(tx, {
          sessionId: current.id,
          accountId: current.initiatingAccountId ?? accountIds[0] ?? null,
          state: "EXPIRED",
          now,
        });
      },
      { maxWait: 2000, timeout: 5000 },
    );
}

export async function minimizeCompletedUploadCleanup(db: PrismaClient, now: Date, limit: number) {
  // Filter eligibility before LIMIT: old unresolved work must not starve the
  // finite retention of later verified sessions.
  const candidates = await db.$queryRaw<Array<{ id: string }>>`
    SELECT s.id FROM "MediaUploadSession" s
    WHERE s."cleanupRetainUntil" <= ${now} AND s."cleanupRequestedAt" IS NOT NULL
      AND s.state IN ('REVOKED', 'EXPIRED', 'ABORTED', 'COMPLETED')
      AND EXISTS (SELECT 1 FROM "PrivacyMediaDeletionJob" j WHERE j."uploadSessionId" = s.id)
      AND NOT EXISTS (SELECT 1 FROM "PrivacyMediaDeletionJob" j WHERE j."uploadSessionId" = s.id AND
        (j.status <> 'DONE' OR (j."cleanupContractVersion" = 2 AND
          (j."recheckAt" IS NOT NULL OR j."observedAbsentAt" IS NULL OR
           j."observedAbsentAt" < j."retainUntil" OR j."cleanupEvidence"->>'retentionCheckedAt' IS NULL))))
    ORDER BY s."cleanupRetainUntil", s.id LIMIT ${limit}`;
  for (const candidate of candidates)
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "MediaUploadSession" WHERE id=${candidate.id}::uuid FOR UPDATE`;
      const session = await tx.mediaUploadSession.findUnique({ where: { id: candidate.id } });
      if (!session?.cleanupRetainUntil || session.cleanupRetainUntil > now) return;
      const jobs = await tx.privacyMediaDeletionJob.findMany({
        where: { uploadSessionId: session.id },
        select: {
          status: true,
          cleanupContractVersion: true,
          retainUntil: true,
          observedAbsentAt: true,
          recheckAt: true,
          cleanupEvidence: true,
        },
      });
      if (
        !jobs.length ||
        jobs.some(
          (job) =>
            job.status !== "DONE" ||
            (job.cleanupContractVersion === 2 &&
              (!job.retainUntil ||
                !job.observedAbsentAt ||
                job.observedAbsentAt < job.retainUntil ||
                job.recheckAt ||
                !evidenceRecord(job.cleanupEvidence)?.retentionCheckedAt)),
        )
      )
        return;
      await tx.privacyMediaDeletionJob.updateMany({
        where: { uploadSessionId: session.id, status: "DONE" },
        data: { target: null, providerUploadId: null, sourceAssetId: null },
      });
      // Command hashes/IDs expire only with the verified terminal session.
      // No cascade may erase a live or unresolved operation/cleanup obligation.
      await tx.mediaUploadOperation.deleteMany({ where: { sessionId: session.id } });
      // Snapshot job IDs remain for idempotency/audit. No FK cascade can erase work.
      await tx.mediaUploadSession.delete({ where: { id: session.id } });
    });
}

/** Final retention observation precedes address minimization. A remaining
 * current/winning reference retains the immutable journal rather than weakening
 * that reference or manufacturing a cleanup outcome. */
export async function minimizeCompletedOutputCleanup(db: PrismaClient, now: Date, limit: number) {
  const candidates = await db.$queryRaw<Array<{ id: string }>>`
    SELECT j.id FROM "PrivacyMediaDeletionJob" j
    WHERE j."cleanupContractVersion"=2 AND j."outputAttemptId" IS NOT NULL AND j.status='DONE'
      AND j."retainUntil" <= ${now} AND j."observedAbsentAt" >= j."retainUntil"
      AND j."recheckAt" IS NULL AND j."cleanupEvidence"->>'retentionCheckedAt' IS NOT NULL
      AND (j.target IS NOT NULL OR ayin_output_attempt_minimizable(j."outputAttemptId"))
    ORDER BY j."retainUntil", j.id LIMIT ${limit}`;
  for (const candidate of candidates) {
    await db.$transaction(async (tx) => {
      const initial = await tx.privacyMediaDeletionJob.findUnique({ where: { id: candidate.id } });
      if (!initial?.outputAttemptId) return;
      const attempt = await tx.mediaProcessingOutputAttempt.findUnique({
        where: { id: initial.outputAttemptId },
      });
      if (!attempt || attempt.protocolVersion !== 2 || !attempt.writesFrozenAt) return;
      const owners = await observeChannelMediaOwners(tx, attempt.channelId);
      if (owners.length)
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Account" WHERE id IN (${Prisma.join(owners.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`,
        );
      await assertChannelMediaOwners(tx, attempt.channelId, owners);
      await lockMediaGeneration(tx, attempt.videoId);
      await tx.$queryRaw`SELECT id FROM "MediaProcessingJob" WHERE id=${attempt.processingJobId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "MediaProcessingOutputAttempt" WHERE id=${attempt.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "PrivacyMediaDeletionJob" WHERE id=${candidate.id}::uuid FOR UPDATE`;
      const current = await tx.privacyMediaDeletionJob.findUniqueOrThrow({
        where: { id: candidate.id },
      });
      const evidence = evidenceRecord(current.cleanupEvidence);
      if (
        current.status !== "DONE" ||
        !current.retainUntil ||
        current.retainUntil > now ||
        !current.observedAbsentAt ||
        current.observedAbsentAt < current.retainUntil ||
        current.recheckAt ||
        !evidence?.retentionCheckedAt
      )
        return;
      const unsettled = await tx.privacyMediaDeletionJob.count({
        where: {
          outputAttemptId: attempt.id,
          status: { not: "DONE" },
        },
      });
      if (unsettled) return;
      try {
        await requireOutputRetired(tx, {
          ...current,
          target: attempt.canonicalR2ObjectKey,
        } as Claim);
      } catch (error) {
        if (error instanceof FiniteCleanupUnresolved && error.code === "OUTPUT_STILL_LIVE") return;
        throw error;
      }
      if (
        await tx.mediaProcessingOutputWrite.count({
          where: {
            outputAttemptId: attempt.id,
            status: { not: "ACKNOWLEDGED" },
          },
        })
      )
        return;
      if (current.target !== null)
        await tx.privacyMediaDeletionJob.update({
          where: { id: current.id },
          data: {
            target: null,
            sourceAssetId: null,
            providerUploadId: null,
            outputAddresses: {
              version: 3,
              minimized: true,
              writeSetDigest: evidence.writeSetDigest ?? null,
            },
          },
        });
      const [eligibility] = await tx.$queryRaw<Array<{ allowed: boolean }>>`
        SELECT ayin_output_attempt_minimizable(${attempt.id}::uuid) AS allowed`;
      if (!eligibility?.allowed) return;
      await tx.mediaProcessingOutputWrite.deleteMany({ where: { outputAttemptId: attempt.id } });
      await tx.mediaProcessingOutputAttempt.delete({ where: { id: attempt.id } });
    });
  }
}

export async function minimizeCompletedOutputReservations(db: PrismaClient, limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1) return 0;
  // All state is local. The database repeats the exact final-retention predicate
  // in its DELETE guard; no live, retryable or uncertain counter can be reset.
  return db.$executeRaw`
    WITH candidate AS (
      SELECT id FROM "MediaProcessingOutputReservation"
      WHERE ayin_output_reservation_minimizable(id)
      ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT ${Math.min(limit, 100)}
    )
    DELETE FROM "MediaProcessingOutputReservation" r USING candidate
      WHERE r.id=candidate.id AND ayin_output_reservation_minimizable(r.id)`;
}

export async function processPrivacyMediaDeletionBatch(
  db: PrismaClient,
  storage: MediaStorageAdapter,
  now: Date,
  limit: number,
) {
  // A fifth claim can crash before recording failure. Make exhaustion visible.
  await db.privacyMediaDeletionJob.updateMany({
    where: {
      cleanupContractVersion: 1,
      attempts: { gte: MAX_MEDIA_CLEANUP_ATTEMPTS },
      OR: [
        { status: "PENDING" },
        { status: "PROCESSING", leaseExpiresAt: { lte: now } },
        {
          status: "PROCESSING",
          leaseExpiresAt: null,
          claimedAt: { lte: new Date(now.getTime() - LEASE_MS) },
        },
      ],
    },
    data: {
      status: "FAILED",
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: "LEASE_RETRY_EXHAUSTED",
      lastObservation: "LEASE_RETRY_EXHAUSTED",
    },
  });
  let processed = 0;
  for (let index = 0; index < limit; index += 1) {
    const job = await claimMediaCleanupJob(db, new Date());
    if (!job) break;
    try {
      if (job.kind === "OUTPUT_SETTLEMENT" && job.cleanupContractVersion !== 2)
        throw new UnresolvedCleanup("OUTPUT_SETTLEMENT_UNVERIFIED");
      if (!storage.available) throw new UnresolvedCleanup("STORAGE_UNAVAILABLE");
      if (job.cleanupContractVersion === 2) await processFiniteClaim(db, storage, job);
      else if (job.scope === "PRIVACY") {
        if (job.kind === "PREFIX") await storage.deletePrefix(job.target);
        else await storage.deleteObject(job.target);
        await finishMediaCleanupJob(db, job);
      } else await processDurableClaim(db, storage, job);
    } catch (error) {
      await retryMediaCleanupJob(db, job, now, error);
    }
    processed += 1;
  }
  // Claimed cleanup must progress even if one expiry transaction later waits
  // behind an active authority lock and hits its bounded timeout.
  await expireUploadSessions(db, new Date(), limit);
  await minimizeCompletedUploadCleanup(db, new Date(), limit);
  await minimizeCompletedOutputCleanup(db, new Date(), limit);
  await minimizeCompletedOutputReservations(db, limit);
  const requests = await db.accountDeletionRequest.findMany({
    where: {
      state: "ANONYMIZED",
      mediaCleanupQueuedAt: { not: null },
      mediaCleanupCompletedAt: null,
      mediaDeletionJobs: { none: { status: { not: "DONE" } } },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  for (const request of requests)
    await db.$transaction((tx) => finalizeMediaCleanup(tx, request.id, new Date()));
  return processed;
}
