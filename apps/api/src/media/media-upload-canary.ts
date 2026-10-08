import type { Prisma } from "@ayin/db";
import type { MediaStorageConfig } from "./media-storage.config.js";
import { MediaUploadError } from "./media-upload-error.js";
import { conservativeMultipartExposure } from "./media-upload-admission.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A deployment can admit only one explicit account/channel tuple. This is a
 * bounded canary, not global availability or attestation of real R2 acceptance. */
export function configuredUploadCanary(config: MediaStorageConfig) {
  const accountId = config.recoveryCanaryAccountId;
  const channelId = config.recoveryCanaryChannelId;
  const sourceMaxBytes = config.recoveryCanarySourceMaxBytes ?? 0;
  const outputEnvelopeBytes = config.recoveryOutputEnvelopeBytes ?? 0;
  if (
    !accountId ||
    !channelId ||
    !uuid.test(accountId) ||
    !uuid.test(channelId) ||
    !Number.isSafeInteger(sourceMaxBytes) ||
    sourceMaxBytes < 1 ||
    sourceMaxBytes > 16 * 1024 ** 2 ||
    !Number.isSafeInteger(outputEnvelopeBytes) ||
    outputEnvelopeBytes < 1 ||
    outputEnvelopeBytes > 512 * 1024 ** 2
  )
    return null;
  const required =
    conservativeMultipartExposure(sourceMaxBytes, config.partSizeBytes) +
    BigInt(outputEnvelopeBytes);
  if (
    ![config.recoveryDebtAccountBytes, config.recoveryDebtChannelBytes].every(
      (value) => Number.isSafeInteger(value) && value! > 0 && BigInt(value!) >= required,
    )
  )
    return null;
  return {
    accountId: accountId.toLowerCase(),
    channelId: channelId.toLowerCase(),
    sourceMaxBytes,
    outputEnvelopeBytes,
  };
}

export function requireUploadCanary(
  config: MediaStorageConfig,
  accountId: string,
  channelId: string,
  sizeBytes?: number,
) {
  const canary = configuredUploadCanary(config);
  if (
    !config.recoveryV2Enabled ||
    !canary ||
    canary.accountId !== accountId.toLowerCase() ||
    canary.channelId !== channelId.toLowerCase() ||
    (sizeBytes !== undefined && sizeBytes > canary.sourceMaxBytes)
  )
    throw new MediaUploadError(
      "UPLOAD_RECOVERY_UNSUPPORTED",
      "Recoverable uploads are not enabled for this workspace.",
      503,
    );
  return canary;
}

/** Acquire after account authority and before per-account/channel capacity.
 * Configuration rotation cannot admit a second outstanding V2 source elsewhere. */
export async function lockUploadCanary(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(86192046, 0)`;
}

export async function assertUploadCanarySlot(
  tx: Prisma.TransactionClient,
  existingSessionId: string | null = null,
) {
  const [result] = await tx.$queryRaw<Array<{ occupied: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM "MediaUploadSession" s WHERE s."sourceProtocolVersion"=2
        AND (${existingSessionId}::uuid IS NULL OR s.id <> ${existingSessionId}::uuid)
        AND (s."cleanupRequestedAt" IS NULL OR NOT EXISTS (
          SELECT 1 FROM "PrivacyMediaDeletionJob" c WHERE c."uploadSessionId"=s.id
        ) OR EXISTS (
          SELECT 1 FROM "PrivacyMediaDeletionJob" c WHERE c."uploadSessionId"=s.id AND c.status <> 'DONE'
        ) OR EXISTS (
          SELECT 1 FROM "MediaUploadOperation" o WHERE o."sessionId"=s.id AND o.kind IN ('CREATE','COMPLETE') AND o."providerOutcome"='UNKNOWN'
        ))
    ) OR EXISTS (
      SELECT 1 FROM "MediaProcessingOutputAttempt" a WHERE a."protocolVersion"=2 AND (
        EXISTS (SELECT 1 FROM "MediaProcessingOutputWrite" w WHERE w."outputAttemptId"=a.id AND w.status <> 'ACKNOWLEDGED') OR
        EXISTS (SELECT 1 FROM "PrivacyMediaDeletionJob" c WHERE c."outputAttemptId"=a.id AND c.status <> 'DONE')
      )
    ) OR EXISTS (
      SELECT 1 FROM "MediaUploadOperation" o JOIN "MediaUploadSession" s ON s.id=o."sessionId"
      WHERE s."sourceProtocolVersion"=2 AND o.kind IN ('CREATE','COMPLETE') AND o."providerOutcome"='UNKNOWN'
    ) OR EXISTS (
      SELECT 1 FROM "MediaProcessingJob" j WHERE j."outputProtocolVersion"=2
        AND j.status NOT IN ('READY','CANCELLED')
    ) AS occupied`;
  if (!result || result.occupied)
    throw new MediaUploadError(
      "UPLOAD_CANARY_BUSY",
      "Finish the existing upload and cleanup before starting another canary upload.",
      429,
    );
}
