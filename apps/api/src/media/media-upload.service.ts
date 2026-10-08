import { assertUploadByteQuota, lockUploadAdmission } from "./media-upload-admission.js";
import { MediaUploadError } from "./media-upload-error.js";
import { randomUUID } from "node:crypto";
import { Prisma } from "@ayin/db";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { unauthorized } from "../auth/auth.errors.js";
import {
  observeChannelMediaOwners,
  lockChannelMediaAccounts,
  assertChannelMediaOwners,
} from "./media-privacy-account-fence.js";
import { lockAdminAccountWrite } from "../admin/admin-account-write-authority.js";
import { lockMediaGeneration } from "./media-generation-safety.js";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import { MediaProcessingLifecycleService } from "./media-processing-lifecycle.service.js";
import {
  MEDIA_STORAGE_ADAPTER,
  MEDIA_STORAGE_CONFIG,
  type CompletedUploadPart,
  type MediaStorageAdapter,
  MediaStorageUnavailableError,
} from "./media-storage.adapter.js";
import type { MediaStorageConfig } from "./media-storage.config.js";
import {
  type UploadSessionPayload,
  UploadSessionTokenService,
} from "./upload-session-token.service.js";

export type UploadActor = AuthenticatedRequest["ayinAuth"];

const SUPPORTED_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-matroska",
  "video/webm",
  "video/x-msvideo",
  "video/mpeg",
  "video/mp2t",
  "video/3gpp",
  "video/3gpp2",
  "video/x-m4v",
  "video/x-ms-wmv",
  "video/x-flv",
  "video/ogg",
  "application/mxf",
]);

type SupportedVideoMimeType =
  | "video/mp4"
  | "video/quicktime"
  | "video/x-matroska"
  | "video/webm"
  | "video/x-msvideo"
  | "video/mpeg"
  | "video/mp2t"
  | "video/3gpp"
  | "video/3gpp2"
  | "video/x-m4v"
  | "video/x-ms-wmv"
  | "video/x-flv"
  | "video/ogg"
  | "application/mxf";

export function normalizeVideoMimeType(value: string): SupportedVideoMimeType | null {
  const mimeType = value.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  return SUPPORTED_VIDEO_MIME_TYPES.has(mimeType) ? (mimeType as SupportedVideoMimeType) : null;
}

export function sourceExtension(mimeType: SupportedVideoMimeType): string {
  const extensions: Record<SupportedVideoMimeType, string> = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/x-matroska": "mkv",
    "video/webm": "webm",
    "video/x-msvideo": "avi",
    "video/mpeg": "mpeg",
    "video/mp2t": "m2ts",
    "video/3gpp": "3gp",
    "video/3gpp2": "3g2",
    "video/x-m4v": "m4v",
    "video/x-ms-wmv": "wmv",
    "video/x-flv": "flv",
    "video/ogg": "ogv",
    "application/mxf": "mxf",
  };
  return extensions[mimeType];
}

// Preserve existing callers' import and instanceof identity.
export { MediaUploadError } from "./media-upload-error.js";

export interface CreateUploadSessionInput {
  channelId: string;
  sizeBytes: number;
  mimeType: string;
}

export interface CreateUploadSessionOptions {
  adminOverride?: boolean;
  videoId?: string;
  // Internal caller hooks run only inside the short fenced DB phase, never R2.
  validateTarget?: (tx: Prisma.TransactionClient) => Promise<void>;
  onCreated?: (tx: Prisma.TransactionClient, assetId: string) => Promise<void>;
}

