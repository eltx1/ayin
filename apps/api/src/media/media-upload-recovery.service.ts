import { type MediaUploadSession, Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";
import { lockAdminAccountWrite } from "../admin/admin-account-write-authority.js";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { unauthorized } from "../auth/auth.errors.js";
import { DatabaseService } from "../database/database.service.js";
import { lockMediaGeneration } from "./media-generation-safety.js";
import { MediaProcessingStorageService } from "./media-processing-storage.service.js";
import {
  MEDIA_STORAGE_ADAPTER,
  MediaStorageObservationError,
  type MediaStorageAdapter,
  type MediaStorageObservationCode,
} from "./media-storage.adapter.js";
import { MediaUploadError } from "./media-upload.service.js";
import { UPLOAD_FILE_IDENTITY_ALGORITHM, UPLOAD_FILE_IDENTITY_MAX_SIZE_BYTES } from "@ayin/types";

type Actor = AuthenticatedRequest["ayinAuth"];
type Observation =
  | { kind: "NOT_INSPECTED"; reason: "EXPIRED" | "SESSION_NOT_OPEN" }
  | {
      kind: "PARTS_OBSERVED";
      uploadedBytes: number;
      parts: Array<{ partNumber: number; sizeBytes: number }>;
    }
  | {
      kind: "STORED_UNVERIFIED";
      sizeBytes: number;
      contentType: string | null;
      multipartMissing?: true;
    }
  | {
      kind: "UNAVAILABLE";
      reason: MediaStorageObservationCode | "STORAGE_UNAVAILABLE" | "OBJECT_METADATA_MISMATCH";
      multipartMissing?: true;
    };

function changed(): never {
  throw new MediaUploadError(
    "UPLOAD_RECOVERY_CHANGED",
    "The saved upload is no longer available for this inspection.",
    409,
  );
}
function missing(): never {
  throw new MediaUploadError(
    "UPLOAD_RECOVERY_NOT_FOUND",
    "The saved upload could not be found.",
    404,
  );
}
function fingerprint(session: MediaUploadSession): string {
  return JSON.stringify(session, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

// Dormant foundation: this service deliberately has no create, renew, complete,
// cancel or cleanup entry point. Only trusted future issuance may populate rows.
@Injectable()
export class MediaUploadRecoveryService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MEDIA_STORAGE_ADAPTER) private readonly storage: MediaStorageAdapter,
    @Inject(MediaProcessingStorageService) private readonly metadata: MediaProcessingStorageService,
  ) {}

  async inspect(actor: Actor, sessionId: string) {
    const initial = await this.snapshot(actor, sessionId);
    let observation: Observation;
    if (initial.hardExpiresAt.getTime() <= Date.now())
      observation = { kind: "NOT_INSPECTED", reason: "EXPIRED" };
    else if (initial.state !== "OPEN")
      observation = { kind: "NOT_INSPECTED", reason: "SESSION_NOT_OPEN" };
    else {
      observation = await this.observe(initial);
      // No authority/resource locks are retained while doing provider reads.
      const current = await this.snapshot(actor, sessionId, initial);
      if (current.hardExpiresAt.getTime() <= Date.now())
        throw new MediaUploadError(
          "UPLOAD_RECOVERY_EXPIRED",
          "This saved upload session has expired.",
          410,
        );
    }
    return {
      protocolVersion: 1 as const,
      actorAccountId: actor.accountId,
      channelId: initial.channelId,
      sessionId: initial.id,
      assetId: initial.sourceAssetId,
      videoId: initial.videoId,
      state: initial.state,
      revision: initial.revision,
      mode: initial.mode,
      sizeBytes: Number(initial.sizeBytes),
      mimeType: initial.mimeType,
      partSizeBytes: Number(initial.partSizeBytes),
      partCount:
        initial.mode === "SINGLE"
          ? 1
          : Number((initial.sizeBytes + initial.partSizeBytes - 1n) / initial.partSizeBytes),
      createdAt: initial.createdAt.toISOString(),
      expiresAt: initial.hardExpiresAt.toISOString(),
      expired: initial.hardExpiresAt.getTime() <= Date.now(),
      observation,
    };
  }

  private async observe(session: MediaUploadSession): Promise<Observation> {
    if (!this.storage.available) return { kind: "UNAVAILABLE", reason: "STORAGE_UNAVAILABLE" };
    let multipartMissing = false;
    try {
      if (session.mode === "MULTIPART") {
        try {
          const parts = await this.storage.listParts({
            key: session.objectKey,
            uploadId: session.providerUploadId!,
          });
          const count = Number(
            (session.sizeBytes + session.partSizeBytes - 1n) / session.partSizeBytes,
          );
          const seen = new Set<number>();
          if (!Array.isArray(parts) || parts.length > count)
            return { kind: "UNAVAILABLE", reason: "INVALID_RESPONSE" };
          let uploadedBytes = 0;
          const safeParts: Array<{ partNumber: number; sizeBytes: number }> = [];
          for (const part of parts) {
            if (
              !part ||
              !Number.isSafeInteger(part.partNumber) ||
              part.partNumber < 1 ||
              part.partNumber > count ||
              seen.has(part.partNumber) ||
              !Number.isSafeInteger(part.sizeBytes) ||
              typeof part.etag !== "string" ||
              !part.etag.trim() ||
              part.etag.length > 256
            )
              return { kind: "UNAVAILABLE", reason: "INVALID_RESPONSE" };
            const expected =
              part.partNumber === count
                ? session.sizeBytes - session.partSizeBytes * BigInt(count - 1)
                : session.partSizeBytes;
            if (BigInt(part.sizeBytes) !== expected)
              return { kind: "UNAVAILABLE", reason: "INVALID_RESPONSE" };
            seen.add(part.partNumber);
            uploadedBytes += part.sizeBytes;
            safeParts.push({ partNumber: part.partNumber, sizeBytes: part.sizeBytes });
          }
          return {
            kind: "PARTS_OBSERVED",
            uploadedBytes,
            parts: safeParts.sort((left, right) => left.partNumber - right.partNumber),
          };
        } catch (error) {
          if (
            !(error instanceof MediaStorageObservationError) ||
            error.code !== "NO_SUCH_UPLOAD" ||
            error.operation !== "listParts" ||
            error.providerStatus !== 404
          )
            throw error;
          multipartMissing = true;
          // Missing multipart state is not proof that the final object is absent.
        }
      }
      // Reuse the existing bounded, strict R2 metadata reader. No source bytes
      // are downloaded and no object-presence observation establishes integrity.
      const object = await this.metadata.headObject(session.objectKey);
      const mime = object.contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
      if (
        !Number.isSafeInteger(object.sizeBytes) ||
        object.sizeBytes <= 0 ||
        BigInt(object.sizeBytes) !== session.sizeBytes ||
        (mime !== null && mime !== session.mimeType)
      )
        return {
          kind: "UNAVAILABLE",
          reason: "OBJECT_METADATA_MISMATCH",
          ...(multipartMissing ? { multipartMissing: true } : {}),
        };
      return {
        kind: "STORED_UNVERIFIED",
        sizeBytes: object.sizeBytes,
        contentType: mime,
        ...(multipartMissing ? { multipartMissing: true } : {}),
      };
    } catch (error) {
      return {
        kind: "UNAVAILABLE",
        reason:
          error instanceof MediaStorageObservationError
            ? error.code === "NO_SUCH_UPLOAD" && !multipartMissing
              ? "INVALID_RESPONSE"
              : error.code
            : "PROVIDER_ERROR",
        ...(multipartMissing ? { multipartMissing: true } : {}),
      };
    }
  }

  private async snapshot(
    actor: Actor,
    sessionId: string,
    expected?: MediaUploadSession,
  ): Promise<MediaUploadSession> {
    const readSnapshot = async (tx: Prisma.TransactionClient) => {
      // Prisma's transaction timer does not cancel an already blocked query.
      // PostgreSQL must bound lock waits before any authority/resource lock.
      // SET LOCAL is restored on rollback/commit; no pool/global setting changes.
      await tx.$executeRaw`SET LOCAL lock_timeout = '3000ms'`;
      const observed = await tx.mediaUploadSession.findUnique({ where: { id: sessionId } });
      if (!observed || observed.initiatingAccountId !== actor.accountId) missing();
      if (!observed.sourceAssetId || (expected && fingerprint(observed) !== fingerprint(expected)))
        changed();
      await this.authority(tx, actor, observed);

      // Match the upload/privacy prerequisite: authority -> generation ->
      // source -> video -> channel. The new sidecar lock is last.
      if (observed.videoId) await lockMediaGeneration(tx, observed.videoId);
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "MediaAsset" WHERE "id" = ${observed.sourceAssetId}::uuid FOR SHARE /* ayin-upload-recovery-source-lock */`,
      );
      const asset = await tx.mediaAsset.findUnique({
        where: { id: observed.sourceAssetId },
        select: {
          videoId: true,
          channelId: true,
          kind: true,
          status: true,
          removedAt: true,
          r2ObjectKey: true,
          sizeBytes: true,
          mimeType: true,
        },
      });
      if (
        !asset ||
        asset.videoId !== observed.videoId ||
        asset.channelId !== observed.channelId ||
        asset.kind !== "SOURCE_VIDEO" ||
        asset.removedAt ||
        !["PENDING", "UPLOADED"].includes(asset.status) ||
        asset.r2ObjectKey !== observed.objectKey ||
        asset.sizeBytes !== observed.sizeBytes ||
        asset.mimeType !== observed.mimeType
      )
        changed();
      if (observed.videoId) {
        const [video] = await tx.$queryRaw<
          Array<{ channelId: string; status: string; removedAt: Date | null }>
        >(
          Prisma.sql`SELECT "channelId", "status", "removedAt" FROM "Video" WHERE "id" = ${observed.videoId}::uuid FOR SHARE /* ayin-upload-recovery-video-lock */`,
        );
        if (
          !video ||
          video.channelId !== observed.channelId ||
          video.status === "REMOVED" ||
          video.removedAt
        )
          changed();
      }
      const [channel] = await tx.$queryRaw<Array<{ status: string; removedAt: Date | null }>>(
        Prisma.sql`SELECT "status", "removedAt" FROM "Channel" WHERE "id" = ${observed.channelId}::uuid FOR SHARE /* ayin-upload-recovery-channel-lock */`,
      );
      if (!channel || channel.status === "REMOVED" || channel.removedAt) changed();
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "MediaUploadSession" WHERE "id" = ${sessionId}::uuid FOR SHARE /* ayin-upload-recovery-session-lock */`,
      );
      const current = await tx.mediaUploadSession.findUnique({ where: { id: sessionId } });
      if (!current || fingerprint(current) !== fingerprint(observed)) changed();
      this.validateContract(current);
      await this.authority(tx, actor, current);
      return current;
    };
    return this.database.client
      .$transaction(readSnapshot, { maxWait: 2000, timeout: 5000 })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          // Prisma 7 driver adapters retain PostgreSQL's SQLSTATE in the cause.
          const driver = error.meta?.driverAdapterError as
            { cause?: { originalCode?: unknown } } | undefined;
          const sqlState = error.meta?.code ?? driver?.cause?.originalCode;
          if (
            error.code === "P2028" ||
            (error.code === "P2010" && (sqlState === "55P03" || sqlState === "57014"))
          )
            throw new MediaUploadError(
              "UPLOAD_RECOVERY_BUSY",
              "This upload is busy. Check it again shortly.",
              503,
            );
        }
        throw error;
      });
  }

  private async authority(tx: Prisma.TransactionClient, actor: Actor, session: MediaUploadSession) {
    if (session.authority === "ADMIN") {
      await lockAdminAccountWrite(tx, actor, actor.accountId, undefined, [
        "OPERATIONS",
        "CONTENT_MODERATOR",
      ]);
      return;
    }
    const [account] = await tx.$queryRaw<Array<{ status: string; authVersion: number }>>(
      Prisma.sql`SELECT "status", "authVersion" FROM "Account" WHERE "id" = ${actor.accountId}::uuid FOR SHARE /* ayin-upload-recovery-account-lock */`,
    );
    if (!account || account.status !== "ACTIVE" || account.authVersion !== actor.authVersion)
      throw unauthorized();
    const sessions = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "AccountSession" WHERE "id" = ${actor.sessionId}::uuid AND "accountId" = ${actor.accountId}::uuid AND "authVersion" = ${actor.authVersion} AND "revokedAt" IS NULL AND "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC') FOR SHARE /* ayin-upload-recovery-auth-session-lock */`,
    );
    if (!sessions.length) throw unauthorized();
    const membership = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "ChannelMember" WHERE "channelId" = ${session.channelId}::uuid AND "accountId" = ${actor.accountId}::uuid AND "role" = 'OWNER' FOR SHARE /* ayin-upload-recovery-owner-lock */`,
    );
    if (!membership.length)
      throw new MediaUploadError(
        "CHANNEL_OWNER_REQUIRED",
        "Current channel ownership is required to inspect this upload.",
        403,
      );
  }

  private validateContract(session: MediaUploadSession) {
    const count =
      session.partSizeBytes > 0n
        ? (session.sizeBytes + session.partSizeBytes - 1n) / session.partSizeBytes
        : 0n;
    if (
      session.sizeBytes <= 0n ||
      session.sizeBytes > BigInt(UPLOAD_FILE_IDENTITY_MAX_SIZE_BYTES) ||
      session.partSizeBytes <= 0n ||
      session.partSizeBytes > 5n * 1024n ** 3n ||
      count < 1n ||
      count > 10000n ||
      session.contentIdentityAlgorithm !== UPLOAD_FILE_IDENTITY_ALGORITHM ||
      (session.contentIdentityDigest !== null
        ? !/^[0-9a-f]{64}$/.test(session.contentIdentityDigest)
        : !["REVOKED", "EXPIRED", "ABORTED"].includes(session.state)) ||
      !Number.isSafeInteger(session.revision) ||
      session.revision < 1 ||
      session.hardExpiresAt.getTime() <= session.createdAt.getTime() ||
      session.hardExpiresAt.getTime() - session.createdAt.getTime() > 86400000
    )
      changed();
    if (session.mode === "SINGLE") {
      if (session.providerUploadId !== null || session.sizeBytes > 5n * 1024n ** 3n) changed();
    } else if (
      session.partSizeBytes < 5n * 1024n ** 2n ||
      (session.state === "OPEN" && !session.providerUploadId)
    )
      changed();
  }
}
