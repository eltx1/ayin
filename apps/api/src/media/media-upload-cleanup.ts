import { createHash } from "node:crypto";
import type { MediaUploadSession, Prisma } from "@ayin/db";

export const MAX_MEDIA_CLEANUP_ATTEMPTS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export function uploadCleanupRetentionDays(raw = process.env.MEDIA_UPLOAD_CLEANUP_RETENTION_DAYS) {
  const days = Number(raw ?? 30);
  return Number.isInteger(days) && days >= 1 && days <= 365 ? days : 30;
}

export function cleanupRetentionDeadline(now: Date) {
  return new Date(now.getTime() + uploadCleanupRetentionDays() * DAY_MS);
}

export function cleanupOperationKey(owner: string, kind: string, address: string) {
  return `${owner}:${kind}:${createHash("sha256").update(address).digest("hex")}`;
}

export function uploadCleanupJobData(
  session: MediaUploadSession,
  accountId: string | null,
  requestId: string | null,
  now: Date,
) {
  const shared = {
    accountId,
    requestId,
    scope: "UPLOAD_SESSION" as const,
    channelId: session.channelId,
    uploadSessionId: session.id,
    sessionRevision: session.revision,
    sourceAssetId: session.sourceAssetId,
    target: session.objectKey,
    retainUntil: session.cleanupRetainUntil ?? cleanupRetentionDeadline(now),
  };
  return [
    { ...shared, operationKey: `upload:${session.id}:object`, kind: "OBJECT" as const },
    ...(session.mode === "MULTIPART"
      ? [
          // A PREPARING create can have succeeded before its response was lost.
          // Even a known ID does not exclude another allocation from a lost attempt.
          {
            ...shared,
            operationKey: `upload:${session.id}:allocation`,
            kind: "ALLOCATION" as const,
          },
          ...(session.providerUploadId
            ? [
                {
                  ...shared,
                  operationKey: cleanupOperationKey(
                    `upload:${session.id}`,
                    "multipart",
                    session.providerUploadId,
                  ),
                  kind: "MULTIPART" as const,
                  providerUploadId: session.providerUploadId,
                },
              ]
            : []),
        ]
      : []),
  ];
}

// Caller owns sorted Account locks and exact-set source locks before this helper.
// Revoke, snapshot cleanup addresses and adopt ALL prior obligations atomically.
// No provider operation or grant is made while the transaction is open.
export async function registerUploadCleanupInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    sessionId: string;
    accountId: string | null;
    requestId?: string;
    state: "REVOKED" | "EXPIRED" | "ABORTED";
    now: Date;
  },
) {
  await tx.$queryRaw`SELECT id FROM "MediaUploadSession" WHERE id=${input.sessionId}::uuid FOR UPDATE /* ayin-upload-cleanup-session-lock */`;
  const previous = await tx.mediaUploadSession.findUnique({ where: { id: input.sessionId } });
  if (!previous) return false;
  // Transfer acceptance is a boundary. Cancelling a completed processing job
  // needs output-write cleanup, not just this original-upload obligation.
  if (previous.state === "COMPLETED" && !input.requestId)
    throw new Error("Completed uploads require the processing/privacy lifecycle for removal.");
  const session = await tx.mediaUploadSession.update({
    where: { id: previous.id },
    data: {
      state: input.state,
      revision: { increment: 1 },
      grantsRevokedAt: previous.grantsRevokedAt ?? input.now,
      cleanupRequestedAt: previous.cleanupRequestedAt ?? input.now,
      cleanupRetainUntil: previous.cleanupRetainUntil ?? cleanupRetentionDeadline(input.now),
      contentIdentityDigest: null,
    },
  });
  await tx.privacyMediaDeletionJob.createMany({
    data: uploadCleanupJobData(session, input.accountId, input.requestId ?? null, input.now),
    skipDuplicates: true,
  });
  // A worker holding an older lease cannot finish after this revision/adoption.
  // FAILED stays visible for operator review; privacy never drops its obligations.
  await tx.privacyMediaDeletionJob.updateMany({
    where: {
      uploadSessionId: session.id,
      status: "PROCESSING",
      attempts: { gte: MAX_MEDIA_CLEANUP_ATTEMPTS },
    },
    data: {
      status: "FAILED",
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: "LEASE_REVOKED_RETRY_EXHAUSTED",
    },
  });
  await tx.privacyMediaDeletionJob.updateMany({
    where: {
      uploadSessionId: session.id,
      status: "PROCESSING",
      attempts: { lt: MAX_MEDIA_CLEANUP_ATTEMPTS },
    },
    data: { status: "PENDING", availableAt: input.now, leaseToken: null, leaseExpiresAt: null },
  });
  await tx.privacyMediaDeletionJob.updateMany({
    where: { uploadSessionId: session.id, status: { not: "DONE" } },
    data: { sessionRevision: session.revision },
  });
  if (input.requestId)
    await tx.privacyMediaDeletionJob.updateMany({
      where: { uploadSessionId: session.id },
      data: { requestId: input.requestId },
    });
  if (session.sourceAssetId)
    await tx.mediaAsset.updateMany({
      where: {
        id: session.sourceAssetId,
        r2ObjectKey: session.objectKey,
        status: { in: ["PENDING", "UPLOADED"] },
      },
      data: { status: "REMOVED", removedAt: input.now },
    });
  if (input.requestId) {
    await tx.accountDeletionRequest.update({
      where: { id: input.requestId },
      data: { mediaCleanupCompletedAt: null },
    });
  }
  return true;
}

