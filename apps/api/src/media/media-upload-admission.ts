import type { Prisma } from "@ayin/db";
import { MediaUploadError } from "./media-upload.service.js";

// Shared by legacy and durable reservations. Account/authority locks come first;
// this capacity lock precedes generation, source, video, channel and session locks.
export async function lockUploadAdmission(tx: Prisma.TransactionClient, channelId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(86192044, hashtext(${channelId.toLowerCase()}))`;
}
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
    },
    _sum: { sizeBytes: true },
  });
  // Removed sources with unresolved physical obligations still consume capacity.
  // Count each durable session once, not every cleanup address; keep zero-grant
  // PREPARING/UNKNOWN reservations bounded as well.
  const debt = await tx.$queryRaw<Array<{ bytes: bigint }>>`
    SELECT COALESCE(SUM(s."sizeBytes"), 0)::bigint AS bytes FROM "MediaUploadSession" s
    LEFT JOIN "MediaAsset" a ON a.id = s."sourceAssetId"
    WHERE s."channelId" = ${channelId}::uuid
      AND (a.id IS NULL OR a."removedAt" IS NOT NULL OR a.status NOT IN ('PENDING','UPLOADED','VALIDATED'))
      AND (s.state IN ('PREPARING','OPEN','FINALIZING','CANCELLING','UNRESOLVED') OR EXISTS (
        SELECT 1 FROM "PrivacyMediaDeletionJob" j WHERE j."uploadSessionId" = s.id AND j.status <> 'DONE'))`;
  if (
    !Number.isSafeInteger(quotaBytes) ||
    quotaBytes < 1 ||
    (live._sum.sizeBytes ?? 0n) + (debt[0]?.bytes ?? 0n) + BigInt(sizeBytes) > BigInt(quotaBytes)
  )
    throw new MediaUploadError(
      "CHANNEL_UPLOAD_QUOTA_REACHED",
      "This channel has reached its current upload storage allowance.",
      413,
    );
}
