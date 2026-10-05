import { randomUUID } from "node:crypto";

import { Prisma, type MediaAsset } from "@ayin/db";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { unauthorized } from "../auth/auth.errors.js";
import { lockMediaGeneration } from "../media/media-generation-safety.js";
import {
  observeChannelMediaOwners,
  lockChannelMediaAccounts,
  assertChannelMediaOwners,
} from "../media/media-privacy-account-fence.js";

import { ConflictException, Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { MEDIA_STORAGE_ADAPTER, type MediaStorageAdapter } from "../media/media-storage.adapter.js";
import {
  CAPTION_FILE_MAX_BYTES,
  CAPTION_UPLOAD_MIME,
  validateWebVtt,
  WebVttValidationError,
} from "./caption.validation.js";
import type {
  captionPatchSchema,
  captionReplacementSchema,
  captionUploadSchema,
} from "./caption.validation.js";
import type { z } from "zod";

type CaptionActor = AuthenticatedRequest["ayinAuth"];
type CaptionVideo = { id: string; channelId: string; durationMs: number | null };

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

  async list(actor: CaptionActor, videoId: string) {
    return this.withVideo(actor, videoId, async (tx) => {
      const tracks = await tx.videoCaptionTrack.findMany({
        where: { videoId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const assetIds = tracks.flatMap((track) =>
        [track.mediaAssetId, track.pendingMediaAssetId].filter((id): id is string => Boolean(id)),
      );
      const assets = assetIds.length
        ? await tx.mediaAsset.findMany({
            where: { id: { in: assetIds } },
            select: { id: true, status: true, removedAt: true, sizeBytes: true, mimeType: true },
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
            status: active?.status === "VALIDATED" && !active.removedAt ? "READY" : "PENDING",
            sizeBytes: active ? Number(active.sizeBytes) : null,
            replacing: Boolean(track.pendingMediaAssetId),
            createdAt: track.createdAt,
            updatedAt: track.updatedAt,
          };
        }),
      };
    });
  }

  async prepareCreate(actor: CaptionActor, videoId: string, input: CaptionUploadInput) {
    const observed = await this.withVideo(actor, videoId, async (tx, video) => {
      this.assertStorage();
      await this.assertUniqueIdentity(tx, videoId, input.languageCode, input.kind);
      return video;
    });
    const assetId = randomUUID(),
      trackId = randomUUID();
    const key = this.objectKey(videoId, assetId);
    const upload = await this.storageOperation(() =>
      this.storage.authorizeSinglePut({
        key,
        contentType: CAPTION_UPLOAD_MIME,
        expiresInSeconds: CAPTION_UPLOAD_TTL_SECONDS,
      }),
    );
    await this.withVideo(actor, videoId, async (tx, video) => {
      if (video.channelId !== observed.channelId) this.changedUpload();
      await this.assertUniqueIdentity(tx, videoId, input.languageCode, input.kind);
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
      await tx.videoCaptionTrack.create({
        data: {
          id: trackId,
          videoId,
          pendingMediaAssetId: assetId,
          languageCode: input.languageCode,
          label: input.label ?? input.languageCode,
          kind: input.kind,
          isEnabled: true,
          isDefault: false,
          pendingMakeDefault: input.default,
        },
      });
    });
    return this.preparedResponse(trackId, upload);
  }

  async prepareReplacement(
    actor: CaptionActor,
    videoId: string,
    trackId: string,
    input: CaptionReplacementInput,
  ) {
    const observed = await this.withVideo(actor, videoId, async (tx, video) => {
      this.assertStorage();
      return { video, track: await this.track(tx, videoId, trackId) };
    });
    const assetId = randomUUID(),
      key = this.objectKey(videoId, assetId);
    const upload = await this.storageOperation(() =>
      this.storage.authorizeSinglePut({
        key,
        contentType: CAPTION_UPLOAD_MIME,
        expiresInSeconds: CAPTION_UPLOAD_TTL_SECONDS,
      }),
    );
    const oldPending = await this.withVideo(actor, videoId, async (tx, video) => {
      const track = await this.track(tx, videoId, trackId);
      if (
        video.channelId !== observed.video.channelId ||
        track.pendingMediaAssetId !== observed.track.pendingMediaAssetId ||
        track.mediaAssetId !== observed.track.mediaAssetId
      )
        this.changedUpload();
      const oldPending = track.pendingMediaAssetId
        ? await this.pendingAsset(tx, video, track.pendingMediaAssetId)
        : null;
      if (oldPending)
        await tx.mediaAsset.update({
          where: { id: oldPending.id },
          data: { status: "REMOVED", removedAt: new Date() },
        });
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
      return oldPending;
    });
    if (oldPending) await this.deleteRetired(oldPending.r2ObjectKey);
    return this.preparedResponse(trackId, upload);
  }

  async finalize(actor: CaptionActor, videoId: string, trackId: string) {
    const pending = await this.withVideo(actor, videoId, async (tx, video) => {
      const track = await this.track(tx, videoId, trackId);
      if (!track.pendingMediaAssetId)
        throw new CaptionError(
          "CAPTION_UPLOAD_NOT_PENDING",
          "This caption track has no upload waiting to be finalized.",
          409,
        );
      this.assertStorage();
      if (!this.storage.readObject) throw this.storageUnavailable();
      return this.pendingAsset(tx, video, track.pendingMediaAssetId);
    });
    const metadata = await this.storageOperation(() =>
      this.storage.headObject(pending.r2ObjectKey),
    );
    // Never carry a database lock over storage I/O. A fresh short transaction
    // fences the next provider call and any validation-only rejection.
    const metadataError = await this.withVideo(actor, videoId, async (tx, video) => {
      const track = await this.currentPending(tx, video, trackId, pending);
      const error = this.metadataError(metadata, pending);
      if (error) await this.rejectPending(tx, track, pending.id);
      return error;
    });
    if (metadataError) {
      await this.deleteRetired(pending.r2ObjectKey);
      throw metadataError;
    }
    const bytes = await this.storageOperation(() =>
      this.storage.readObject!(pending.r2ObjectKey, CAPTION_FILE_MAX_BYTES),
    );
    const outcome = await this.withVideo(actor, videoId, async (tx, video) => {
      const track = await this.currentPending(tx, video, trackId, pending);
      // A mismatched/truncated read is ambiguous provider evidence, not proof
      // that the creator uploaded invalid bytes. Preserve it for retry.
      if (bytes.byteLength !== metadata.sizeBytes) throw this.storageUnavailable();
      let parsed;
      try {
        parsed = validateWebVtt(bytes, video.durationMs);
      } catch (error) {
        if (!(error instanceof WebVttValidationError)) throw error;
        await this.rejectPending(tx, track, pending.id);
        return { error: new CaptionError(error.code, error.message), oldKey: pending.r2ObjectKey };
      }
      const oldAsset = track.mediaAssetId
        ? await this.captionAsset(tx, video, track.mediaAssetId)
        : null;
      if (track.pendingMakeDefault) await this.selectDefault(tx, videoId, trackId);
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
      if (oldAsset)
        await tx.mediaAsset.update({
          where: { id: oldAsset.id },
          data: { status: "REMOVED", removedAt: new Date() },
        });
      return {
        result: { trackId, status: "READY" as const, cueCount: parsed.cueCount },
        oldKey: oldAsset?.r2ObjectKey,
      };
    });
    if (outcome.oldKey) await this.deleteRetired(outcome.oldKey);
    if (outcome.error) throw outcome.error;
    return outcome.result;
  }

  async patch(actor: CaptionActor, videoId: string, trackId: string, input: CaptionPatchInput) {
    return this.withVideo(actor, videoId, async (tx, video) => {
      const track = await this.track(tx, videoId, trackId);
      if (!track.mediaAssetId)
        throw new CaptionError(
          "CAPTION_NOT_READY",
          "Finish uploading this caption track before changing it.",
          409,
        );
      const active = await this.captionAsset(tx, video, track.mediaAssetId);
      if (active.status !== "VALIDATED" || active.removedAt) this.changedUpload();
      const nextLanguageCode = input.languageCode ?? track.languageCode;
      const nextKind = input.kind ?? track.kind;
      await this.assertUniqueIdentity(tx, videoId, nextLanguageCode, nextKind, trackId);
      const nextDefault = input.enabled === false ? false : (input.default ?? track.isDefault);
      const nextEnabled = nextDefault ? true : (input.enabled ?? track.isEnabled);
      if (input.default === true && input.enabled !== false)
        await this.selectDefault(tx, videoId, trackId);
      const updated = await tx.videoCaptionTrack.update({
        where: { id: trackId },
        data: {
          ...(input.languageCode !== undefined ? { languageCode: input.languageCode } : {}),
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.enabled === false || input.default !== undefined
            ? { pendingMakeDefault: input.enabled === false ? false : (input.default ?? false) }
            : {}),
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

  async remove(actor: CaptionActor, videoId: string, trackId: string) {
    const assets = await this.withVideo(actor, videoId, async (tx, video) => {
      const track = await this.track(tx, videoId, trackId);
      const ids = [track.mediaAssetId, track.pendingMediaAssetId].filter((id): id is string =>
        Boolean(id),
      );
      const assets = await Promise.all(ids.map((id) => this.captionAsset(tx, video, id)));
      await tx.videoCaptionTrack.delete({ where: { id: trackId } });
      if (ids.length)
        await tx.mediaAsset.updateMany({
          where: { id: { in: ids } },
          data: { status: "REMOVED", removedAt: new Date() },
        });
      return assets;
    });
    await Promise.all(assets.map((asset) => this.deleteRetired(asset.r2ObjectKey)));
    return { removed: true, trackId };
  }

  private async withVideo<T>(
    actor: CaptionActor,
    videoId: string,
    operation: (tx: Prisma.TransactionClient, video: CaptionVideo) => Promise<T>,
  ): Promise<T> {
    return this.database.client.$transaction(async (tx) => {
      // Observe server-owned scope before taking any Account lock. Privacy
      // locks each owner before its media snapshot, so acquire the complete
      // actor + owner set canonically instead of locking the actor first.
      const observed = await tx.video.findUnique({
        where: { id: videoId },
        select: { channelId: true },
      });
      if (!observed)
        throw new CaptionError("VIDEO_NOT_FOUND", "This video could not be found.", 404);
      const ownerIds = await observeChannelMediaOwners(tx, observed.channelId);
      await lockChannelMediaAccounts(tx, actor.accountId, ownerIds);
      await tx.$queryRaw`SELECT id FROM "AccountSession" WHERE id = ${actor.sessionId}::uuid FOR SHARE /* ayin-caption-session-lock */`;
      await this.assertActor(tx, actor);
      try {
        await assertChannelMediaOwners(tx, observed.channelId, ownerIds);
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        // Preserve the caption role-loss contract when the removed owner was
        // the actor; independent ownership drift remains a typed conflict.
        await this.assertEditor(tx, actor, observed.channelId);
        this.changedUpload();
      }
      await this.assertEditor(tx, actor, observed.channelId);
      // Generation -> sorted caption assets -> video -> channel follows the
      // shared privacy prelock and protects track identity/default transitions.
      await lockMediaGeneration(tx, videoId);
      const tracks = await tx.videoCaptionTrack.findMany({
        where: { videoId },
        select: { mediaAssetId: true, pendingMediaAssetId: true },
      });
      const assetIds = [
        ...new Set(
          tracks
            .flatMap((track) => [track.mediaAssetId, track.pendingMediaAssetId])
            .filter((id): id is string => Boolean(id)),
        ),
      ].sort();
      if (assetIds.length)
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "MediaAsset" WHERE id IN (${Prisma.join(assetIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE /* ayin-caption-asset-lock */`,
        );
      const [video] = await tx.$queryRaw<
        Array<CaptionVideo & { status: string; removedAt: Date | null }>
      >(
        Prisma.sql`SELECT id, "channelId", "durationMs", status, "removedAt" FROM "Video" WHERE id = ${videoId}::uuid FOR NO KEY UPDATE /* ayin-caption-video-lock */`,
      );
      if (!video) throw new CaptionError("VIDEO_NOT_FOUND", "This video could not be found.", 404);
      if (video.channelId !== observed.channelId) this.changedUpload();
      if (video.status === "REMOVED" || video.removedAt)
        throw new CaptionError(
          "VIDEO_REMOVED",
          "Captions cannot be changed on a removed video.",
          409,
        );
      const [channel] = await tx.$queryRaw<Array<{ status: string; removedAt: Date | null }>>(
        Prisma.sql`SELECT "status", "removedAt" FROM "Channel" WHERE id = ${observed.channelId}::uuid FOR SHARE /* ayin-caption-channel-lock */`,
      );
      if (!channel || channel.status === "REMOVED" || channel.removedAt)
        throw new CaptionError(
          "CHANNEL_REMOVED",
          "Captions cannot be changed on a removed channel.",
          409,
        );
      // The wall-clock expiry can pass while waiting on any of the row locks.
      await this.assertActor(tx, actor);
      return operation(tx, video);
    });
  }

  private async assertEditor(tx: Prisma.TransactionClient, actor: CaptionActor, channelId: string) {
    const members = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM "ChannelMember" WHERE "accountId" = ${actor.accountId}::uuid
          AND "channelId" = ${channelId}::uuid AND role IN ('OWNER', 'ADMIN', 'EDITOR') FOR SHARE /* ayin-caption-member-lock */`,
    );
    if (!members.length)
      throw new CaptionError(
        "VIDEO_EDITOR_REQUIRED",
        "You do not have permission to manage captions for this video.",
        403,
      );
  }

  private async assertActor(tx: Prisma.TransactionClient, actor: CaptionActor) {
    const current = await tx.account.findUnique({
      where: { id: actor.accountId },
      select: { status: true, authVersion: true },
    });
    const sessions = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM "AccountSession" WHERE id = ${actor.sessionId}::uuid
        AND "accountId" = ${actor.accountId}::uuid AND "authVersion" = ${actor.authVersion}
        AND "revokedAt" IS NULL AND "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')`,
    );
    if (
      !current ||
      current.status !== "ACTIVE" ||
      current.authVersion !== actor.authVersion ||
      !sessions.length
    )
      throw unauthorized();
  }

  private async track(tx: Prisma.TransactionClient, videoId: string, trackId: string) {
    const track = await tx.videoCaptionTrack.findFirst({ where: { id: trackId, videoId } });
    if (!track)
      throw new CaptionError(
        "CAPTION_TRACK_NOT_FOUND",
        "This caption track could not be found.",
        404,
      );
    return track;
  }

  private async captionAsset(tx: Prisma.TransactionClient, video: CaptionVideo, assetId: string) {
    const asset = await tx.mediaAsset.findFirst({
      where: { id: assetId, videoId: video.id, channelId: video.channelId, kind: "CAPTION" },
    });
    if (!asset)
      throw new CaptionError(
        "CAPTION_UPLOAD_NOT_FOUND",
        "The caption upload could not be found.",
        404,
      );
    return asset;
  }

  private async pendingAsset(tx: Prisma.TransactionClient, video: CaptionVideo, assetId: string) {
    const asset = await this.captionAsset(tx, video, assetId);
    if (asset.status !== "PENDING" || asset.removedAt) this.changedUpload();
    return asset;
  }

  private async currentPending(
    tx: Prisma.TransactionClient,
    video: CaptionVideo,
    trackId: string,
    expected: MediaAsset,
  ) {
    const track = await this.track(tx, video.id, trackId);
    if (track.pendingMediaAssetId !== expected.id) this.changedUpload();
    const pending = await this.pendingAsset(tx, video, expected.id);
    if (
      pending.r2ObjectKey !== expected.r2ObjectKey ||
      pending.sizeBytes !== expected.sizeBytes ||
      pending.mimeType !== expected.mimeType
    )
      this.changedUpload();
    return track;
  }

  private async selectDefault(tx: Prisma.TransactionClient, videoId: string, trackId: string) {
    // A new explicit selection supersedes older pending selections too. Do not
    // call this for unrelated edits to an already-default track: those must not
    // cancel another track's intentional pending default.
    await tx.videoCaptionTrack.updateMany({
      where: {
        videoId,
        id: { not: trackId },
        OR: [{ isDefault: true }, { pendingMakeDefault: true }],
      },
      data: { isDefault: false, pendingMakeDefault: false },
    });
  }

  private async assertUniqueIdentity(
    tx: Prisma.TransactionClient,
    videoId: string,
    languageCode: string,
    kind: CaptionUploadInput["kind"],
    excludeTrackId?: string,
  ) {
    const existing = await tx.videoCaptionTrack.findFirst({
      where: {
        videoId,
        languageCode,
        kind,
        ...(excludeTrackId ? { id: { not: excludeTrackId } } : {}),
      },
      select: { id: true },
    });
    if (existing)
      throw new CaptionError(
        "CAPTION_TRACK_DUPLICATE",
        "This video already has a caption track with the same language and type.",
        409,
      );
  }

  private metadataError(
    metadata: { sizeBytes: number; contentType: string | null },
    pending: MediaAsset,
  ) {
    if (
      metadata.sizeBytes < 1 ||
      metadata.sizeBytes > CAPTION_FILE_MAX_BYTES ||
      metadata.sizeBytes !== Number(pending.sizeBytes)
    )
      return new CaptionError(
        "CAPTION_FILE_SIZE_INVALID",
        "Uploaded caption size does not match the prepared upload.",
      );
    if (metadata.contentType?.toLowerCase().split(";", 1)[0] !== CAPTION_UPLOAD_MIME)
      return new CaptionError(
        "CAPTION_MIME_INVALID",
        "Uploaded caption must use the text/vtt MIME type.",
      );
    return null;
  }

  private async rejectPending(
    tx: Prisma.TransactionClient,
    track: { id: string; mediaAssetId: string | null },
    assetId: string,
  ) {
    await tx.videoCaptionTrack.update({
      where: { id: track.id },
      data: { pendingMediaAssetId: null, pendingMakeDefault: false },
    });
    await tx.mediaAsset.update({
      where: { id: assetId },
      data: { status: "REJECTED", removedAt: new Date() },
    });
    if (!track.mediaAssetId) await tx.videoCaptionTrack.delete({ where: { id: track.id } });
  }

  private objectKey(videoId: string, assetId: string) {
    return `${CAPTION_PREFIX}/${videoId}/${assetId}/track.vtt`;
  }
  private preparedResponse(trackId: string, upload: { url: string; expiresAt: Date }) {
    return {
      trackId,
      uploadUrl: upload.url,
      expiresAt: upload.expiresAt,
      contentType: CAPTION_UPLOAD_MIME,
      maxBytes: CAPTION_FILE_MAX_BYTES,
    };
  }
  private assertStorage() {
    if (!this.storage.available) throw this.storageUnavailable();
  }
  private storageUnavailable() {
    return new CaptionError(
      "CAPTION_STORAGE_UNAVAILABLE",
      "Caption storage is temporarily unavailable. Try again.",
      503,
    );
  }
  private changedUpload(): never {
    throw new CaptionError(
      "CAPTION_UPLOAD_STATE_CHANGED",
      "This caption upload changed. Reload the caption tracks before trying again.",
      409,
    );
  }
  private async storageOperation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw this.storageUnavailable();
    }
  }
  private async deleteRetired(key: string) {
    await this.storage.deleteObject(key).catch(() => undefined);
  }
}
