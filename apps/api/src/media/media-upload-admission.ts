import type { Prisma } from "@ayin/db";
import { MediaUploadError } from "./media-upload-error.js";

// Operational limits, not expiry or evidence that physical bytes were deleted.
export const UPLOAD_ADMISSION_LIMITS = {
  activeAccount: 10,
  activeChannel: 50,
  retainedDebtAccount: 100,
  retainedDebtChannel: 500,
  uncertainAccount: 10,
  uncertainChannel: 50,
} as const;

/** R2 documents a 5 GiB maximum part. This reserves all addressable part slots,
 * not the browser-declared body length. Reusable/in-flight URLs mean this is an
 * accounting budget, NOT a provider-enforced bound on physical exposure/cost.
 */
export function conservativeMultipartExposure(sizeBytes: number, partSizeBytes: number): bigint {
  if (
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 1 ||
    !Number.isSafeInteger(partSizeBytes) ||
    partSizeBytes < 1
  )
    throw new MediaUploadError("UPLOAD_PART_LIMIT", "Invalid multipart capacity.", 413);
  const parts = (BigInt(sizeBytes) + BigInt(partSizeBytes) - 1n) / BigInt(partSizeBytes);
  if (parts > 10_000n)
    throw new MediaUploadError("UPLOAD_PART_LIMIT", "This video exceeds multipart capacity.", 413);
  return parts * 5n * 1024n ** 3n;
}

/** Accepted processing is deliberately absent from the active-source predicate.
 * Physical debt has a separate bounded backlog; UNKNOWN never turns into free
 * admission capacity just because an object was observed/accepted.
 */
export async function assertUploadSessionCapacity(
  tx: Prisma.TransactionClient,
  accountId: string,
  channelId: string,
) {
  const [counts] = await tx.$queryRaw<
    Array<{
      activeAccount: bigint;
      activeChannel: bigint;
      retainedDebtAccount: bigint;
      retainedDebtChannel: bigint;
      uncertainAccount: bigint;
      uncertainChannel: bigint;
    }>
  >`
    WITH source_obligations AS (
      SELECT s."initiatingAccountId", s."channelId",
        (s.state IN ('PREPARING','OPEN','FINALIZING') AND s."cleanupRequestedAt" IS NULL) AS active,
        (s.state IN ('CANCELLING','UNRESOLVED') OR EXISTS (
          SELECT 1 FROM "PrivacyMediaDeletionJob" j WHERE j."uploadSessionId"=s.id AND j.status <> 'DONE'
        ) OR EXISTS (
          SELECT 1 FROM "MediaUploadOperation" o WHERE o."sessionId"=s.id
            AND o.kind IN ('CREATE','COMPLETE') AND o."providerOutcome"='UNKNOWN'
        )) AS debt,
        (s.state='UNRESOLVED' OR EXISTS (
          SELECT 1 FROM "MediaUploadOperation" o WHERE o."sessionId"=s.id
            AND o.kind IN ('CREATE','COMPLETE') AND o."providerOutcome"='UNKNOWN'
        )) AS uncertain
      FROM "MediaUploadSession" s
      WHERE s."initiatingAccountId"=${accountId}::uuid OR s."channelId"=${channelId}::uuid
    ), obligations AS (
      SELECT * FROM source_obligations
      UNION ALL
      SELECT CASE WHEN EXISTS (
          SELECT 1 FROM "ChannelMember" m WHERE m."channelId"=a."channelId"
            AND m."accountId"=${accountId}::uuid AND m.role='OWNER'
        ) THEN ${accountId}::uuid ELSE NULL::uuid END, a."channelId", false AS active,
        (EXISTS (SELECT 1 FROM "PrivacyMediaDeletionJob" j WHERE j.status <> 'DONE'
          AND (j."outputAttemptId"=a.id OR (j.kind='OUTPUT_SETTLEMENT'
            AND j."outputAttemptId" IS NULL AND j."processingJobId"=a."processingJobId"))) OR EXISTS (
          SELECT 1 FROM "MediaProcessingOutputWrite" w WHERE w."outputAttemptId"=a.id
            AND w.status <> 'ACKNOWLEDGED'
        )) AS debt,
        EXISTS (SELECT 1 FROM "MediaProcessingOutputWrite" w WHERE w."outputAttemptId"=a.id
          AND w.status <> 'ACKNOWLEDGED') AS uncertain
      FROM "MediaProcessingOutputAttempt" a
      WHERE a."channelId"=${channelId}::uuid OR EXISTS (
        SELECT 1 FROM "ChannelMember" m WHERE m."channelId"=a."channelId"
          AND m."accountId"=${accountId}::uuid AND m.role='OWNER'
      )
    )
    SELECT
      COUNT(*) FILTER (WHERE active AND "initiatingAccountId"=${accountId}::uuid)::bigint AS "activeAccount",
      COUNT(*) FILTER (WHERE active AND "channelId"=${channelId}::uuid)::bigint AS "activeChannel",
      COUNT(*) FILTER (WHERE debt AND "initiatingAccountId"=${accountId}::uuid)::bigint AS "retainedDebtAccount",
      COUNT(*) FILTER (WHERE debt AND "channelId"=${channelId}::uuid)::bigint AS "retainedDebtChannel",
      COUNT(*) FILTER (WHERE uncertain AND "initiatingAccountId"=${accountId}::uuid)::bigint AS "uncertainAccount",
      COUNT(*) FILTER (WHERE uncertain AND "channelId"=${channelId}::uuid)::bigint AS "uncertainChannel"
    FROM obligations`;
  if (
    !counts ||
    Object.entries(UPLOAD_ADMISSION_LIMITS).some(
      ([name, limit]) => counts[name as keyof typeof counts] >= BigInt(limit),
    )
  )
    throw new MediaUploadError(
      "UPLOAD_ADMISSION_LIMIT",
      "Resolve existing upload or cleanup obligations before starting another.",
      429,
    );
}

