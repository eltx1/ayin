import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import {
  MEDIA_STORAGE_ADAPTER,
  MEDIA_STORAGE_CONFIG,
  type MediaStorageAdapter,
  MediaStorageUnavailableError,
} from "../media/media-storage.adapter.js";
import type { MediaStorageConfig } from "../media/media-storage.config.js";
import { MediaUploadService } from "../media/media-upload.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";

const RIGHTS_DECLARATION_VERSION = 1;
const RIGHTS_STATEMENT =
  "I confirm that I own or have the rights and permissions required to publish this video on AYIN.";
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;

export class QuickUploadError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "QuickUploadError";
  }
}

export interface DraftDetailsInput {
  title?: string;
  description?: string | null;
  visibility?: "PUBLIC" | "UNLISTED" | "PRIVATE";
  commentsEnabled?: boolean;
  scheduledPublishAt?: Date | null;
  videoForm?: "LONG_FORM" | "CLIP";
}

export interface CreateQuickDraftInput {
  channelId: string;
  title: string;
  sizeBytes: number;
  mimeType: string;
  durationMs?: number | null;
  videoForm?: "LONG_FORM" | "CLIP";
}

function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function slugBase(title: string): string {
  const normalized = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
  return normalized || "video";
}

@Injectable()
export class QuickUploadService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MediaUploadService) private readonly mediaUploads: MediaUploadService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
    @Inject(MEDIA_STORAGE_ADAPTER) private readonly storage: MediaStorageAdapter,
    @Inject(MEDIA_STORAGE_CONFIG) private readonly storageConfig: MediaStorageConfig,
  ) {}

  async createDraft(accountId: string, input: CreateQuickDraftInput) {
    const title = normalizeTitle(input.title);
    if (!title) {
      throw new QuickUploadError("TITLE_REQUIRED", "Add a title before starting this upload.");
    }
    if (title.length > 200) {
      throw new QuickUploadError("TITLE_TOO_LONG", "Keep the video title under 200 characters.");
    }
    await this.assertOwner(accountId, input.channelId);
    const videoForm = input.videoForm ?? "LONG_FORM";
    if (videoForm === "CLIP") {
      const clipsEnabled = (await this.settings.get("clipsEnabled")) as boolean;
      const clipsMaxDurationMs = (await this.settings.get("clipsMaxDurationMs")) as number;
      if (!clipsEnabled)
        throw new QuickUploadError(
          "CLIPS_DISABLED",
          "AYIN Clips uploads are currently disabled.",
          409,
        );
      if (input.durationMs && input.durationMs > clipsMaxDurationMs) {
        throw new QuickUploadError(
          "CLIP_TOO_LONG",
          `Clips must be ${Math.floor(clipsMaxDurationMs / 1000)} seconds or shorter.`,
        );
      }
    }

    const channelSettings = await this.database.client.channelSettings.findUnique({
      where: { channelId: input.channelId },
      select: { defaultCommentsEnabled: true, defaultVideoVisibility: true },
    });
    const videoId = randomUUID();
    const slug = `${slugBase(title)}-${videoId.slice(0, 8)}`;
    const video = await this.database.client.video.create({
      data: {
        id: videoId,
        channelId: input.channelId,
        slug,
        title,
        status: "DRAFT",
        visibility: channelSettings?.defaultVideoVisibility ?? "PUBLIC",
        commentsEnabled: channelSettings?.defaultCommentsEnabled ?? true,
        videoForm,
        durationMs:
          input.durationMs && Number.isSafeInteger(input.durationMs) && input.durationMs > 0
            ? input.durationMs
            : null,
      },
      select: {
        id: true,
        channelId: true,
        slug: true,
        title: true,
        status: true,
        visibility: true,
        commentsEnabled: true,
        durationMs: true,
        videoForm: true,
      },
    });

    let uploadSession: Awaited<ReturnType<MediaUploadService["createSession"]>> | null = null;
    try {
      uploadSession = await this.mediaUploads.createSession(accountId, {
        channelId: input.channelId,
        sizeBytes: input.sizeBytes,
        mimeType: input.mimeType,
      });
      await this.database.client.$transaction([
        this.database.client.mediaAsset.update({
          where: { id: uploadSession.assetId },
          data: { videoId },
        }),
        this.database.client.video.update({
          where: { id: videoId },
          data: { status: "UPLOADING" },
        }),
      ]);
    } catch (error) {
      if (uploadSession?.sessionToken) {
        await this.mediaUploads.abort(accountId, uploadSession.sessionToken).catch(() => undefined);
      }
      await this.database.client.video.deleteMany({ where: { id: videoId, status: "DRAFT" } });
      throw error;
    }

    return { video: { ...video, status: "UPLOADING" as const }, uploadSession };
  }

  async confirmUpload(accountId: string, videoId: string) {
    const video = await this.ownedVideo(accountId, videoId);
    const [source, canonical, processing] = await Promise.all([
      this.database.client.mediaAsset.findFirst({
        where: {
          videoId,
          channelId: video.channelId,
          kind: "SOURCE_VIDEO",
          status: "UPLOADED",
          removedAt: null,
        },
        select: { id: true },
      }),
      this.database.client.mediaAsset.findFirst({
        where: {
          videoId,
          channelId: video.channelId,
          kind: "SOURCE_VIDEO",
          status: "VALIDATED",
          removedAt: null,
          mimeType: "video/mp4",
        },
        select: { id: true },
      }),
      this.database.client.mediaProcessingJob.findFirst({
        where: { videoId },
        orderBy: { generation: "desc" },
        select: { status: true, stage: true, progressPercent: true, errorCode: true },
      }),
    ]);
    if (!source && !canonical) {
      throw new QuickUploadError(
        "UPLOAD_NOT_COMPLETE",
        "The video is still uploading. Processing starts automatically after the upload reaches 100%.",
        409,
      );
    }
    if (!canonical) {
      return {
        videoId,
        status: "VALIDATING" as const,
        processing: processing ?? {
          status: "QUEUED" as const,
          stage: "QUEUED",
          progressPercent: 0,
          errorCode: null,
        },
      };
    }
    const updated = await this.database.client.video.update({
      where: { id: videoId },
      data: {
        status:
          video.status === "UPLOADING" || video.status === "VALIDATING" ? "DRAFT" : video.status,
      },
      select: { id: true, status: true },
    });
    return { videoId: updated.id, status: updated.status, processing };
  }

  async processingStatus(accountId: string, videoId: string) {
    const video = await this.ownedVideo(accountId, videoId);
    const [canonical, processing] = await Promise.all([
      this.database.client.mediaAsset.findFirst({
        where: {
          videoId,
          channelId: video.channelId,
          kind: "SOURCE_VIDEO",
          status: "VALIDATED",
          removedAt: null,
          mimeType: "video/mp4",
        },
        select: { id: true },
      }),
      this.database.client.mediaProcessingJob.findFirst({
        where: { videoId },
        orderBy: { generation: "desc" },
        select: {
          generation: true,
          status: true,
          stage: true,
          progressPercent: true,
          errorCode: true,
          errorMessage: true,
          attempt: true,
          completedAt: true,
        },
      }),
    ]);
    return {
      videoId,
      ready: Boolean(canonical),
      videoStatus: video.status,
      processing,
    };
  }

  async updateDetails(accountId: string, videoId: string, input: DraftDetailsInput) {
    const video = await this.ownedVideo(accountId, videoId);
    if (video.status === "REMOVED") {
      throw new QuickUploadError("VIDEO_REMOVED", "This video can no longer be edited.", 409);
    }
    const data = this.detailsData(input);
    return this.database.client.video.update({
      where: { id: videoId },
      data,
      select: {
        id: true,
        title: true,
        description: true,
        visibility: true,
        commentsEnabled: true,
        scheduledPublishAt: true,
        status: true,
      },
    });
  }

  async publish(
    accountId: string,
    videoId: string,
    rightsConfirmed: boolean,
    input: DraftDetailsInput,
  ) {
    if (!rightsConfirmed) {
      throw new QuickUploadError(
        "RIGHTS_CONFIRMATION_REQUIRED",
        "Confirm that you have the rights to publish this video before publishing.",
      );
    }
    const globalAutoTv = (await this.settings.get("autoAddPublishedUploadsToCreatorTv")) as boolean;
    const now = new Date();

    return this.database.client.$transaction(async (tx) => {
      const video = await tx.video.findUnique({
        where: { id: videoId },
        include: {
          channel: {
            include: {
              settings: true,
              primaryTvChannel: true,
            },
          },
          mediaAssets: {
            where: { kind: "SOURCE_VIDEO", removedAt: null },
            select: { id: true, status: true, mimeType: true },
          },
          mediaProcessingJobs: {
            orderBy: { generation: "desc" },
            take: 1,
            select: { status: true, errorCode: true },
          },
        },
      });
      if (!video) {
        throw new QuickUploadError("VIDEO_NOT_FOUND", "This draft could not be found.", 404);
      }
      const membership = await tx.channelMember.findFirst({
        where: { accountId, channelId: video.channelId, role: "OWNER" },
        select: { id: true },
      });
      if (!membership) {
        throw new QuickUploadError(
          "VIDEO_OWNER_REQUIRED",
          "Only the channel owner can publish this draft.",
          403,
        );
      }
      const canonicalReady = video.mediaAssets.some(
        (asset) => asset.status === "VALIDATED" && asset.mimeType === "video/mp4",
      );
      if (!canonicalReady) {
        const processing = video.mediaProcessingJobs[0];
        const uploadedSource = video.mediaAssets.some((asset) => asset.status === "UPLOADED");
        if (!uploadedSource && !processing) {
          throw new QuickUploadError(
            "UPLOAD_NOT_COMPLETE",
            "The video is still uploading. Processing starts automatically after the upload reaches 100%.",
            409,
          );
        }
        if (processing?.status === "FAILED") {
          throw new QuickUploadError(
            "VIDEO_PROCESSING_FAILED",
            "AYIN could not prepare this video for playback. It is saved in Studio for review or retry.",
            409,
          );
        }
        throw new QuickUploadError(
          "VIDEO_PROCESSING",
          "AYIN is preparing this video for reliable playback. Publishing will be available when processing reaches Ready.",
          409,
        );
      }

      const data = this.detailsData(input);
      const finalTitle = normalizeTitle(input.title ?? video.title);
      if (!finalTitle) {
        throw new QuickUploadError("TITLE_REQUIRED", "Add a title before publishing.");
      }
      if (finalTitle.length > 200) {
        throw new QuickUploadError("TITLE_TOO_LONG", "Keep the video title under 200 characters.");
      }
      const finalVisibility = input.visibility ?? video.visibility;
      const scheduledAt = input.scheduledPublishAt ?? video.scheduledPublishAt;
      const isScheduled = scheduledAt ? scheduledAt.getTime() > now.getTime() : false;

      await tx.contentRightsDeclaration.upsert({
        where: { videoId_version: { videoId, version: RIGHTS_DECLARATION_VERSION } },
        update: {},
        create: {
          videoId,
          declaredByAccountId: accountId,
          version: RIGHTS_DECLARATION_VERSION,
          basis: "AUTHORIZED",
          status: "CONFIRMED",
          statement: RIGHTS_STATEMENT,
          declaredAt: now,
        },
      });

      const uploadsPlaylist = await tx.playlist.findUnique({
        where: { channelId_systemKey: { channelId: video.channelId, systemKey: "UPLOADS" } },
        select: { id: true },
      });
      if (!uploadsPlaylist) {
        throw new QuickUploadError(
          "UPLOADS_PLAYLIST_MISSING",
          "AYIN could not find this channel's Uploads playlist.",
          409,
        );
      }
      const existingItem = await tx.playlistItem.findUnique({
        where: { playlistId_videoId: { playlistId: uploadsPlaylist.id, videoId } },
        select: { id: true, position: true },
      });
      if (!existingItem) {
        const lastItem = await tx.playlistItem.aggregate({
          where: { playlistId: uploadsPlaylist.id },
          _max: { position: true },
        });
        await tx.playlistItem.create({
          data: {
            playlistId: uploadsPlaylist.id,
            videoId,
            position: (lastItem._max.position ?? -1) + 1,
          },
        });
      }

      const creatorTvAllowed =
        globalAutoTv &&
        (video.channel.settings?.autoAddPublishedToTv ?? true) &&
        finalVisibility === "PUBLIC";
      let creatorTvAssociated = false;
      if (creatorTvAllowed && video.channel.primaryTvChannel) {
        if (!video.channel.primaryTvChannel.sourcePlaylistId) {
          await tx.creatorTvChannel.update({
            where: { id: video.channel.primaryTvChannel.id },
            data: { sourcePlaylistId: uploadsPlaylist.id },
          });
          creatorTvAssociated = true;
        } else {
          creatorTvAssociated =
            video.channel.primaryTvChannel.sourcePlaylistId === uploadsPlaylist.id;
        }
      }

      const updated = await tx.video.update({
        where: { id: videoId },
        data: {
          ...data,
          title: finalTitle,
          visibility: finalVisibility,
          status: isScheduled ? "SCHEDULED" : "PUBLISHED",
          scheduledPublishAt: isScheduled ? scheduledAt : null,
          publishedAt: isScheduled ? video.publishedAt : (video.publishedAt ?? now),
        },
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          visibility: true,
          publishedAt: true,
          scheduledPublishAt: true,
        },
      });

      return {
        video: updated,
        rightsDeclarationVersion: RIGHTS_DECLARATION_VERSION,
        uploadsPlaylistId: uploadsPlaylist.id,
        creatorTvAssociated,
      };
    });
  }

  async authorizeThumbnail(
    accountId: string,
    videoId: string,
    input: { mimeType: string; sizeBytes: number },
  ) {
    if (!this.storage.available) {
      throw new MediaStorageUnavailableError();
    }
    const normalizedMime = input.mimeType.toLowerCase();
    if (!new Set(["image/jpeg", "image/png"]).has(normalizedMime)) {
      throw new QuickUploadError(
        "UNSUPPORTED_THUMBNAIL_TYPE",
        "Choose a JPG or PNG thumbnail image.",
      );
    }
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
      throw new QuickUploadError(
        "INVALID_THUMBNAIL_SIZE",
        "This thumbnail size could not be read.",
      );
    }
    if (input.sizeBytes > MAX_THUMBNAIL_BYTES) {
      throw new QuickUploadError("THUMBNAIL_TOO_LARGE", "Keep thumbnails under 5 MB.", 413);
    }
    const video = await this.ownedVideo(accountId, videoId);
    const assetId = randomUUID();
    const extension = normalizedMime === "image/png" ? "png" : "jpg";
    const objectKey = `channels/${video.channelId}/media/${assetId}/thumbnail.${extension}`;
    await this.database.client.mediaAsset.create({
      data: {
        id: assetId,
        videoId,
        channelId: video.channelId,
        kind: "THUMBNAIL",
        status: "PENDING",
        r2ObjectKey: objectKey,
        mimeType: normalizedMime,
        sizeBytes: BigInt(input.sizeBytes),
      },
    });
    try {
      const authorization = await this.storage.authorizeSinglePut({
        key: objectKey,
        contentType: normalizedMime,
        expiresInSeconds: this.storageConfig.uploadUrlTtlSeconds,
      });
      return {
        assetId,
        upload: {
          url: authorization.url,
          method: "PUT" as const,
          headers: { "content-type": normalizedMime },
        },
      };
    } catch (error) {
      await this.database.client.mediaAsset.update({
        where: { id: assetId },
        data: { status: "REJECTED", removedAt: new Date() },
      });
      throw error;
    }
  }

  async completeThumbnail(accountId: string, videoId: string, assetId: string) {
    const video = await this.ownedVideo(accountId, videoId);
    const asset = await this.database.client.mediaAsset.findFirst({
      where: {
        id: assetId,
        videoId,
        channelId: video.channelId,
        kind: "THUMBNAIL",
        status: "PENDING",
        removedAt: null,
      },
      select: { id: true, r2ObjectKey: true, sizeBytes: true, mimeType: true },
    });
    if (!asset) {
      throw new QuickUploadError(
        "THUMBNAIL_NOT_FOUND",
        "This thumbnail upload is no longer active.",
        404,
      );
    }
    const object = await this.storage.headObject(asset.r2ObjectKey).catch(() => null);
    if (
      !object ||
      object.sizeBytes !== Number(asset.sizeBytes) ||
      (object.contentType && !object.contentType.toLowerCase().startsWith("image/"))
    ) {
      throw new QuickUploadError(
        "THUMBNAIL_UPLOAD_MISMATCH",
        "The thumbnail upload could not be verified. Please try it again.",
        409,
      );
    }
    const now = new Date();
    await this.database.client.$transaction([
      this.database.client.mediaAsset.updateMany({
        where: {
          videoId,
          kind: "THUMBNAIL",
          status: "UPLOADED",
          id: { not: assetId },
          removedAt: null,
        },
        data: { status: "REMOVED", removedAt: now },
      }),
      this.database.client.mediaAsset.update({
        where: { id: assetId },
        data: { status: "UPLOADED" },
      }),
    ]);
    return { assetId, status: "UPLOADED" as const };
  }

  private detailsData(input: DraftDetailsInput) {
    return {
      ...(input.title !== undefined ? { title: normalizeTitle(input.title) } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      ...(input.commentsEnabled !== undefined ? { commentsEnabled: input.commentsEnabled } : {}),
      ...(input.videoForm !== undefined ? { videoForm: input.videoForm } : {}),
      ...(input.scheduledPublishAt !== undefined
        ? { scheduledPublishAt: input.scheduledPublishAt }
        : {}),
    };
  }

  private async ownedVideo(accountId: string, videoId: string) {
    const video = await this.database.client.video.findUnique({
      where: { id: videoId },
      select: { id: true, channelId: true, status: true },
    });
    if (!video) {
      throw new QuickUploadError("VIDEO_NOT_FOUND", "This video could not be found.", 404);
    }
    await this.assertOwner(accountId, video.channelId);
    return video;
  }

  private async assertOwner(accountId: string, channelId: string): Promise<void> {
    const membership = await this.database.client.channelMember.findFirst({
      where: { accountId, channelId, role: "OWNER" },
      select: { id: true },
    });
    if (!membership) {
      throw new QuickUploadError(
        "CHANNEL_OWNER_REQUIRED",
        "Only the channel owner can create or publish videos for this channel.",
        403,
      );
    }
  }
}
