import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { MEDIA_STORAGE_ADAPTER, type MediaStorageAdapter } from "../media/media-storage.adapter.js";
import {
  CAPTION_FILE_MAX_BYTES,
  CAPTION_UPLOAD_MIME,
  captionPatchSchema,
  captionReplacementSchema,
  captionUploadSchema,
  validateWebVtt,
  WebVttValidationError,
} from "./caption.validation.js";
import type { z } from "zod";

type CaptionUploadInput = z.infer<typeof captionUploadSchema>;
type CaptionReplacementInput = z.infer<typeof captionReplacementSchema>;
type CaptionPatchInput = z.infer<typeof captionPatchSchema>;

const CAPTION_UPLOAD_TTL_SECONDS = 15 * 60;
const CAPTION_PREFIX = "captions/videos";

export class CaptionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "CaptionError";
  }
}

@Injectable()
export class CaptionService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MEDIA_STORAGE_ADAPTER) private readonly storage: MediaStorageAdapter,
  ) {}

  async list(accountId: string, videoId: string) {
    await this.assertVideoEditor(accountId, videoId);
    const tracks = await this.database.client.videoCaptionTrack.findMany({
      where: { videoId },
      orderBy: [{ isDefault: "desc" }, { languageCode: "asc" }, { createdAt: "asc" }],
    });
    const assetIds = tracks.flatMap((track) =>
      [track.mediaAssetId, track.pendingMediaAssetId].filter((id): id is string => Boolean(id)),
    );
    const assets = assetIds.length
      ? await this.database.client.mediaAsset.findMany({
          where: { id: { in: assetIds } },
          select: { id: true, status: true, sizeBytes: true, mimeType: true },
        })
      : [];
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    return {
      tracks: tracks.map((track) => {
        const active = track.mediaAssetId ? assetById.get(track.mediaAssetId) : undefined;
        return {
          id: track.id,
          videoId: track.videoId,
          languageCode: track.languageCode,
          label: track.label,
          kind: track.kind,
          default: track.isDefault,
          enabled: track.isEnabled,
          status: active?.status === "VALIDATED" ? "READY" : "PENDING",
          sizeBytes: active ? Number(active.sizeBytes) : null,
          replacing: Boolean(track.pendingMediaAssetId),
          createdAt: track.createdAt,
          updatedAt: track.updatedAt,
        };
      }),
    };
  }

  async prepareCreate(accountId: string, videoId: string, input: CaptionUploadInput) {
    const video = await this.assertVideoEditor(accountId, videoId);
    this.assertStorage();
    const assetId = randomUUID();
    const trackId = randomUUID();
    const key = this.objectKey(videoId, assetId);
    const upload = await this.storage.authorizeSinglePut({
      key,
      contentType: CAPTION_UPLOAD_MIME,
      expiresInSeconds: CAPTION_UPLOAD_TTL_SECONDS,
    });
    await this.database.client.$transaction([
      this.database.client.mediaAsset.create({
        data: {
          id: assetId,
          videoId,
          channelId: video.channelId,
          kind: "CAPTION",
          status: "PENDING",
          r2ObjectKey: key,
          mimeType: CAPTION_UPLOAD_MIME,
          sizeBytes: BigInt(input.sizeBytes),
        },
      }),
      this.database.client.videoCaptionTrack.create({
        data: {
          id: trackId,
          videoId,
          pendingMediaAssetId: assetId,
          languageCode: input.languageCode,
          label: input.label,
          kind: input.kind,
          isEnabled: true,
          isDefault: false,
          pendingMakeDefault: input.default,
        },
      }),
    ]);
    return {
      trackId,
      uploadUrl: upload.url,
      expiresAt: upload.expiresAt,
      contentType: CAPTION_UPLOAD_MIME,
      maxBytes: CAPTION_FILE_MAX_BYTES,
    };
  }

  async prepareReplacement(
    accountId: string,
    videoId: string,
    trackId: string,
    input: CaptionReplacementInput,
  ) {
    const video = await this.assertVideoEditor(accountId, videoId);
    const track = await this.track(videoId, trackId);
    this.assertStorage();
    const oldPending = track.pendingMediaAssetId
      ? await this.database.client.mediaAsset.findUnique({
          where: { id: track.pendingMediaAssetId },
        })
      : null;
    const assetId = randomUUID();
    const key = this.objectKey(videoId, assetId);
    const upload = await this.storage.authorizeSinglePut({
      key,
      contentType: CAPTION_UPLOAD_MIME,
      expiresInSeconds: CAPTION_UPLOAD_TTL_SECONDS,
    });
    await this.database.client.$transaction(async (tx) => {
      if (oldPending) {
        await tx.mediaAsset.update({
          where: { id: oldPending.id },
          data: { status: "REMOVED", removedAt: new Date() },
        });
      }
      await tx.mediaAsset.create({
        data: {
          id: assetId,
          videoId,
          channelId: video.channelId,
          kind: "CAPTION",
          status: "PENDING",
          r2ObjectKey: key,
          mimeType: CAPTION_UPLOAD_MIME,
          sizeBytes: BigInt(input.sizeBytes),
        },
      });
      await tx.videoCaptionTrack.update({
        where: { id: trackId },
        data: {
          pendingMediaAssetId: assetId,
          pendingMakeDefault: input.default ?? track.isDefault,
        },
      });
    });
    if (oldPending) await this.storage.deleteObject(oldPending.r2ObjectKey).catch(() => undefined);
    return {
      trackId,
      uploadUrl: upload.url,
      expiresAt: upload.expiresAt,
      contentType: CAPTION_UPLOAD_MIME,
      maxBytes: CAPTION_FILE_MAX_BYTES,
    };
  }

  async finalize(accountId: string, videoId: string, trackId: string) {
    const video = await this.assertVideoEditor(accountId, videoId);
    const track = await this.track(videoId, trackId);
    if (!track.pendingMediaAssetId) {
      throw new CaptionError(
        "CAPTION_UPLOAD_NOT_PENDING",
        "This caption track has no upload waiting to be finalized.",
        409,
      );
    }
    const pending = await this.database.client.mediaAsset.findFirst({
      where: {
        id: track.pendingMediaAssetId,
        videoId,
        kind: "CAPTION",
        status: "PENDING",
        removedAt: null,
      },
    });
    if (!pending) {
      throw new CaptionError(
        "CAPTION_UPLOAD_NOT_FOUND",
        "The pending caption upload could not be found.",
        404,
      );
    }
    this.assertStorage();

    try {
      const metadata = await this.storage.headObject(pending.r2ObjectKey);
      const mime = metadata.contentType?.toLowerCase().split(";", 1)[0] ?? null;
      if (
        metadata.sizeBytes < 1 ||
        metadata.sizeBytes > CAPTION_FILE_MAX_BYTES ||
        metadata.sizeBytes !== Number(pending.sizeBytes)
      ) {
        throw new CaptionError(
          "CAPTION_FILE_SIZE_INVALID",
          "Uploaded caption size does not match the prepared upload.",
        );
      }
      if (mime !== CAPTION_UPLOAD_MIME) {
        throw new CaptionError(
          "CAPTION_MIME_INVALID",
          "Uploaded caption must use the text/vtt MIME type.",
        );
      }
      if (!this.storage.readObject) {
        throw new CaptionError(
          "CAPTION_STORAGE_UNAVAILABLE",
          "Caption validation storage is unavailable.",
          503,
        );
      }
      const bytes = await this.storage.readObject(pending.r2ObjectKey, CAPTION_FILE_MAX_BYTES);
      const parsed = validateWebVtt(bytes, video.durationMs);
      const oldAsset = track.mediaAssetId
        ? await this.database.client.mediaAsset.findUnique({ where: { id: track.mediaAssetId } })
        : null;
      const now = new Date();
      await this.database.client.$transaction(async (tx) => {
        if (track.pendingMakeDefault) {
          await tx.videoCaptionTrack.updateMany({
            where: { videoId, isDefault: true, id: { not: trackId } },
            data: { isDefault: false },
          });
        }
        await tx.mediaAsset.update({
          where: { id: pending.id },
          data: {
            status: "VALIDATED",
            sizeBytes: BigInt(metadata.sizeBytes),
            mimeType: CAPTION_UPLOAD_MIME,
            checksum: metadata.etag,
          },
        });
        await tx.videoCaptionTrack.update({
          where: { id: trackId },
          data: {
            mediaAssetId: pending.id,
            pendingMediaAssetId: null,
            pendingMakeDefault: false,
            isDefault: track.pendingMakeDefault ? true : track.isDefault,
            isEnabled: track.pendingMakeDefault ? true : track.isEnabled,
          },
        });
        if (oldAsset) {
          await tx.mediaAsset.update({
            where: { id: oldAsset.id },
            data: { status: "REMOVED", removedAt: now },
          });
        }
      });
      if (oldAsset) await this.storage.deleteObject(oldAsset.r2ObjectKey).catch(() => undefined);
      return { trackId, status: "READY" as const, cueCount: parsed.cueCount };
    } catch (error) {
      await this.rejectPending(trackId, pending.id, pending.r2ObjectKey);
      if (error instanceof CaptionError) throw error;
      if (error instanceof WebVttValidationError) {
        throw new CaptionError(error.code, error.message);
      }
      throw error;
    }
  }

  async patch(accountId: string, videoId: string, trackId: string, input: CaptionPatchInput) {
    await this.assertVideoEditor(accountId, videoId);
    const track = await this.track(videoId, trackId);
    if (!track.mediaAssetId) {
      throw new CaptionError(
        "CAPTION_NOT_READY",
        "Finish uploading this caption track before changing it.",
        409,
      );
    }
    return this.database.client.$transaction(async (tx) => {
      const explicitlyDisable = input.enabled === false;
      const nextDefault = explicitlyDisable ? false : (input.default ?? track.isDefault);
      const nextEnabled = nextDefault ? true : (input.enabled ?? track.isEnabled);
      if (nextDefault) {
        await tx.videoCaptionTrack.updateMany({
          where: { videoId, isDefault: true, id: { not: trackId } },
          data: { isDefault: false },
        });
      }
      const updated = await tx.videoCaptionTrack.update({
        where: { id: trackId },
        data: {
          ...(input.languageCode !== undefined ? { languageCode: input.languageCode } : {}),
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          isEnabled: nextEnabled,
          isDefault: nextDefault,
        },
      });
      return {
        id: updated.id,
        languageCode: updated.languageCode,
        label: updated.label,
        kind: updated.kind,
        default: updated.isDefault,
        enabled: updated.isEnabled,
      };
    });
  }

  async remove(accountId: string, videoId: string, trackId: string) {
    await this.assertVideoEditor(accountId, videoId);
    const track = await this.track(videoId, trackId);
    const ids = [track.mediaAssetId, track.pendingMediaAssetId].filter((id): id is string =>
      Boolean(id),
    );
    const assets = ids.length
      ? await this.database.client.mediaAsset.findMany({ where: { id: { in: ids } } })
      : [];
    await this.database.client.$transaction(async (tx) => {
      await tx.videoCaptionTrack.delete({ where: { id: trackId } });
      if (ids.length) {
        await tx.mediaAsset.updateMany({
          where: { id: { in: ids } },
          data: { status: "REMOVED", removedAt: new Date() },
        });
      }
    });
    await Promise.all(
      assets.map((asset) => this.storage.deleteObject(asset.r2ObjectKey).catch(() => undefined)),
    );
    return { removed: true, trackId };
  }

  private async assertVideoEditor(accountId: string, videoId: string) {
    const video = await this.database.client.video.findUnique({
      where: { id: videoId },
      select: { id: true, channelId: true, durationMs: true, status: true },
    });
    if (!video) throw new CaptionError("VIDEO_NOT_FOUND", "This video could not be found.", 404);
    const membership = await this.database.client.channelMember.findFirst({
      where: {
        accountId,
        channelId: video.channelId,
        role: { in: ["OWNER", "ADMIN", "EDITOR"] },
      },
      select: { id: true },
    });
    if (!membership) {
      throw new CaptionError(
        "VIDEO_EDITOR_REQUIRED",
        "You do not have permission to manage captions for this video.",
        403,
      );
    }
    if (video.status === "REMOVED") {
      throw new CaptionError(
        "VIDEO_REMOVED",
        "Captions cannot be changed on a removed video.",
        409,
      );
    }
    return video;
  }

  private async track(videoId: string, trackId: string) {
    const track = await this.database.client.videoCaptionTrack.findFirst({
      where: { id: trackId, videoId },
    });
    if (!track)
      throw new CaptionError(
        "CAPTION_TRACK_NOT_FOUND",
        "This caption track could not be found.",
        404,
      );
    return track;
  }

  private objectKey(videoId: string, assetId: string): string {
    return `${CAPTION_PREFIX}/${videoId}/${assetId}/track.vtt`;
  }

  private assertStorage() {
    if (!this.storage.available) {
      throw new CaptionError(
        "CAPTION_STORAGE_UNAVAILABLE",
        "Caption uploads are unavailable until media storage is configured.",
        503,
      );
    }
  }

  private async rejectPending(trackId: string, assetId: string, key: string) {
    await this.database.client.$transaction(async (tx) => {
      const track = await tx.videoCaptionTrack.findUnique({ where: { id: trackId } });
      if (!track || track.pendingMediaAssetId !== assetId) return;
      await tx.videoCaptionTrack.update({
        where: { id: trackId },
        data: { pendingMediaAssetId: null, pendingMakeDefault: false },
      });
      await tx.mediaAsset.updateMany({
        where: { id: assetId },
        data: { status: "REJECTED", removedAt: new Date() },
      });
      if (!track.mediaAssetId) await tx.videoCaptionTrack.delete({ where: { id: trackId } });
    });
    await this.storage.deleteObject(key).catch(() => undefined);
  }
}