// Shared by legacy and durable reservations. Account/authority locks come first;
// this capacity lock precedes generation, source, video, channel and session locks.
export async function lockUploadAccountAdmission(
  tx: Prisma.TransactionClient,
  accountIds: readonly string[],
) {
  for (const accountId of [...new Set(accountIds.map((id) => id.toLowerCase()))].sort())
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(86192045, hashtext(${accountId}))`;
}
export async function lockUploadAdmission(tx: Prisma.TransactionClient, channelId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(86192044, hashtext(${channelId.toLowerCase()}))`;
}
/** Product storage quota counts active declarations and retained live media.
 * Legacy debt keeps its historical quota treatment. V2 declarations reserve
 * quota at the first grant, so a lost/crashed CREATE cannot charge whole-file
 * bytes when it could only allocate an empty multipart resource.
 */
export async function assertUploadByteQuota(
  tx: Prisma.TransactionClient,
  channelId: string,
  sizeBytes: number,
  quotaBytes: number,
) {
  const live = await tx.mediaAsset.aggregate({
    where: {
      channelId,
      kind: "SOURCE_VIDEO",
      status: { in: ["PENDING", "UPLOADED", "VALIDATED"] },
      removedAt: null,
      NOT: {
        status: "PENDING",
        uploadSession: {
          is: {
            sourceProtocolVersion: 2,
            grantReservationCount: 0,
            lastGrantExpiresAt: null,
            providerExposureBytes: 0n,
          },
        },
      },
    },
    _sum: { sizeBytes: true },
  });
  const debt = await tx.$queryRaw<Array<{ bytes: bigint }>>`
    SELECT COALESCE(SUM(s."sizeBytes"), 0)::bigint AS bytes FROM "MediaUploadSession" s
    LEFT JOIN "MediaAsset" a ON a.id = s."sourceAssetId"
    WHERE s."channelId" = ${channelId}::uuid AND s."sourceProtocolVersion"=1
      AND (a.id IS NULL OR a."removedAt" IS NOT NULL OR a.status NOT IN ('PENDING','UPLOADED','VALIDATED'))
      AND (s.state IN ('PREPARING','OPEN','FINALIZING','CANCELLING','UNRESOLVED') OR EXISTS (
        SELECT 1 FROM "PrivacyMediaDeletionJob" j WHERE j."uploadSessionId" = s.id AND j.status <> 'DONE'))`;
  if (
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 0 ||
    !Number.isSafeInteger(quotaBytes) ||
    quotaBytes < 1 ||
    !debt[0] ||
    (live._sum.sizeBytes ?? 0n) + debt[0].bytes + BigInt(sizeBytes) > BigInt(quotaBytes)
  )
    throw new MediaUploadError(
      "CHANNEL_UPLOAD_QUOTA_REACHED",
      "This channel has reached its current upload storage allowance.",
      413,
    );
}

export const DEFAULT_UPLOAD_DEBT_BYTE_LIMITS = {
  account: 0,
  channel: 0,
} as const;

/** A finite admission-accounting budget, not a physical-byte/provider guarantee.
 * Caller holds account-admission then channel-admission locks before reserving
 * new exposure. UNKNOWN stays charged even after logical source acceptance.
 * Output writes are counted once by immutable address, not once per cleanup job.
 */
