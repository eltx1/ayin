import type { Prisma } from "@ayin/db";
import type { MediaStorageConfig } from "./media-storage.config.js";
import { assertUploadDebtByteCapacity } from "./media-upload-admission.js";
import { assertUploadCanarySlot, requireUploadCanary } from "./media-upload-canary.js";
import { observeChannelMediaOwners } from "./media-privacy-account-fence.js";
import { MediaUploadError } from "./media-upload-error.js";

/** Some reprocessing/backfill callers already hold generation locks. Never wait
 * backwards on admission locks: a busy mutex aborts the acceptance transaction,
 * before any job or output reservation commits. No Account row lock is taken
 * here; queued work must still pass the existing current-custody worker fence.
 * The returned reservation MUST be created atomically with the derived job. */
export async function prepareDerivedOutputReservation(
  tx: Prisma.TransactionClient,
  config: MediaStorageConfig | undefined,
  channelId: string,
  lineage: { outputProtocolVersion?: number; inputIntegritySessionId?: string | null },
) {
  if (lineage.outputProtocolVersion !== 2) return null;
  if (!config)
    throw new MediaUploadError(
      "UPLOAD_OUTPUT_ENVELOPE_UNAVAILABLE",
      "Output admission is not configured.",
      503,
    );
  const canary = requireUploadCanary(config, config.recoveryCanaryAccountId ?? "", channelId);
  const owners = await observeChannelMediaOwners(tx, channelId);
  if (!owners.includes(canary.accountId))
    throw new MediaUploadError(
      "UPLOAD_RECOVERY_UNSUPPORTED",
      "The canary account must currently own this channel.",
      503,
    );
  const [global] = await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_xact_lock(86192046, 0) AS locked`;
  if (!global?.locked) busy();
  for (const owner of [...new Set(owners.map((id) => id.toLowerCase()))].sort()) {
    const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(86192045, hashtext(${owner})) AS locked`;
    if (!lock?.locked) busy();
  }
  const [channel] = await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_xact_lock(86192044, hashtext(${channelId.toLowerCase()})) AS locked`;
  if (!channel?.locked) busy();
  // The original source in this exact lineage may still await its normal
  // post-grant cleanup. No different unretired source or output work is allowed.
  await assertUploadCanarySlot(tx, lineage.inputIntegritySessionId ?? null);
  for (const owner of owners)
    await assertUploadDebtByteCapacity(tx, owner, channelId, BigInt(canary.outputEnvelopeBytes), {
      account: config.recoveryDebtAccountBytes!,
      channel: config.recoveryDebtChannelBytes!,
    });
  return {
    accountId: canary.accountId,
    channelId,
    envelopeBytes: BigInt(canary.outputEnvelopeBytes),
  };
}

function busy(): never {
  throw new MediaUploadError(
    "UPLOAD_OUTPUT_ADMISSION_BUSY",
    "Output admission is busy. Retry this request.",
    409,
  );
}

/** Expected per-candidate policy rejection, safe to skip before any job write.
 * Never treat arbitrary storage/SQL/Prisma failures as an ineligible candidate. */
export function isOutputAdmissionPolicyError(error: unknown): error is MediaUploadError {
  return (
    error instanceof MediaUploadError &&
    [
      "UPLOAD_OUTPUT_ENVELOPE_UNAVAILABLE",
      "UPLOAD_RECOVERY_UNSUPPORTED",
      "UPLOAD_OUTPUT_ADMISSION_BUSY",
      "UPLOAD_CANARY_BUSY",
      "UPLOAD_PHYSICAL_DEBT_LIMIT",
    ].includes(error.code)
  );
}
