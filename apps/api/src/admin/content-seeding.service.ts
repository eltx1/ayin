import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { MEDIA_STORAGE_ADAPTER, type MediaStorageAdapter } from "../media/media-storage.adapter.js";
import { MediaUploadService } from "../media/media-upload.service.js";
import { AdminAuditLogService } from "./admin-audit-log.service.js";
import { adminBadRequest } from "./admin.errors.js";

export type SeedContentType = "CREATOR_VIDEO" | "MOVIE" | "DOCUMENTARY";
export type SeedRightsBasis = "OWNED" | "LICENSED" | "AUTHORIZED" | "PUBLIC_DOMAIN" | "OTHER";

export interface ContentSeedInputItem {
  title: string;
  description?: string | null;
  contentType: SeedContentType;
  visibility?: "PUBLIC" | "UNLISTED" | "PRIVATE";
  rightsBasis: SeedRightsBasis;
  sourceNotes: string;
}

function slugBase(title: string): string {
  const normalized = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
  return normalized || "content";
}

@Injectable()
export class ContentSeedingService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MediaUploadService) private readonly uploads: MediaUploadService,
    @Inject(MEDIA_STORAGE_ADAPTER) private readonly storage: MediaStorageAdapter,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}

  async createBatch(
    actorAccountId: string,
    input: { channelId: string; sourceLabel: string; items: ContentSeedInputItem[] },
  ) {
    const channel = await this.database.client.channel.findUnique({
      where: { id: input.channelId },
      select: { id: true, isPlatformOwned: true, status: true },
    });
    if (!channel || channel.status === "REMOVED") {
      throw adminBadRequest("SEED_CHANNEL_NOT_FOUND", "The target channel does not exist.");
    }
    if (!channel.isPlatformOwned) {
      throw adminBadRequest(
        "SEED_CHANNEL_NOT_PLATFORM_OWNED",
        "Content seeding is restricted to channels explicitly marked as AYIN-owned.",
      );
    }

    return this.database.client.$transaction(async (tx) => {
      const batch = await tx.contentSeedBatch.create({
        data: {
          createdByAccountId: actorAccountId,
          channelId: input.channelId,
          sourceLabel: input.sourceLabel,
          status: "READY",
        },
      });

      const createdItems = [];
      for (const item of input.items) {
        const videoId = randomUUID();
        const video = await tx.video.create({
          data: {
            id: videoId,
            channelId: input.channelId,
            slug: `${slugBase(item.title)}-${videoId.slice(0, 8)}`,
            title: item.title,
            description: item.description ?? null,
            contentType: item.contentType,
            visibility: item.visibility ?? "PUBLIC",
            status: "DRAFT",
          },
          select: { id: true, slug: true, title: true, contentType: true, status: true },
        });
        await tx.contentRightsDeclaration.create({
          data: {
            videoId,
            declaredByAccountId: actorAccountId,
            version: 1,
            basis: item.rightsBasis,
            status: "CONFIRMED",
            statement: `Admin catalog seed source: ${item.sourceNotes}`,
          },
        });
        const seedItem = await tx.contentSeedItem.create({
          data: {
            batchId: batch.id,
            videoId,
            sourceNotes: item.sourceNotes,
            rightsBasis: item.rightsBasis,
            status: "DRAFT",
          },
          select: { id: true, status: true, sourceNotes: true, rightsBasis: true },
        });
        createdItems.push({ ...seedItem, video });
      }

      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "CONTENT_SEED_BATCH_CREATED",
        entityType: "ContentSeedBatch",
        entityId: batch.id,
        metadata: { channelId: input.channelId, itemCount: input.items.length },
      });
      return { batch, items: createdItems };
    });
  }

  async listBatches(take = 50) {
    return this.database.client.contentSeedBatch.findMany({
      orderBy: { createdAt: "desc" },
      take,
      include: {
        channel: { select: { id: true, handle: true, name: true, isPlatformOwned: true } },
        items: {
          orderBy: { createdAt: "asc" },
          include: {
            video: {
              select: { id: true, slug: true, title: true, contentType: true, status: true },
            },
          },
        },
      },
    });
  }

  async createUploadSession(
    actorAccountId: string,
    itemId: string,
    input: { sizeBytes: number; mimeType: string; durationMs?: number | null },
  ) {
    const item = await this.item(itemId);
    if (item.batch.status === "ROLLED_BACK" || item.status === "PUBLISHED") {
      throw adminBadRequest(
        "SEED_ITEM_NOT_UPLOADABLE",
        "This seed item cannot accept a new upload.",
      );
    }
    const uploadSession = await this.uploads.createSession(
      actorAccountId,
      { channelId: item.batch.channelId, sizeBytes: input.sizeBytes, mimeType: input.mimeType },
      { adminOverride: true },
    );
    await this.database.client.$transaction([
      this.database.client.mediaAsset.update({
        where: { id: uploadSession.assetId },
        data: { videoId: item.videoId },
      }),
      this.database.client.video.update({
        where: { id: item.videoId },
        data: { status: "UPLOADING", durationMs: input.durationMs ?? undefined },
      }),
      this.database.client.contentSeedItem.update({
        where: { id: itemId },
        data: { status: "UPLOADING", error: null },
      }),
    ]);
    return uploadSession;
  }

  async confirmUpload(itemId: string) {
    const item = await this.item(itemId);
    const source = await this.database.client.mediaAsset.findFirst({
      where: {
        videoId: item.videoId,
        kind: "SOURCE_VIDEO",
        status: { in: ["UPLOADED", "VALIDATED"] },
        removedAt: null,
      },
      select: { id: true },
    });
    if (!source) {
      throw adminBadRequest(
        "SEED_UPLOAD_NOT_COMPLETE",
        "The MP4 upload has not completed successfully.",
      );
    }
    await this.database.client.$transaction([
      this.database.client.video.update({ where: { id: item.videoId }, data: { status: "DRAFT" } }),
      this.database.client.contentSeedItem.update({
        where: { id: itemId },
        data: { status: "READY" },
      }),
    ]);
    return { itemId, videoId: item.videoId, status: "READY" as const };
  }

  async publish(actorAccountId: string, itemId: string) {
    const item = await this.item(itemId);
    if (item.batch.status === "ROLLED_BACK") {
      throw adminBadRequest("SEED_BATCH_ROLLED_BACK", "This content seed batch was rolled back.");
    }
    const source = await this.database.client.mediaAsset.findFirst({
      where: {
        videoId: item.videoId,
        kind: "SOURCE_VIDEO",
        status: { in: ["UPLOADED", "VALIDATED"] },
        removedAt: null,
      },
      select: { id: true },
    });
    if (!source) {
      throw adminBadRequest("SEED_UPLOAD_REQUIRED", "Upload and verify an MP4 before publishing.");
    }

    return this.database.client.$transaction(async (tx) => {
      const uploads = await tx.playlist.findUnique({
        where: { channelId_systemKey: { channelId: item.batch.channelId, systemKey: "UPLOADS" } },
        select: { id: true },
      });
      if (!uploads)
        throw adminBadRequest(
          "UPLOADS_PLAYLIST_MISSING",
          "The AYIN-owned channel has no Uploads playlist.",
        );
      const existing = await tx.playlistItem.findUnique({
        where: { playlistId_videoId: { playlistId: uploads.id, videoId: item.videoId } },
        select: { id: true },
      });
      if (!existing) {
        const last = await tx.playlistItem.aggregate({
          where: { playlistId: uploads.id },
          _max: { position: true },
        });
        await tx.playlistItem.create({
          data: {
            playlistId: uploads.id,
            videoId: item.videoId,
            position: (last._max.position ?? -1) + 1,
          },
        });
      }
      const channel = await tx.channel.findUniqueOrThrow({
        where: { id: item.batch.channelId },
        select: { primaryTvChannelId: true },
      });
      if (channel.primaryTvChannelId) {
        const tv = await tx.creatorTvChannel.findUnique({
          where: { id: channel.primaryTvChannelId },
          select: { sourcePlaylistId: true },
        });
        if (tv && !tv.sourcePlaylistId) {
          await tx.creatorTvChannel.update({
            where: { id: channel.primaryTvChannelId },
            data: { sourcePlaylistId: uploads.id },
          });
        }
      }
      const video = await tx.video.update({
        where: { id: item.videoId },
        data: { status: "PUBLISHED", publishedAt: new Date() },
        select: {
          id: true,
          slug: true,
          title: true,
          contentType: true,
          status: true,
          publishedAt: true,
        },
      });
      await tx.contentSeedItem.update({ where: { id: itemId }, data: { status: "PUBLISHED" } });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "CONTENT_SEED_ITEM_PUBLISHED",
        entityType: "Video",
        entityId: item.videoId,
        metadata: { seedItemId: itemId, batchId: item.batchId },
      });
      return video;
    });
  }

  async rollback(actorAccountId: string, batchId: string) {
    const batch = await this.database.client.contentSeedBatch.findUnique({
      where: { id: batchId },
      include: { items: { include: { video: { include: { mediaAssets: true } } } } },
    });
    if (!batch)
      throw adminBadRequest("SEED_BATCH_NOT_FOUND", "The content seed batch does not exist.");
    if (batch.status === "ROLLED_BACK") return { batchId, status: "ROLLED_BACK" as const };
    if (
      batch.items.some((item) => item.status === "PUBLISHED" || item.video.status === "PUBLISHED")
    ) {
      throw adminBadRequest(
        "SEED_ROLLBACK_PUBLISHED",
        "Published seed content must be unpublished explicitly before rollback.",
      );
    }
    for (const item of batch.items) {
      for (const asset of item.video.mediaAssets) {
        await this.storage.deleteObject(asset.r2ObjectKey).catch(() => undefined);
      }
    }
    await this.database.client.$transaction(async (tx) => {
      const now = new Date();
      await tx.mediaAsset.updateMany({
        where: { videoId: { in: batch.items.map((item) => item.videoId) }, removedAt: null },
        data: { status: "REMOVED", removedAt: now },
      });
      await tx.video.updateMany({
        where: { id: { in: batch.items.map((item) => item.videoId) } },
        data: { status: "REMOVED", removedAt: now },
      });
      await tx.contentSeedItem.updateMany({ where: { batchId }, data: { status: "ROLLED_BACK" } });
      await tx.contentSeedBatch.update({
        where: { id: batchId },
        data: { status: "ROLLED_BACK", rolledBackAt: now },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "CONTENT_SEED_BATCH_ROLLED_BACK",
        entityType: "ContentSeedBatch",
        entityId: batchId,
        metadata: { itemCount: batch.items.length },
      });
    });
    return { batchId, status: "ROLLED_BACK" as const };
  }

  private async item(itemId: string) {
    const item = await this.database.client.contentSeedItem.findUnique({
      where: { id: itemId },
      include: { batch: true },
    });
    if (!item)
      throw adminBadRequest("SEED_ITEM_NOT_FOUND", "The content seed item does not exist.");
    return item;
  }
}