export async function assertUploadDebtByteCapacity(
  tx: Prisma.TransactionClient,
  accountId: string,
  channelId: string,
  additionalBytes: bigint,
  limits: { account: number; channel: number } = DEFAULT_UPLOAD_DEBT_BYTE_LIMITS,
) {
  const [debt] = await tx.$queryRaw<
    Array<{
      accountBytes: bigint;
      channelBytes: bigint;
      unaccounted: bigint;
    }>
  >`
    WITH source_exposure AS (
      SELECT s."initiatingAccountId", s."channelId", s."providerExposureBytes" AS bytes
      FROM "MediaUploadSession" s
      WHERE s."sourceProtocolVersion"=2
        AND (s."initiatingAccountId"=${accountId}::uuid OR s."channelId"=${channelId}::uuid)
        AND (s."cleanupRequestedAt" IS NULL OR NOT EXISTS (
          SELECT 1 FROM "PrivacyMediaDeletionJob" j WHERE j."uploadSessionId"=s.id
        ) OR EXISTS (
          SELECT 1 FROM "PrivacyMediaDeletionJob" j WHERE j."uploadSessionId"=s.id AND j.status <> 'DONE'
        ) OR EXISTS (
          SELECT 1 FROM "MediaUploadOperation" o WHERE o."sessionId"=s.id
            AND o.kind IN ('CREATE','COMPLETE') AND o."providerOutcome"='UNKNOWN'
        ))
    ), output_envelopes AS (
      SELECT r.*, CASE WHEN r."processingJobId" IS NOT NULL THEN
        j.id IS NOT NULL AND j.status NOT IN ('READY','CANCELLED')
        ELSE s.id IS NOT NULL AND (NOT EXISTS (
          SELECT 1 FROM "PrivacyMediaDeletionJob" d WHERE d."uploadSessionId"=s.id
        ) OR EXISTS (
          SELECT 1 FROM "PrivacyMediaDeletionJob" d WHERE d."uploadSessionId"=s.id AND d.status <> 'DONE'
        )) END AS active,
        (r."accountId"=${accountId}::uuid OR EXISTS (
          SELECT 1 FROM "ChannelMember" m WHERE m."channelId"=r."channelId"
            AND m."accountId"=${accountId}::uuid AND m.role='OWNER'
        )) AS account_owned
      FROM "MediaProcessingOutputReservation" r
      LEFT JOIN "MediaProcessingJob" j ON j.id=r."processingJobId"
      LEFT JOIN "MediaUploadSession" s ON s.id=r."uploadSessionId"
      WHERE r."accountId"=${accountId}::uuid OR r."channelId"=${channelId}::uuid OR EXISTS (
        SELECT 1 FROM "ChannelMember" m WHERE m."channelId"=r."channelId"
          AND m."accountId"=${accountId}::uuid AND m.role='OWNER'
      )
    ), output_exposure AS (
      SELECT a."channelId", w."expectedSizeBytes" AS bytes,
        (r."accountId"=${accountId}::uuid OR EXISTS (SELECT 1 FROM "ChannelMember" m WHERE m."channelId"=a."channelId"
          AND m."accountId"=${accountId}::uuid AND m.role='OWNER')) AS account_owned
      FROM "MediaProcessingOutputWrite" w
      JOIN "MediaProcessingOutputAttempt" a ON a.id=w."outputAttemptId"
      LEFT JOIN "MediaProcessingOutputReservation" r ON r."processingJobId"=a."processingJobId"
      WHERE NOT EXISTS (
        SELECT 1 FROM output_envelopes e WHERE e."processingJobId"=a."processingJobId" AND e.active
      ) AND (r."accountId"=${accountId}::uuid OR a."channelId"=${channelId}::uuid OR EXISTS (
        SELECT 1 FROM "ChannelMember" m WHERE m."channelId"=a."channelId"
          AND m."accountId"=${accountId}::uuid AND m.role='OWNER'
      )) AND (w.status <> 'ACKNOWLEDGED' OR EXISTS (
        SELECT 1 FROM "PrivacyMediaDeletionJob" j WHERE j.status <> 'DONE' AND
          (j."outputAttemptId"=a.id OR (j.kind='OUTPUT_SETTLEMENT'
            AND j."outputAttemptId" IS NULL AND j."processingJobId"=a."processingJobId"))
      ) OR (NOT EXISTS (
        SELECT 1 FROM "PrivacyMediaDeletionJob" j WHERE j."outputAttemptId"=a.id OR
          (j.kind='OUTPUT_SETTLEMENT' AND j."outputAttemptId" IS NULL AND j."processingJobId"=a."processingJobId")
      ) AND NOT EXISTS (
        SELECT 1 FROM "MediaProcessingJob" j WHERE j.id=a."processingJobId"
          AND j.status='READY' AND j."currentOutputAttemptId"=a.id
      )))
    )
    SELECT
      ((SELECT COALESCE(SUM(bytes),0) FROM source_exposure WHERE "initiatingAccountId"=${accountId}::uuid) +
      (SELECT COALESCE(SUM(bytes),0) FROM output_exposure WHERE account_owned) +
      (SELECT COALESCE(SUM("envelopeBytes"),0) FROM output_envelopes WHERE active AND account_owned))::bigint AS "accountBytes",
      ((SELECT COALESCE(SUM(bytes),0) FROM source_exposure WHERE "channelId"=${channelId}::uuid) +
      (SELECT COALESCE(SUM(bytes),0) FROM output_exposure WHERE "channelId"=${channelId}::uuid) +
      (SELECT COALESCE(SUM("envelopeBytes"),0) FROM output_envelopes WHERE active AND "channelId"=${channelId}::uuid))::bigint AS "channelBytes",
      (SELECT COUNT(*) FROM source_exposure WHERE bytes IS NULL)::bigint AS unaccounted`;
  if (
    !debt ||
    debt.unaccounted > 0n ||
    additionalBytes < 0n ||
    !Number.isSafeInteger(limits.account) ||
    limits.account < 1 ||
    !Number.isSafeInteger(limits.channel) ||
    limits.channel < 1 ||
    BigInt(debt.accountBytes) + additionalBytes > BigInt(limits.account) ||
    BigInt(debt.channelBytes) + additionalBytes > BigInt(limits.channel)
  )
    throw new MediaUploadError(
      "UPLOAD_PHYSICAL_DEBT_LIMIT",
      "Resolve existing physical upload or cleanup obligations before granting more storage.",
      429,
    );
}

