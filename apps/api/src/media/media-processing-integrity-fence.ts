import type { MediaClaimIdentity } from "./media-output-attempt.js";
import { Prisma } from "@ayin/db";
import {
  assertChannelMediaOwners,
  lockChannelMediaAccounts,
  observeChannelMediaOwners,
} from "./media-privacy-account-fence.js";
import { hasNewerMediaGeneration, lockMediaGeneration } from "./media-generation-safety.js";
import {
  assertJobInputIntegrity,
  hasCurrentInputVerification,
} from "./media-processing-integrity.js";

export async function declareCompatibleIntegrityWorker(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT set_config('ayin.media_integrity_worker_version', '2', true)`;
}

type OwnedFenceOptions = MediaClaimIdentity & {
  requireInput?: boolean;
  requireOutput?: boolean;
  lockThumbnails?: boolean;
};

export function lockOwnedMediaJob(
  tx: Prisma.TransactionClient,
  jobId: string,
  workerId: string,
  options: OwnedFenceOptions = {},
) {
  return lockEligibleMediaJob(tx, jobId, workerId, options);
}

/** Required claims share the very same custody/source/generation lock prefix
 * as callbacks, but have no output attempt or byte proof yet. */
export function lockQueuedIntegrityJob(
  tx: Prisma.TransactionClient,
  jobId: string,
  expectedAttempt: number,
) {
  return lockEligibleMediaJob(tx, jobId, null, { queuedAttempt: expectedAttempt });
}

/** Account -> generation -> exact asset set -> job -> video/channel, matching
 * privacy's account/asset prefix. Provider and byte work never run under locks. */
async function lockEligibleMediaJob(
  tx: Prisma.TransactionClient,
  jobId: string,
  workerId: string | null,
  options: OwnedFenceOptions & { queuedAttempt?: number } = {},
) {
  await tx.$executeRaw`SET LOCAL lock_timeout = '3000ms'`;
  const observed = await tx.mediaProcessingJob.findUnique({
    where: { id: jobId },
    include: { video: { select: { channelId: true } } },
  });
  if (!observed) return null;
  const owners = await observeChannelMediaOwners(tx, observed.video.channelId);
  // COMPLETED transfer belongs to the channel. The initiating account on the
  // immutable declaration is provenance, not an ongoing worker permission.
  // In particular, closing a former administrator must not strand foreign
  // owners' already accepted media or canonical-derived reprocessing.
  const owner = owners[0];
  if (owner) await lockChannelMediaAccounts(tx, owner, owners);
  await assertChannelMediaOwners(tx, observed.video.channelId, owners);
  const accounts = owners;
  // Shared channels survive one co-owner's departure. Keep every owner locked
  // for privacy ordering, but only a channel with no remaining active owner is
  // blocked while closed memberships await anonymization/removal.
  if (
    accounts.length &&
    (await tx.account.count({ where: { id: { in: accounts }, status: "ACTIVE" } })) === 0
  )
    return null;
  await lockMediaGeneration(tx, observed.videoId);
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "MediaAsset" WHERE "r2ObjectKey" IN (${Prisma.join([observed.inputR2ObjectKey ?? "", observed.outputR2ObjectKey])})
      ${options.lockThumbnails ? Prisma.sql`OR ("videoId" = ${observed.videoId}::uuid AND kind = 'THUMBNAIL')` : Prisma.empty}
      ORDER BY id FOR NO KEY UPDATE /* ayin-worker-integrity-asset-lock */`,
  );
  await tx.$queryRaw`SELECT id FROM "MediaProcessingJob" WHERE id = ${jobId}::uuid FOR UPDATE /* ayin-worker-integrity-job-lock */`;
  const job = await tx.mediaProcessingJob.findFirst({
    where: {
      id: jobId,
      ...(workerId === null
        ? {
            leaseOwner: null,
            status: "INTEGRITY_QUEUED",
            inputIntegrityVersion: 1,
            attempt: options.queuedAttempt!,
          }
        : {
            leaseOwner: workerId,
            status: { in: ["PROCESSING", "UPLOADING", "VERIFYING"] },
            leaseExpiresAt: { gt: new Date() },
          }),
    },
    include: {
      video: {
        select: {
          id: true,
          channelId: true,
          status: true,
          removedAt: true,
          channel: { select: { status: true, removedAt: true, isPlatformOwned: true } },
        },
      },
    },
  });
  if (
    !job ||
    job.video.channelId !== observed.video.channelId ||
    (await hasNewerMediaGeneration(tx, job))
  )
    return null;
  await tx.$queryRaw`SELECT id FROM "Video" WHERE id = ${job.videoId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Channel" WHERE id = ${job.video.channelId}::uuid FOR SHARE`;
  const video = await tx.video.findUnique({
    where: { id: job.videoId },
    select: {
      status: true,
      removedAt: true,
      channel: { select: { status: true, removedAt: true, isPlatformOwned: true } },
    },
  });
  if (
    !video ||
    video.status === "REMOVED" ||
    video.removedAt ||
    video.channel.status === "REMOVED" ||
    video.channel.removedAt
  )
    return null;
  const expected = assertJobInputIntegrity(job);
  if (expected) {
    if (workerId !== null) {
      if (
        options.attempt !== job.attempt ||
        !options.outputAttemptId ||
        options.outputAttemptId !== job.currentOutputAttemptId
      )
        return null;
      const outputAttempt = await tx.mediaProcessingOutputAttempt.findUnique({
        where: { id: options.outputAttemptId },
      });
      if (
        !outputAttempt ||
        outputAttempt.processingJobId !== job.id ||
        outputAttempt.claimToken !== workerId ||
        outputAttempt.attempt !== job.attempt ||
        outputAttempt.canonicalR2ObjectKey !== job.outputR2ObjectKey
      )
        return null;
    }
    // Empty membership is not platform custody: member-owned jobs cannot be
    // promoted by an orphaning race. Both the accepted immutable snapshot and
    // the current explicit platform classification must authorize that case.
    if (
      owners.length === 0 &&
      !(job.inputIntegrityOwnerlessPlatform && video.channel.isPlatformOwned)
    )
      return null;
    // Original source eligibility ends when its transfer session is revoked or
    // cleanup begins. A transformed canonical input has its own trusted lineage
    // and remains valid after the retired original session has been minimized.
    if (!job.inputIntegrityParentJobId) {
      await tx.$queryRaw`SELECT id FROM "MediaUploadSession" WHERE id = ${job.inputIntegritySessionId}::uuid FOR SHARE /* ayin-worker-input-session-lock */`;
      const session = await tx.mediaUploadSession.findUnique({
        where: { id: job.inputIntegritySessionId! },
      });
      if (
        !session ||
        session.state !== "COMPLETED" ||
        session.cleanupRequestedAt ||
        session.objectKey !== job.inputR2ObjectKey ||
        session.sizeBytes !== job.sourceSizeBytes ||
        session.videoId !== job.videoId ||
        session.channelId !== job.video.channelId ||
        (session.sourceAssetId !== null &&
          session.sourceAssetId !== job.inputIntegritySourceAssetId)
      )
        return null;
    }
    const source = await tx.mediaAsset.findUnique({
      where: { id: job.inputIntegritySourceAssetId! },
    });
    if (
      !source ||
      source.removedAt ||
      source.status === "REMOVED" ||
      source.videoId !== job.videoId ||
      source.channelId !== job.video.channelId ||
      source.r2ObjectKey !== job.inputR2ObjectKey ||
      source.sizeBytes !== job.sourceSizeBytes
    )
      return null;
    if (options.requireInput && workerId !== null && !hasCurrentInputVerification(job, workerId))
      return null;
    if (
      options.requireOutput &&
      (!job.outputVerifiedAt || !job.outputIntegrityDigest || !job.outputIntegritySizeBytes)
    )
      return null;
  }
  // Locks acquired after the initial row read (notably the session fence) may
  // consume the remaining lease. Recheck against the database clock last.
  if (workerId !== null) {
    const current = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "MediaProcessingJob" WHERE id = ${job.id}::uuid AND "leaseOwner" = ${workerId} AND status IN ('PROCESSING', 'UPLOADING', 'VERIFYING') AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')`;
    if (current.length !== 1) return null;
  } else {
    const current = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "MediaProcessingJob" j WHERE id = ${job.id}::uuid AND status = 'INTEGRITY_QUEUED' AND "leaseOwner" IS NULL AND attempt = ${options.queuedAttempt!} AND ayin_required_media_job_eligible(j)`;
    if (current.length !== 1) return null;
  }
  await declareCompatibleIntegrityWorker(tx);
  return job;
}
