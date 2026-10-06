import type { Prisma } from "@ayin/db";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  hashUploadFileIdentity,
  UPLOAD_FILE_IDENTITY_ALGORITHM,
  UPLOAD_FILE_IDENTITY_MAX_SIZE_BYTES,
  type UploadFileIdentity,
} from "@ayin/types";

export const MEDIA_INPUT_INTEGRITY_VERSION = 1;
type InputContract = {
  inputIntegrityVersion?: number;
  inputIntegritySessionId?: string | null;
  inputIntegritySourceAssetId?: string | null;
  inputIntegrityAccountId?: string | null;
  inputIntegrityOwnerlessPlatform?: boolean | null;
  inputIntegrityAlgorithm?: string | null;
  inputIntegrityDigest?: string | null;
  inputIntegrityParentJobId?: string | null;
  inputR2ObjectKey?: string | null;
  sourceSizeBytes?: bigint;
};

// Version 0 is the additive migration's explicit legacy default, never inferred
// from a missing/deleted session row. Required declarations live on the job.
export function assertJobInputIntegrity(job: InputContract) {
  if ((job.inputIntegrityVersion ?? 0) === 0) {
    if (
      job.inputIntegritySessionId ||
      job.inputIntegritySourceAssetId ||
      job.inputIntegrityAccountId ||
      job.inputIntegrityOwnerlessPlatform != null ||
      job.inputIntegrityAlgorithm ||
      job.inputIntegrityDigest ||
      job.inputIntegrityParentJobId
    )
      throw new Error("Legacy media job has an inconsistent integrity declaration.");
    return null;
  }
  if (job.inputIntegrityVersion !== MEDIA_INPUT_INTEGRITY_VERSION)
    throw new Error("Unsupported media input integrity version.");
  if (
    !job.inputIntegritySessionId ||
    !job.inputIntegritySourceAssetId ||
    !job.inputIntegrityAccountId ||
    typeof job.inputIntegrityOwnerlessPlatform !== "boolean" ||
    !job.inputR2ObjectKey ||
    job.inputIntegrityAlgorithm !== UPLOAD_FILE_IDENTITY_ALGORITHM ||
    !job.inputIntegrityDigest ||
    !/^[0-9a-f]{64}$/.test(job.inputIntegrityDigest) ||
    !job.sourceSizeBytes ||
    job.sourceSizeBytes < 1n ||
    job.sourceSizeBytes > BigInt(UPLOAD_FILE_IDENTITY_MAX_SIZE_BYTES)
  )
    throw new Error("The required media input integrity declaration is missing or invalid.");
  return {
    algorithm: UPLOAD_FILE_IDENTITY_ALGORITHM,
    version: MEDIA_INPUT_INTEGRITY_VERSION,
    sizeBytes: Number(job.sourceSizeBytes),
    rootSha256: job.inputIntegrityDigest,
  };
}

export async function hashMediaFile(
  filePath: string,
  signal?: AbortSignal,
): Promise<UploadFileIdentity> {
  signal?.throwIfAborted();
  const file = await stat(filePath);
  const stream = createReadStream(filePath, {
    highWaterMark: 256 * 1024,
    ...(signal ? { signal } : {}),
  });
  try {
    return await hashUploadFileIdentity(stream, file.size, signal ? { signal } : {});
  } finally {
    stream.destroy();
  }
}

export async function verifyJobInputFile(
  job: InputContract,
  filePath: string,
  signal?: AbortSignal,
): Promise<UploadFileIdentity> {
  const expected = assertJobInputIntegrity(job);
  if (!expected)
    throw new Error("Byte verification requires an explicit input integrity contract.");
  signal?.throwIfAborted();
  const stream = createReadStream(filePath, {
    highWaterMark: 256 * 1024,
    ...(signal ? { signal } : {}),
  });
  try {
    const actual = await hashUploadFileIdentity(
      stream,
      expected.sizeBytes,
      signal ? { signal } : {},
    );
    if (actual.rootSha256 !== expected.rootSha256)
      throw new Error("The downloaded source failed byte integrity verification.");
    return actual;
  } finally {
    stream.destroy();
  }
}

export function hasCurrentInputVerification(
  job: InputContract & {
    attempt?: number;
    inputVerifiedAt?: Date | null;
    inputVerifiedLeaseOwner?: string | null;
    inputVerifiedAttempt?: number | null;
  },
  workerId: string,
): boolean {
  try {
    if (!assertJobInputIntegrity(job)) return true;
    return Boolean(
      job.inputVerifiedAt &&
      job.inputVerifiedLeaseOwner === workerId &&
      job.inputVerifiedAttempt === job.attempt,
    );
  } catch {
    return false;
  }
}

// Privacy may minimize content fingerprints only after atomically cancelling
// the job. The immutable version/address/lineage remains; redaction is terminal.
export async function redactCancelledInputIntegrityInTransaction(
  tx: Prisma.TransactionClient,
  videoIds: readonly string[],
  now: Date,
) {
  if (!videoIds.length) return;
  await tx.mediaProcessingJob.updateMany({
    where: {
      videoId: { in: [...videoIds] },
      status: "CANCELLED",
      inputIntegrityVersion: 1,
      inputIntegrityRedactedAt: null,
    },
    data: {
      inputIntegrityRedactedAt: now,
      inputIntegrityDigest: null,
      inputVerifiedAt: null,
      inputVerifiedLeaseOwner: null,
      inputVerifiedAttempt: null,
      outputIntegrityDigest: null,
      outputIntegritySizeBytes: null,
      outputVerifiedAt: null,
    },
  });
}
