import type { Prisma } from "@ayin/db";
import type { MediaStorageConfig } from "./media-storage.config.js";
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
    sourceMaxBytes > 128 * 1024 ** 2 ||
    !Number.isSafeInteger(outputEnvelopeBytes) ||
    outputEnvelopeBytes < 1 ||
    outputEnvelopeBytes > 512 * 1024 ** 2 ||
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
) {
  if ((config.recoveryAudience ?? "canary") === "canary")
    return assertUploadCanarySlot(tx, existingSessionId);
  if (!configuredUploadRecovery(config))
    throw new MediaUploadError(
      "UPLOAD_RECOVERY_UNSUPPORTED",
      "Upload capacity is not configured.",
      503,
    );
  // Uses the same global admission mutex and uncertainty barrier as the canary.
  // Retained DONE tombstones and acknowledged winning output are not backlog.
  return assertUploadCanarySlot(tx, existingSessionId, config.recoveryMaxOutstandingSources);
}
