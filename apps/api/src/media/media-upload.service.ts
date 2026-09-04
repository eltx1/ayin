import { randomUUID } from "node:crypto";
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

function normalizeVideoMimeType(value: string): SupportedVideoMimeType | null {
  const mimeType = value.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  return SUPPORTED_VIDEO_MIME_TYPES.has(mimeType) ? (mimeType as SupportedVideoMimeType) : null;
}

function sourceExtension(mimeType: SupportedVideoMimeType): string {
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

export class MediaUploadError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "MediaUploadError";
  }
}

export interface CreateUploadSessionInput {
  channelId: string;
  sizeBytes: number;
  mimeType: string;
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
    accountId: string,
    input: CreateUploadSessionInput,
    options: { adminOverride?: boolean } = {},
  ) {
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

    if (!options.adminOverride) await this.assertChannelOwner(accountId, input.channelId);
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
        channelId: input.channelId,
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
    const objectKey = `channels/${input.channelId}/media/${assetId}/source.${sourceExtension(mimeType)}`;
    const mode = input.sizeBytes >= this.config.multipartThresholdBytes ? "multipart" : "single";
    const expiresAtMs = Date.now() + this.config.uploadUrlTtlSeconds * 1000;
    let uploadId: string | null = null;

    if (mode === "multipart") {
      uploadId = (
        await this.storage.createMultipartUpload({ key: objectKey, contentType: mimeType })
      ).uploadId;
    }

    try {
      await this.database.client.mediaAsset.create({
        data: {
          id: assetId,
          channelId: input.channelId,
          kind: "SOURCE_VIDEO",
          status: "PENDING",
          r2ObjectKey: objectKey,
          mimeType,
          sizeBytes: BigInt(input.sizeBytes),
        },
      });
    } catch (error) {
      if (uploadId) {
        await this.storage
          .abortMultipartUpload({ key: objectKey, uploadId })
          .catch(() => undefined);
      }
      throw error;
    }

    const payload: UploadSessionPayload = {
      version: 1,
      accountId,
      ...(options.adminOverride ? { adminOverride: true } : {}),
      channelId: input.channelId,
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

    if (mode === "single") {
      try {
        const authorization = await this.storage.authorizeSinglePut({
          key: objectKey,
          contentType: mimeType,
          expiresInSeconds: this.config.uploadUrlTtlSeconds,
        });
        return {
          assetId,
          objectKey,
          mode,
          sizeBytes: input.sizeBytes,
          sessionToken,
          expiresAt: new Date(expiresAtMs).toISOString(),
          upload: {
            url: authorization.url,
            method: "PUT" as const,
            headers: { "content-type": mimeType },
          },
        };
      } catch (error) {
        await this.rejectAsset(assetId);
        throw error;
      }
    }

    return {
      assetId,
      objectKey,
      mode,
      sizeBytes: input.sizeBytes,
      partSizeBytes: this.config.partSizeBytes,
      partCount: Math.ceil(input.sizeBytes / this.config.partSizeBytes),
      sessionToken,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  async authorizePart(accountId: string, sessionToken: string, partNumber: number) {
    const session = await this.assertSession(accountId, sessionToken, ["PENDING"]);
    if (session.mode !== "multipart" || !session.uploadId) {
      throw new MediaUploadError("NOT_MULTIPART", "This upload does not use multipart mode.");
    }
    const partCount = Math.ceil(session.sizeBytes / session.partSizeBytes);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > partCount) {
      throw new MediaUploadError("INVALID_PART", "That upload part is outside the expected range.");
    }
    return this.storage.authorizeMultipartPart({
      key: session.objectKey,
      uploadId: session.uploadId,
      partNumber,
      expiresInSeconds: this.remainingAuthorizationSeconds(session),
    });
  }

  async resumeParts(accountId: string, sessionToken: string) {
    const session = await this.assertSession(accountId, sessionToken, ["PENDING"]);
    if (session.mode !== "multipart" || !session.uploadId) {
      return { parts: [] };
    }
    return {
      parts: await this.storage.listParts({ key: session.objectKey, uploadId: session.uploadId }),
    };
  }

  async complete(
    accountId: string,
    sessionToken: string,
    parts: CompletedUploadPart[],
  ): Promise<{ assetId: string; status: "UPLOADED" }> {
    const session = await this.assertSession(accountId, sessionToken, ["PENDING", "UPLOADED"]);
    const existing = await this.database.client.mediaAsset.findUnique({
      where: { id: session.assetId },
      select: { status: true },
    });
    if (existing?.status === "UPLOADED") {
      await this.processingLifecycle.enqueueUploadedAsset(session.assetId);
      return { assetId: session.assetId, status: "UPLOADED" };
    }

    if (session.mode === "multipart") {
      if (!session.uploadId) {
        throw new MediaUploadError("INVALID_UPLOAD_SESSION", "This upload session is incomplete.");
      }
      const expectedPartCount = Math.ceil(session.sizeBytes / session.partSizeBytes);
      this.validateCompletedParts(parts, expectedPartCount);
      try {
        await this.storage.completeMultipartUpload({
          key: session.objectKey,
          uploadId: session.uploadId,
          parts,
        });
      } catch (error) {
        const recovered = await this.objectMatchesSession(session);
        if (!recovered) {
          throw error;
        }
      }
    } else if (!(await this.objectMatchesSession(session))) {
      throw new MediaUploadError(
        "UPLOAD_SIZE_OR_TYPE_MISMATCH",
        "The uploaded video does not match the selected source file. Please retry the upload.",
      );
    }

    await this.database.client.mediaAsset.update({
      where: { id: session.assetId },
      data: { status: "UPLOADED" },
    });
    await this.processingLifecycle.enqueueUploadedAsset(session.assetId);
    return { assetId: session.assetId, status: "UPLOADED" };
  }

  async abort(accountId: string, sessionToken: string): Promise<{ status: "ABORTED" }> {
    const session = await this.assertSession(accountId, sessionToken, ["PENDING"]);
    if (session.mode === "multipart" && session.uploadId) {
      await this.storage.abortMultipartUpload({
        key: session.objectKey,
        uploadId: session.uploadId,
      });
    } else {
      await this.storage.deleteObject(session.objectKey).catch(() => undefined);
    }
    await this.rejectAsset(session.assetId);
    return { status: "ABORTED" };
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
        select: { id: true, status: true },
      });
      if (!asset || asset.status !== "PENDING") {
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

  private async assertSession(
    accountId: string,
    sessionToken: string,
    allowedStatuses: Array<"PENDING" | "UPLOADED">,
  ): Promise<UploadSessionPayload> {
    let session: UploadSessionPayload;
    try {
      session = this.tokens.verify(sessionToken);
    } catch {
      throw new MediaUploadError(
        "INVALID_UPLOAD_SESSION",
        "This upload session expired or is invalid. Start the upload again.",
        401,
      );
    }
    if (session.accountId !== accountId) {
      throw new MediaUploadError(
        "UPLOAD_NOT_OWNED",
        "This upload belongs to another account.",
        403,
      );
    }
    if (!session.adminOverride) await this.assertChannelOwner(accountId, session.channelId);
    const asset = await this.database.client.mediaAsset.findUnique({
      where: { id: session.assetId },
      select: {
        channelId: true,
        r2ObjectKey: true,
        sizeBytes: true,
        mimeType: true,
        status: true,
      },
    });
    if (
      !asset ||
      asset.channelId !== session.channelId ||
      asset.r2ObjectKey !== session.objectKey ||
      asset.sizeBytes !== BigInt(session.sizeBytes) ||
      asset.mimeType !== session.mimeType ||
      !allowedStatuses.includes(asset.status as "PENDING" | "UPLOADED")
    ) {
      throw new MediaUploadError(
        "UPLOAD_STATE_CHANGED",
        "This upload is no longer available. Start a new upload if needed.",
        409,
      );
    }
    return session;
  }

  private async assertChannelOwner(accountId: string, channelId: string): Promise<void> {
    const membership = await this.database.client.channelMember.findFirst({
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