/** Reserve source exposure and output drain room in the SAME first-grant
 * transaction. Existing envelopes are immutable and survive config changes.
 * Caller holds the account/channel admission locks and exact source fence. */
export async function reserveSourceOutputEnvelope(
  tx: Prisma.TransactionClient,
  input: {
    sessionId: string;
    accountId: string;
    channelId: string;
    envelopeBytes: number;
    additionalSourceBytes: bigint;
    limits: { account: number; channel: number };
  },
): Promise<void> {
  const existing = await tx.mediaProcessingOutputReservation.findUnique({
    where: { uploadSessionId: input.sessionId },
  });
  if (
    existing &&
    (existing.accountId !== input.accountId || existing.channelId !== input.channelId)
  )
    throw new MediaUploadError(
      "UPLOAD_OUTPUT_RESERVATION_INVALID",
      "The output reservation requires review.",
      409,
    );
  if (!existing) assertConfiguredOutputEnvelope(input.envelopeBytes);
  await assertUploadDebtByteCapacity(
    tx,
    input.accountId,
    input.channelId,
    input.additionalSourceBytes + (existing ? 0n : BigInt(input.envelopeBytes)),
    input.limits,
  );
  if (!existing)
    await tx.mediaProcessingOutputReservation.create({
      data: {
        uploadSessionId: input.sessionId,
        accountId: input.accountId,
        channelId: input.channelId,
        envelopeBytes: BigInt(input.envelopeBytes),
      },
    });
}

export function assertConfiguredOutputEnvelope(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 1)
    throw new MediaUploadError(
      "UPLOAD_OUTPUT_ENVELOPE_UNAVAILABLE",
      "A finite output allowance must be reserved before this upload can proceed.",
      503,
    );
}

/** The complete measured write set, across all attempts of one job, fits in a
 * fixed lifetime envelope. Cleanup/ACK/retry never refills it. The SQL journal
 * insert trigger increments this same counter atomically with the new write. */
export function assertOutputEnvelopeRemaining(
  reservation: { envelopeBytes: bigint; dispatchedBytes: bigint },
  bytes: bigint,
): void {
  if (
    bytes < 1n ||
    reservation.dispatchedBytes < 0n ||
    reservation.dispatchedBytes + bytes > reservation.envelopeBytes
  )
    throw new MediaUploadError(
      "MEDIA_OUTPUT_ENVELOPE_EXCEEDED",
      "The measured output exceeds this job's reserved output allowance.",
      413,
    );
}
