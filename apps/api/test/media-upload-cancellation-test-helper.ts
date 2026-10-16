import type { createPrismaClient } from "@ayin/db";
import { expect } from "vitest";
import type { UploadSessionPayload } from "../src/media/upload-session-token.service.js";

/** Assert the cancellation fence and its exact owned debt, not just a marker. */
export async function assertLegacyCancellationCustody(
  prisma: ReturnType<typeof createPrismaClient>,
  signed: UploadSessionPayload,
  videoId: string,
  privacyRequestId: string | null = null,
) {
  const session = await prisma.mediaUploadSession.findUniqueOrThrow({
    where: { sourceAssetId: signed.assetId },
  });
  expect(session).toMatchObject({
    sourceProtocolVersion: 1,
    sourceAssetId: signed.assetId,
    initiatingAccountId: signed.accountId,
    channelId: signed.channelId,
    videoId,
    authority: signed.adminOverride ? "ADMIN" : "OWNER",
    mode: signed.mode === "single" ? "SINGLE" : "MULTIPART",
    objectKey: signed.objectKey,
    providerUploadId: signed.uploadId,
    sizeBytes: BigInt(signed.sizeBytes),
    mimeType: signed.mimeType,
    partSizeBytes: BigInt(signed.partSizeBytes),
    state: privacyRequestId ? "REVOKED" : "ABORTED",
    contentIdentityDigest: null,
    hardExpiresAt: new Date(signed.expiresAtMs),
    lastGrantExpiresAt: null,
    grantsRevokedAt: expect.any(Date),
    cleanupRequestedAt: expect.any(Date),
    cleanupRetainUntil: expect.any(Date),
  });
  const jobs = await prisma.privacyMediaDeletionJob.findMany({
    where: { target: signed.objectKey },
    orderBy: { kind: "asc" },
  });
  expect(jobs.map((job) => job.kind).sort()).toEqual(
    signed.mode === "single" ? ["OBJECT"] : ["ALLOCATION", "MULTIPART", "OBJECT"],
  );
  for (const job of jobs)
    expect(job).toMatchObject({
      cleanupContractVersion: 1,
      scope: "UPLOAD_SESSION",
      requestId: privacyRequestId,
      accountId: signed.accountId,
      channelId: signed.channelId,
      sourceAssetId: signed.assetId,
      uploadSessionId: session.id,
      sessionRevision: session.revision,
      providerUploadId: job.kind === "MULTIPART" ? signed.uploadId : null,
      status: "PENDING",
      completedAt: null,
      settlementProofReference: null,
      settlementVerifiedAt: null,
    });
  return { session, jobs };
}