// The processing worker invokes this inside its owned READY transaction, after
// persisting immutable input integrity. It must never delete staging beforehand.
export async function registerProcessingSourceCleanup(
  tx: Prisma.TransactionClient,
  input: {
    jobId: string;
    accountId: string;
    sessionId: string;
    sourceAssetId: string;
    stagingKey: string;
    now: Date;
  },
) {
  await tx.$queryRaw`SELECT id FROM "MediaUploadSession" WHERE id=${input.sessionId}::uuid FOR UPDATE /* ayin-processing-source-cleanup-session-lock */`;
  const session = await tx.mediaUploadSession.findUnique({ where: { id: input.sessionId } });
  if (
    !session ||
    session.state !== "COMPLETED" ||
    session.objectKey !== input.stagingKey ||
    (session.sourceAssetId !== null && session.sourceAssetId !== input.sourceAssetId)
  )
    throw new Error("The durable source cleanup identity changed before READY.");
  const retainUntil = session.cleanupRetainUntil ?? cleanupRetentionDeadline(input.now);
  await tx.privacyMediaDeletionJob.createMany({
    data: [
      {
        operationKey: `processing-source:${input.jobId}`,
        scope: "PROCESSING_SOURCE",
        // Accepted media belongs to the channel, not its initiating uploader.
        accountId: null,
        channelId: session.channelId,
        uploadSessionId: input.sessionId,
        sessionRevision: session.revision,
        sourceAssetId: input.sourceAssetId,
        processingJobId: input.jobId,
        kind: "OBJECT",
        target: input.stagingKey,
        retainUntil,
      },
    ],
    skipDuplicates: true,
  });
  const multipartJobs = uploadCleanupJobData(session, null, null, input.now)
    .filter((job) => job.kind !== "OBJECT")
    .map((job) => ({ ...job, scope: "PROCESSING_SOURCE" as const, processingJobId: input.jobId }));
  if (multipartJobs.length)
    await tx.privacyMediaDeletionJob.createMany({
      data: multipartJobs,
      skipDuplicates: true,
    });
  await tx.mediaUploadSession.update({
    where: { id: session.id },
    data: {
      contentIdentityDigest: null,
      grantsRevokedAt: session.grantsRevokedAt ?? input.now,
      cleanupRequestedAt: session.cleanupRequestedAt ?? input.now,
      cleanupRetainUntil: retainUntil,
    },
  });
}
