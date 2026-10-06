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

const LEASE_MS = 5 * 60 * 1000;
export { MAX_MEDIA_CLEANUP_ATTEMPTS } from "../media/media-upload-cleanup.js";

type Claim = PrivacyMediaDeletionJob & { leaseToken: string; leaseExpiresAt: Date; target: string };
class UnresolvedCleanup extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function observationCode(error: unknown): string {
  if (error instanceof UnresolvedCleanup) return error.code;
  if (error instanceof MediaStorageObservationError) return error.code;
  // Never persist provider error bodies, keys, tokens or signed URLs.
  return "PROVIDER_ERROR";
}

export async function claimMediaCleanupJob(db: PrismaClient, now: Date): Promise<Claim | null> {
  const token = randomUUID();
  const claims = await db.$queryRaw<Claim[]>`
    WITH candidate AS (
      SELECT id FROM "PrivacyMediaDeletionJob"
      WHERE "attempts" < ${MAX_MEDIA_CLEANUP_ATTEMPTS} AND
        (("status" = 'PENDING' AND "availableAt" <= ${now}) OR
         ("status" = 'PROCESSING' AND COALESCE("leaseExpiresAt", "claimedAt" + interval '5 minutes') <= ${now}))
      ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE "PrivacyMediaDeletionJob" j SET "status" = 'PROCESSING',
      "attempts" = j."attempts" + 1, "claimedAt" = ${now},
      "leaseToken" = ${token}::uuid, "leaseExpiresAt" = ${new Date(now.getTime() + LEASE_MS)}, "updatedAt" = ${now}
    FROM candidate WHERE j.id = candidate.id RETURNING j.*`;
  return claims[0] ?? null;
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
  if (claim.kind === "OUTPUT_SETTLEMENT") return false;
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
    await tx.privacyMediaDeletionJob.update({
      where: { id: claim.id },
      data: {
        status: claim.attempts >= MAX_MEDIA_CLEANUP_ATTEMPTS ? "FAILED" : "PENDING",
        availableAt: new Date(
          Math.max(Date.now(), now.getTime()) + Math.min(60000, 2 ** claim.attempts * 1000),
        ),
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
      AND NOT EXISTS (SELECT 1 FROM "PrivacyMediaDeletionJob" j WHERE j."uploadSessionId" = s.id AND j.status <> 'DONE')
    ORDER BY s."cleanupRetainUntil", s.id LIMIT ${limit}`;
  for (const candidate of candidates)
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "MediaUploadSession" WHERE id=${candidate.id}::uuid FOR UPDATE`;
      const session = await tx.mediaUploadSession.findUnique({ where: { id: candidate.id } });
      if (!session?.cleanupRetainUntil || session.cleanupRetainUntil > now) return;
      const jobs = await tx.privacyMediaDeletionJob.findMany({
        where: { uploadSessionId: session.id },
        select: { status: true },
      });
      if (!jobs.length || jobs.some((job) => job.status !== "DONE")) return;
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

export async function processPrivacyMediaDeletionBatch(
  db: PrismaClient,
  storage: MediaStorageAdapter,
  now: Date,
  limit: number,
) {
  // A fifth claim can crash before recording failure. Make exhaustion visible.
  await db.privacyMediaDeletionJob.updateMany({
    where: {
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
      if (job.kind === "OUTPUT_SETTLEMENT")
        throw new UnresolvedCleanup("OUTPUT_SETTLEMENT_UNVERIFIED");
      if (!storage.available) throw new UnresolvedCleanup("STORAGE_UNAVAILABLE");
      if (job.scope === "PRIVACY") {
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