@Injectable()
export class MediaUploadService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
    @Inject(MEDIA_STORAGE_ADAPTER) private readonly storage: MediaStorageAdapter,
    @Inject(MEDIA_STORAGE_CONFIG) private readonly config: MediaStorageConfig,
    @Inject(UploadSessionTokenService) private readonly tokens: UploadSessionTokenService,
    @Inject(MediaProcessingLifecycleService)
    private readonly processingLifecycle: MediaProcessingLifecycleService,
  ) {}

  async createSession(
    actor: UploadActor,
    input: CreateUploadSessionInput,
    options: CreateUploadSessionOptions = {},
  ) {
    const { accountId } = actor;
    // PostgreSQL UUID identity is case-insensitive; object keys are not. Use a
    // canonical identity before comparisons, new keys and signed payloads.
    const channelId = input.channelId.toLowerCase();
    const creationOptions: CreateUploadSessionOptions = {
      ...options,
      ...(options.videoId === undefined ? {} : { videoId: options.videoId.toLowerCase() }),
    };
    this.ensureStorageAvailable();
    const mimeType = normalizeVideoMimeType(input.mimeType);
    if (!mimeType) {
      throw new MediaUploadError(
        "UNSUPPORTED_VIDEO_TYPE",
        "Choose a supported video file from your phone, camera, or computer.",
      );
    }
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
      throw new MediaUploadError("INVALID_FILE_SIZE", "This video file size could not be read.");
    }

    await this.withCreationAuthority(actor, channelId, creationOptions, async () => undefined);
    const [maxSizeRaw, quotaRaw] = await Promise.all([
      this.settings.get("uploadMaxSizeBytes"),
      this.settings.get("uploadChannelQuotaBytes"),
    ]);
    const maxSizeBytes = maxSizeRaw as number;
    const quotaBytes = quotaRaw as number;
    if (input.sizeBytes > maxSizeBytes) {
      throw new MediaUploadError(
        "VIDEO_TOO_LARGE",
        "This video is larger than the current AYIN upload limit.",
        413,
      );
    }

    const aggregate = await this.database.client.mediaAsset.aggregate({
      where: {
        channelId,
        kind: "SOURCE_VIDEO",
        status: { in: ["PENDING", "UPLOADED", "VALIDATED"] },
        removedAt: null,
      },
      _sum: { sizeBytes: true },
    });
    const currentBytes = aggregate._sum.sizeBytes ?? 0n;
    if (currentBytes + BigInt(input.sizeBytes) > BigInt(quotaBytes)) {
      throw new MediaUploadError(
        "CHANNEL_UPLOAD_QUOTA_REACHED",
        "This channel has reached its current upload storage allowance.",
        413,
      );
    }

    const assetId = randomUUID();
    const objectKey = `channels/${channelId}/media/${assetId}/source.${sourceExtension(mimeType)}`;
    const mode = input.sizeBytes >= this.config.multipartThresholdBytes ? "multipart" : "single";
    const expiresAtMs = Date.now() + this.config.uploadUrlTtlSeconds * 1000;
    let uploadId: string | null = null;

    // Both provider allocations happen outside the database fence. No URL or
    // token is returned until current authority and privacy scope commit again.
    let authorization: Awaited<ReturnType<MediaStorageAdapter["authorizeSinglePut"]>> | null = null;
    if (mode === "multipart") {
      uploadId = (
        await this.storage.createMultipartUpload({ key: objectKey, contentType: mimeType })
      ).uploadId;
    } else {
      authorization = await this.storage.authorizeSinglePut({
        key: objectKey,
        contentType: mimeType,
        expiresInSeconds: this.config.uploadUrlTtlSeconds,
      });
    }

    const payload: UploadSessionPayload = {
      version: 1,
      accountId,
      ...(creationOptions.adminOverride ? { adminOverride: true } : {}),
      channelId,
      assetId,
      objectKey,
      uploadId,
      mode,
      mimeType,
      sizeBytes: input.sizeBytes,
      partSizeBytes: this.config.partSizeBytes,
      expiresAtMs,
    };
    const sessionToken = this.tokens.sign(payload);

    try {
      await this.withCreationAuthority(actor, channelId, creationOptions, async (tx) => {
        this.verifySession(sessionToken);
        await assertUploadByteQuota(tx, channelId, input.sizeBytes, quotaBytes);
        await tx.mediaAsset.create({
          data: {
            id: assetId,
            channelId,
            videoId: creationOptions.videoId ?? null,
            kind: "SOURCE_VIDEO",
            status: "PENDING",
            r2ObjectKey: objectKey,
            mimeType,
            sizeBytes: BigInt(input.sizeBytes),
          },
        });
        await creationOptions.onCreated?.(tx, assetId);
      });
    } catch (error) {
      if (uploadId)
        await this.storage
          .abortMultipartUpload({ key: objectKey, uploadId })
          .catch(() => undefined);
      throw error;
    }

    if (authorization)
      return {
        assetId,
        objectKey,
        mode: "single" as const,
        sizeBytes: input.sizeBytes,
        sessionToken,
        expiresAt: new Date(expiresAtMs).toISOString(),
        upload: {
          url: authorization.url,
          method: "PUT" as const,
          headers: { "content-type": mimeType },
        },
      };

    return {
      assetId,
      objectKey,
      mode: "multipart" as const,
      sizeBytes: input.sizeBytes,
      partSizeBytes: this.config.partSizeBytes,
      partCount: Math.ceil(input.sizeBytes / this.config.partSizeBytes),
      sessionToken,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  async authorizePart(actor: UploadActor, sessionToken: string, partNumber: number) {
    const session = await this.withSession(
      actor,
      sessionToken,
      ["PENDING"],
      async (_tx, session) => session,
    );
    if (session.mode !== "multipart" || !session.uploadId) {
      throw new MediaUploadError("NOT_MULTIPART", "This upload does not use multipart mode.");
    }
    const partCount = Math.ceil(session.sizeBytes / session.partSizeBytes);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > partCount) {
      throw new MediaUploadError("INVALID_PART", "That upload part is outside the expected range.");
    }
    const authorization = await this.storage.authorizeMultipartPart({
      key: session.objectKey,
      uploadId: session.uploadId,
      partNumber,
      expiresInSeconds: this.remainingAuthorizationSeconds(session),
    });
    return this.withSession(actor, sessionToken, ["PENDING"], async () => authorization);
  }

  async resumeParts(actor: UploadActor, sessionToken: string) {
    const session = await this.withSession(
      actor,
      sessionToken,
      ["PENDING"],
      async (_tx, session) => session,
    );
    const parts =
      session.mode === "multipart" && session.uploadId
        ? await this.storage.listParts({ key: session.objectKey, uploadId: session.uploadId })
        : [];
    return this.withSession(actor, sessionToken, ["PENDING"], async () => ({ parts }));
  }

  async complete(
    actor: UploadActor,
    sessionToken: string,
    parts: CompletedUploadPart[],
  ): Promise<{ assetId: string; status: "UPLOADED" }> {
    const { session, status } = await this.withSession(
      actor,
      sessionToken,
      ["PENDING", "UPLOADED"],
      async (_tx, session, status) => ({ session, status }),
    );
    if (status !== "UPLOADED") {
      if (session.mode === "multipart") {
        if (!session.uploadId) {
          throw new MediaUploadError(
            "INVALID_UPLOAD_SESSION",
            "This upload session is incomplete.",
          );
        }
        const expectedPartCount = Math.ceil(session.sizeBytes / session.partSizeBytes);
        this.validateCompletedParts(parts, expectedPartCount);
        let verifiedAfterUncertainCompletion = false;
        try {
          await this.storage.completeMultipartUpload({
            key: session.objectKey,
            uploadId: session.uploadId,
            parts,
          });
        } catch (error) {
          const recovered = await this.objectMatchesSession(session);
          if (!recovered) throw error;
          verifiedAfterUncertainCompletion = true;
        }
        if (!verifiedAfterUncertainCompletion && !(await this.objectMatchesSession(session))) {
          throw new MediaUploadError(
            "UPLOAD_SIZE_OR_TYPE_MISMATCH",
            "The completed video does not match the selected source file. Review the upload before trying again.",
          );
        }
      } else if (!(await this.objectMatchesSession(session))) {
        throw new MediaUploadError(
          "UPLOAD_SIZE_OR_TYPE_MISMATCH",
          "The uploaded video does not match the selected source file. Please retry the upload.",
        );
      }
    }

    // Provider work cannot be rolled back. Recheck current authority/lifecycle before
    // committing source state and processing together; never hold staff locks during R2 I/O.
    return this.withSession(
      actor,
      sessionToken,
      ["PENDING", "UPLOADED"],
      async (tx, current, status) => {
        if (status === "PENDING")
          await tx.mediaAsset.update({
            where: { id: current.assetId },
            data: { status: "UPLOADED" },
          });
        await this.processingLifecycle.enqueueUploadedAssetInTransaction(tx, current.assetId);
        return { assetId: current.assetId, status: "UPLOADED" as const };
      },
    );
  }

  async abort(actor: UploadActor, sessionToken: string): Promise<{ status: "ABORTED" }> {
    const session = await this.withSession(
      actor,
      sessionToken,
      ["PENDING"],
      async (_tx, session) => session,
    );
    if (session.mode === "multipart" && session.uploadId) {
      await this.storage.abortMultipartUpload({
        key: session.objectKey,
        uploadId: session.uploadId,
      });
    } else {
      await this.storage.deleteObject(session.objectKey).catch(() => undefined);
    }
    return this.withSession(actor, sessionToken, ["PENDING"], async (tx, current) => {
      await tx.mediaAsset.update({
        where: { id: current.assetId },
        data: { status: "REJECTED", removedAt: new Date() },
      });
      return { status: "ABORTED" as const };
    });
  }

  async cleanupAbandonedUploads(
    olderThan: Date,
  ): Promise<{ abortedMultipart: number; rejectedAssets: number }> {
    this.ensureStorageAvailable();
    const uploads = await this.storage.listMultipartUploads("channels/");
    let abortedMultipart = 0;
    for (const upload of uploads) {
      if (upload.initiatedAt >= olderThan) {
        continue;
      }
      const asset = await this.database.client.mediaAsset.findUnique({
        where: { r2ObjectKey: upload.key },
        select: { id: true, status: true, uploadIntegrityRequired: true },
      });
      if (!asset || asset.status !== "PENDING" || asset.uploadIntegrityRequired) {
        continue;
      }
      await this.storage.abortMultipartUpload({ key: upload.key, uploadId: upload.uploadId });
      abortedMultipart += 1;
    }

    const staleAssets = await this.database.client.mediaAsset.findMany({
      where: {
        kind: "SOURCE_VIDEO",
        status: "PENDING",
        removedAt: null,
        createdAt: { lt: olderThan },
        uploadIntegrityRequired: false,
      },
      select: { id: true, r2ObjectKey: true },
    });
    for (const asset of staleAssets) {
      await this.storage.deleteObject(asset.r2ObjectKey).catch(() => undefined);
      await this.rejectAsset(asset.id);
    }
    return { abortedMultipart, rejectedAssets: staleAssets.length };
  }

  private async objectMatchesSession(session: UploadSessionPayload): Promise<boolean> {
    try {
      const object = await this.storage.headObject(session.objectKey);
      const objectMimeType = object.contentType
        ? object.contentType.toLowerCase().split(";", 1)[0]?.trim()
        : null;
      return (
        object.sizeBytes === session.sizeBytes &&
        (!objectMimeType || objectMimeType === session.mimeType.toLowerCase())
      );
    } catch {
      return false;
    }
  }

  private async withCreationAuthority<T>(
    actor: UploadActor,
    channelId: string,
    options: CreateUploadSessionOptions,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.database.client.$transaction(async (tx) => {
      const owners = await observeChannelMediaOwners(tx, channelId);
      const assertActor = async () => {
        if (options.adminOverride) {
          await lockAdminAccountWrite(
            tx,
            actor,
            actor.accountId,
            undefined,
            ["OPERATIONS", "CONTENT_MODERATOR"],
            owners,
          );
        } else {
          const account = await tx.account.findUnique({
            where: { id: actor.accountId },
            select: { status: true, authVersion: true },
          });
          const sessions = await tx.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`SELECT id FROM "AccountSession" WHERE id = ${actor.sessionId}::uuid
              AND "accountId" = ${actor.accountId}::uuid AND "authVersion" = ${actor.authVersion}
              AND "revokedAt" IS NULL AND "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC') FOR SHARE`,
          );
          if (
            !account ||
            account.status !== "ACTIVE" ||
            account.authVersion !== actor.authVersion ||
            !sessions.length
          )
            throw unauthorized();
        }
      };
      if (!options.adminOverride) await lockChannelMediaAccounts(tx, actor.accountId, owners);
      await assertActor();
      await assertChannelMediaOwners(tx, channelId, owners);
      if (!options.adminOverride) await this.assertChannelOwner(actor.accountId, channelId, tx);
      await lockUploadAdmission(tx, channelId);
      if (options.videoId) {
        await lockMediaGeneration(tx, options.videoId);
        const [video] = await tx.$queryRaw<
          Array<{ channelId: string; status: string; removedAt: Date | null }>
        >(
          Prisma.sql`SELECT "channelId", status, "removedAt" FROM "Video" WHERE id = ${options.videoId}::uuid FOR NO KEY UPDATE /* ayin-upload-create-video-lock */`,
        );
        if (
          !video ||
          video.channelId !== channelId ||
          video.status === "REMOVED" ||
          video.removedAt
        )
          this.changedSession();
      }
      const [channel] = await tx.$queryRaw<Array<{ status: string; removedAt: Date | null }>>(
        Prisma.sql`SELECT status, "removedAt" FROM "Channel" WHERE id = ${channelId}::uuid FOR SHARE /* ayin-upload-create-channel-lock */`,
      );
      if (!channel || channel.status === "REMOVED" || channel.removedAt) this.changedSession();
      await options.validateTarget?.(tx);
      await assertActor();
      return operation(tx);
    });
  }

  private async withSession<T>(
    actor: UploadActor,
    sessionToken: string,
    allowedStatuses: Array<"PENDING" | "UPLOADED">,
    operation: (
      tx: Prisma.TransactionClient,
      session: UploadSessionPayload,
      status: string,
    ) => Promise<T>,
  ): Promise<T> {
    const session = this.verifySession(sessionToken);
    if (session.accountId !== actor.accountId) {
      throw new MediaUploadError(
        "UPLOAD_NOT_OWNED",
        "This upload belongs to another account.",
        403,
      );
    }
    return this.database.client.$transaction(async (tx) => {
      // adminOverride is signed provenance, not a grant of present authority.
      const assertAuthority = async () => {
        if (session.adminOverride) {
          await lockAdminAccountWrite(tx, actor, actor.accountId, undefined, [
            "OPERATIONS",
            "CONTENT_MODERATOR",
          ]);
        } else await this.assertChannelOwner(actor.accountId, session.channelId, tx);
      };
      await assertAuthority();
      const observed = await tx.mediaAsset.findUnique({
        where: { id: session.assetId },
        select: { videoId: true },
      });
      // Generation before source before video matches queue creation and source
      // finalization. NO KEY UPDATE permits unrelated foreign-key key-share reads.
      if (observed?.videoId) await lockMediaGeneration(tx, observed.videoId);
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "MediaAsset" WHERE "id" = ${session.assetId}::uuid FOR UPDATE /* ayin-upload-source-lock */`,
      );
      const asset = await tx.mediaAsset.findUnique({
        where: { id: session.assetId },
        select: {
          channelId: true,
          videoId: true,
          kind: true,
          removedAt: true,
          r2ObjectKey: true,
          sizeBytes: true,
          mimeType: true,
          status: true,
          uploadIntegrityRequired: true,
        },
      });
      if (
        !asset ||
        asset.uploadIntegrityRequired ||
        asset.channelId !== session.channelId ||
        asset.videoId !== observed?.videoId ||
        asset.kind !== "SOURCE_VIDEO" ||
        asset.removedAt ||
        asset.r2ObjectKey !== session.objectKey ||
        asset.sizeBytes !== BigInt(session.sizeBytes) ||
        asset.mimeType !== session.mimeType ||
        !allowedStatuses.includes(asset.status as "PENDING" | "UPLOADED")
      )
        this.changedSession();
      if (asset.videoId) {
        const [video] = await tx.$queryRaw<
          Array<{ channelId: string; status: string; removedAt: Date | null }>
        >(
          Prisma.sql`SELECT "channelId", "status", "removedAt" FROM "Video" WHERE "id" = ${asset.videoId}::uuid FOR NO KEY UPDATE /* ayin-upload-video-lock */`,
        );
        if (
          !video ||
          video.channelId !== session.channelId ||
          video.status === "REMOVED" ||
          video.removedAt
        )
          this.changedSession();
      }
      // Privacy anonymization removes all channel assets, then videos, then the
      // channel. Do not hold the channel while waiting for a source/video lock:
      // an administrator can continue an upload owned by a different account.
      const [channel] = await tx.$queryRaw<Array<{ status: string; removedAt: Date | null }>>(
        Prisma.sql`SELECT "status", "removedAt" FROM "Channel" WHERE "id" = ${session.channelId}::uuid FOR SHARE /* ayin-upload-channel-lock */`,
      );
      if (!channel || channel.status === "REMOVED" || channel.removedAt) this.changedSession();
      // Both upload expiry and step-up can elapse during a database lock wait.
      this.verifySession(sessionToken);
      await assertAuthority();
      return operation(tx, session, asset.status);
    });
  }

  private verifySession(sessionToken: string): UploadSessionPayload {
    try {
      const session = this.tokens.verify(sessionToken);
      // Verify the original signed bytes first. Legacy V1 UUID spellings may
      // differ in case; their provider objectKey/uploadId must remain exact.
      return {
        ...session,
        accountId: session.accountId.toLowerCase(),
        channelId: session.channelId.toLowerCase(),
        assetId: session.assetId.toLowerCase(),
      };
    } catch {
      throw new MediaUploadError(
        "INVALID_UPLOAD_SESSION",
        "This upload session expired or is invalid. Start the upload again.",
        401,
      );
    }
  }

  private changedSession(): never {
    throw new MediaUploadError(
      "UPLOAD_STATE_CHANGED",
      "This upload is no longer available. Start a new upload if needed.",
      409,
    );
  }

  private async assertChannelOwner(
    accountId: string,
    channelId: string,
    client: Pick<Prisma.TransactionClient, "channelMember"> = this.database.client,
  ): Promise<void> {
    const membership = await client.channelMember.findFirst({
      where: { accountId, channelId, role: "OWNER" },
      select: { id: true },
    });
    if (!membership) {
      throw new MediaUploadError(
        "CHANNEL_OWNER_REQUIRED",
        "Only the channel owner can start or manage this upload.",
        403,
      );
    }
  }

  private validateCompletedParts(parts: CompletedUploadPart[], expectedCount: number): void {
    if (parts.length !== expectedCount) {
      throw new MediaUploadError(
        "INCOMPLETE_MULTIPART_UPLOAD",
        "Some video parts are still missing. The upload can resume from the missing parts.",
      );
    }
    const sorted = [...parts].sort((left, right) => left.partNumber - right.partNumber);
    for (let index = 0; index < sorted.length; index += 1) {
      const part = sorted[index];
      if (!part || part.partNumber !== index + 1 || !part.etag.trim()) {
        throw new MediaUploadError(
          "INVALID_MULTIPART_STATE",
          "The uploaded parts could not be verified. Retry the missing part.",
        );
      }
    }
  }

  private remainingAuthorizationSeconds(session: UploadSessionPayload): number {
    const remaining = Math.floor((session.expiresAtMs - Date.now()) / 1000);
    return Math.max(60, Math.min(this.config.uploadUrlTtlSeconds, remaining));
  }

  private async rejectAsset(assetId: string): Promise<void> {
    await this.database.client.mediaAsset.updateMany({
      where: { id: assetId, status: "PENDING" },
      data: { status: "REJECTED", removedAt: new Date() },
    });
  }

  private ensureStorageAvailable(): void {
    if (!this.storage.available) {
      throw new MediaStorageUnavailableError();
    }
  }
}
