import type { Prisma } from "@ayin/db";
import {
  MAX_RECOVERABLE_OUTPUT_ENVELOPE_BYTES,
  MAX_RECOVERABLE_SOURCE_BYTES,
  type MediaStorageConfig,
} from "./media-storage.config.js";
import { conservativeMultipartExposure } from "./media-upload-admission.js";
import {
  assertUploadCanarySlot,
  configuredUploadCanary,
  requireUploadCanary,
} from "./media-upload-canary.js";
import { MediaUploadError } from "./media-upload-error.js";

/** Explicit audience selection never turns a missing canary tuple into public
 * admission. Bounds cover one maximum source plus its full lifetime envelope. */
export function configuredUploadRecovery(config: MediaStorageConfig) {
  if ((config.recoveryAudience ?? "canary") === "canary") return configuredUploadCanary(config);
  if (config.recoveryAudience !== "all") return null;
  const sourceMaxBytes = config.recoverySourceMaxBytes ?? 0;
  const outputEnvelopeBytes = config.recoveryOutputEnvelopeBytes ?? 0;
  const maximum = config.recoveryMaxOutstandingSources ?? 0;
  if (
    !Number.isSafeInteger(sourceMaxBytes) ||
    sourceMaxBytes < 1 ||
    sourceMaxBytes > MAX_RECOVERABLE_SOURCE_BYTES ||
    !Number.isSafeInteger(outputEnvelopeBytes) ||
    outputEnvelopeBytes < 1 ||
    outputEnvelopeBytes > MAX_RECOVERABLE_OUTPUT_ENVELOPE_BYTES ||
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > 8
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
  return { sourceMaxBytes, outputEnvelopeBytes };
}

/** This is admission policy only. Every command still verifies current account,
 * session, channel custody, quota and rate limits inside its existing fences. */
export function requireUploadRecoveryScope(
  config: MediaStorageConfig,
  accountId: string,
  channelId: string,
  sizeBytes?: number,
) {
  if ((config.recoveryAudience ?? "canary") === "canary")
    return requireUploadCanary(config, accountId, channelId, sizeBytes);
  const scope = configuredUploadRecovery(config);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!config.recoveryV2Enabled || !scope || !uuid.test(accountId) || !uuid.test(channelId))
    throw new MediaUploadError(
      "UPLOAD_RECOVERY_UNSUPPORTED",
      "Recoverable uploads are not enabled for this workspace.",
      503,
    );
  if (
    sizeBytes !== undefined &&
    (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > scope.sourceMaxBytes)
  )
    throw new MediaUploadError(
      "VIDEO_TOO_LARGE",
      "This video exceeds the recoverable upload limit.",
      413,
    );
  return { ...scope, accountId: accountId.toLowerCase(), channelId: channelId.toLowerCase() };
}

export async function assertUploadRecoverySlot(
  tx: Prisma.TransactionClient,
  config: MediaStorageConfig,
  existingSessionId: string | null = null,
  continuation = false,
) {
  if ((config.recoveryAudience ?? "canary") === "canary")
    return assertUploadCanarySlot(tx, existingSessionId);
  if (!configuredUploadRecovery(config))
    throw new MediaUploadError(
      "UPLOAD_RECOVERY_UNSUPPORTED",
      "Upload capacity is not configured.",
      503,
    );
  // This session already occupies an admitted slot. Continuing it cannot add
  // another source/job obligation, even if the operator reduced the slot limit.
  // Its first/replacement grants still reserve quota and retained debt below.
  if (continuation && existingSessionId) return;
  // The all-creator lane keeps the same global admission mutex and finite
  // source/output count. A different creator's processing or uncertain provider result
  // occupies capacity; it must not freeze every existing upload's continuation.
  // Per-account/channel debt and uncertainty limits remain separately enforced.
  const [result] = await tx.$queryRaw<Array<{ occupied: boolean }>>`
    WITH source_obligations AS (
      SELECT 'source:' || s.id::text AS obligation
      FROM "MediaUploadSession" s WHERE s."sourceProtocolVersion"=2
        AND (s."cleanupRequestedAt" IS NULL OR NOT EXISTS (
          SELECT 1 FROM "PrivacyMediaDeletionJob" c WHERE c."uploadSessionId"=s.id
        ) OR EXISTS (
          SELECT 1 FROM "PrivacyMediaDeletionJob" c WHERE c."uploadSessionId"=s.id AND c.status <> 'DONE'
        ) OR EXISTS (
          SELECT 1 FROM "MediaUploadOperation" o WHERE o."sessionId"=s.id
            AND o.kind IN ('CREATE','COMPLETE') AND o."providerOutcome"='UNKNOWN'
        ))
    ), output_obligations AS (
      SELECT COALESCE('source:' || r."uploadSessionId"::text, 'job:' || j.id::text) AS obligation
      FROM "MediaProcessingJob" j
      LEFT JOIN "MediaProcessingOutputReservation" r ON r."processingJobId"=j.id
      WHERE j."outputProtocolVersion"=2 AND j.status NOT IN ('READY','CANCELLED')
    ), attempt_obligations AS (
      SELECT COALESCE('source:' || r."uploadSessionId"::text, 'job:' || a."processingJobId"::text) AS obligation
      FROM "MediaProcessingOutputAttempt" a
      LEFT JOIN "MediaProcessingOutputReservation" r ON r."processingJobId"=a."processingJobId"
      WHERE a."protocolVersion"=2 AND (
        EXISTS (SELECT 1 FROM "MediaProcessingOutputWrite" w
          WHERE w."outputAttemptId"=a.id AND w.status <> 'ACKNOWLEDGED') OR (
          NOT EXISTS (SELECT 1 FROM "PrivacyMediaDeletionJob" c WHERE c."outputAttemptId"=a.id OR
            (c.kind='OUTPUT_SETTLEMENT' AND c."processingJobId"=a."processingJobId" AND c."outputAttemptId" IS NULL))
          AND NOT EXISTS (SELECT 1 FROM "MediaProcessingJob" j WHERE j.id=a."processingJobId"
            AND j.status='READY' AND j."currentOutputAttemptId"=a.id)
        )
      )
    ), cleanup_obligations AS (
      SELECT COALESCE('source:' || r."uploadSessionId"::text,
        'job:' || COALESCE(c."processingJobId", a."processingJobId")::text,
        'cleanup:' || c.id::text) AS obligation
      FROM "PrivacyMediaDeletionJob" c
      LEFT JOIN "MediaProcessingOutputAttempt" a ON a.id=c."outputAttemptId"
      LEFT JOIN "MediaProcessingOutputReservation" r
        ON r."processingJobId"=COALESCE(c."processingJobId", a."processingJobId")
      WHERE c."cleanupContractVersion"=2
        AND (c.scope='PROCESSING_OUTPUT' OR c.kind='OUTPUT_SETTLEMENT') AND c.status <> 'DONE'
    ), obligations AS (
      SELECT obligation FROM source_obligations UNION SELECT obligation FROM output_obligations
      UNION SELECT obligation FROM attempt_obligations UNION SELECT obligation FROM cleanup_obligations
    )
    SELECT COUNT(*) >= ${config.recoveryMaxOutstandingSources!} AS occupied FROM obligations`;
  if (!result || result.occupied)
    throw new MediaUploadError(
      "UPLOAD_CAPACITY_BUSY",
      "Upload capacity is busy. Continue an existing upload or try again shortly.",
      429,
    );
}
