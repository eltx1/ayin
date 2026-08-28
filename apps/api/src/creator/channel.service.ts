import { randomUUID } from "node:crypto";

import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import {
  MEDIA_STORAGE_ADAPTER,
  MEDIA_STORAGE_CONFIG,
  type MediaStorageAdapter,
  MediaStorageUnavailableError,
} from "../media/media-storage.adapter.js";
import type { MediaStorageConfig } from "../media/media-storage.config.js";
import { FeatureFlagService } from "../platform-config/feature-flag.service.js";

const CHANNEL_FLAG_KEYS = ["channel.shorts", "channel.posts"] as const;
const CHANNEL_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_BANNER_BYTES = 10 * 1024 * 1024;

export type ChannelEditActor =
  | { kind: "owner"; accountId: string }
  | { kind: "admin"; accountId: string };

export interface ChannelEditInput {
  name?: string | undefined;
  handle?: string | undefined;
  description?: string | null | undefined;
  accentColor?: string | null | undefined;
}

export class ChannelError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "ChannelError";
  }
}

function normalizeHandle(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function validHandle(value: string): boolean {
  return (
    value.length <= 80 &&
    /^[\p{L}\p{N}](?:[\p{L}\p{N}._-]{0,78}[\p{L}\p{N}])?$/u.test(value)
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

@Injectable()
export class ChannelService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(FeatureFlagService) private readonly featureFlags: FeatureFlagService,
    @Inject(MEDIA_STORAGE_ADAPTER) private readonly storage: MediaStorageAdapter,
    @Inject(MEDIA_STORAGE_CONFIG) private readonly storageConfig: MediaStorageConfig,
  ) {}

  async getPublicChannel(handleRaw: string) {
    const requestedHandle = normalizeHandle(handleRaw);
    if (!validHandle(requestedHandle)) {
      throw new ChannelError("CHANNEL_NOT_FOUND", "This AYIN channel could not be found.", 404);
    }

    let redirectedFrom: string | null = null;
    let channel = await this.database.client.channel.findUnique({
      where: { handle: requestedHandle },
      select: this.publicChannelSelect(),
    });

    if (!channel) {
      const redirect = await this.database.client.channelHandleRedirect.findUnique({
        where: { oldHandle: requestedHandle },
        select: { channelId: true },
      });
      if (redirect) {
        channel = await this.database.client.channel.findUnique({
          where: { id: redirect.channelId },
          select: this.publicChannelSelect(),
        });
        redirectedFrom = requestedHandle;
      }
    }

    if (!channel || channel.status !== "ACTIVE" || channel.removedAt) {
      throw new ChannelError("CHANNEL_NOT_FOUND", "This AYIN channel could not be found.", 404);
    }

    const [appearance, flags] = await Promise.all([
      this.readAppearance(channel.id),
      this.featureFlags.resolveEnabled(CHANNEL_FLAG_KEYS),
    ]);

    return {
      canonicalHandle: channel.handle,
      redirectedFrom,
      channel: {
        id: channel.id,
        handle: channel.handle,
        name: channel.name,
        description: channel.description,
        createdAt: channel.createdAt,
      },
      appearance,
      subscription: {
        available: false,
      },
      features: {
        shorts: flags["channel.shorts"] ?? false,
        posts: flags["channel.posts"] ?? false,
      },
      creatorTv: channel.primaryTvChannel
        ? {
            id: channel.primaryTvChannel.id,
            slug: channel.primaryTvChannel.slug,
            name: channel.primaryTvChannel.name,
            status: channel.primaryTvChannel.status,
          }
        : null,
      videos: channel.videos.map((video) => ({
        id: video.id,
        slug: video.slug,
        title: video.title,
        description: video.description,
        durationMs: video.durationMs,
        publishedAt: video.publishedAt,
        thumbnail: video.mediaAssets[0]
          ? {
              objectKey: video.mediaAssets[0].r2ObjectKey,
              mimeType: video.mediaAssets[0].mimeType,
            }
          : null,
      })),
      playlists: channel.playlists.map((playlist) => ({
        id: playlist.id,
        slug: playlist.slug,
        name: playlist.name,
        description: playlist.description,
        itemCount: playlist._count.items,
      })),
    };
  }

  async getEditableChannel(actor: ChannelEditActor, channelId: string) {
    await this.assertCanEdit(actor, channelId);
    const channel = await this.database.client.channel.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        handle: true,
        name: true,
        description: true,
        status: true,
        settings: {
          select: {
            defaultCommentsEnabled: true,
            defaultVideoVisibility: true,
            autoAddPublishedToTv: true,
            tvAutoScheduleEnabled: true,
          },
        },
      },
    });
    if (!channel || channel.status === "REMOVED") {
      throw new ChannelError("CHANNEL_NOT_FOUND", "This AYIN channel could not be found.", 404);
    }

    return {
      channel: {
        id: channel.id,
        handle: channel.handle,
        name: channel.name,
        description: channel.description,
        status: channel.status,
      },
      appearance: await this.readAppearance(channel.id),
      settings: channel.settings,
    };
  }

  async updateChannel(actor: ChannelEditActor, channelId: string, input: ChannelEditInput) {
    await this.assertCanEdit(actor, channelId);

    const name = input.name !== undefined ? input.name.trim().replace(/\s+/g, " ") : undefined;
    if (name !== undefined && (!name || name.length > 120)) {
      throw new ChannelError("INVALID_CHANNEL_NAME", "Keep the channel name between 1 and 120 characters.");
    }

    const handle = input.handle !== undefined ? normalizeHandle(input.handle) : undefined;
    if (handle !== undefined && !validHandle(handle)) {
      throw new ChannelError(
        "INVALID_CHANNEL_HANDLE",
        "Use letters, numbers, dots, underscores or hyphens, with no punctuation at the ends.",
      );
    }

    const description =
      input.description === undefined
        ? undefined
        : input.description === null
          ? null
          : input.description.trim() || null;
    if (description && description.length > 5_000) {
      throw new ChannelError(
        "CHANNEL_DESCRIPTION_TOO_LONG",
        "Keep the channel description under 5,000 characters.",
      );
    }

    const accentColor =
      input.accentColor === undefined
        ? undefined
        : input.accentColor === null
          ? null
          : input.accentColor.toUpperCase();
    if (accentColor !== undefined && accentColor !== null && !/^#[0-9A-F]{6}$/.test(accentColor)) {
      throw new ChannelError("INVALID_ACCENT_COLOR", "Choose a valid six-digit color.");
    }

    let previousHandle: string | null = null;
    try {
      await this.database.client.$transaction(async (tx) => {
        const current = await tx.channel.findUnique({
          where: { id: channelId },
          select: { handle: true, status: true },
        });
        if (!current || current.status === "REMOVED") {
          throw new ChannelError("CHANNEL_NOT_FOUND", "This AYIN channel could not be found.", 404);
        }

        if (handle !== undefined && handle !== current.handle) {
          await this.assertHandleAvailable(tx, handle, channelId);
          previousHandle = current.handle;

          await tx.channelHandleRedirect.deleteMany({
            where: { oldHandle: handle, channelId },
          });
          await tx.channel.update({
            where: { id: channelId },
            data: { handle },
          });
          await tx.channelHandleRedirect.upsert({
            where: { oldHandle: current.handle },
            update: { channelId },
            create: { oldHandle: current.handle, channelId },
          });
        }

        const channelData: Prisma.ChannelUpdateInput = {};
        if (name !== undefined) channelData.name = name;
        if (description !== undefined) channelData.description = description;
        if (Object.keys(channelData).length > 0) {
          await tx.channel.update({ where: { id: channelId }, data: channelData });
        }

        if (accentColor !== undefined) {
          await tx.channelAppearance.upsert({
            where: { channelId },
            update: { accentColor },
            create: { channelId, accentColor },
          });
        }
      });
    } catch (error) {
      if (error instanceof ChannelError) throw error;
      if (isUniqueConstraintError(error)) {
        throw new ChannelError("CHANNEL_HANDLE_UNAVAILABLE", "That channel handle is already in use.", 409);
      }
      throw error;
    }

    return {
      ...(await this.getEditableChannel(actor, channelId)),
      previousHandle,
    };
  }

  async authorizeChannelAsset(
    actor: ChannelEditActor,
    channelId: string,
    input: { kind: "avatar" | "banner"; mimeType: string; sizeBytes: number },
  ) {
    await this.assertCanEdit(actor, channelId);
    if (!this.storage.available) {
      throw new MediaStorageUnavailableError();
    }

    const mimeType = input.mimeType.toLowerCase();
    const extension = CHANNEL_IMAGE_TYPES.get(mimeType);
    if (!extension) {
      throw new ChannelError(
        "UNSUPPORTED_CHANNEL_IMAGE",
        "Choose a JPG, PNG or WebP image for your channel.",
      );
    }
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
      throw new ChannelError("INVALID_CHANNEL_IMAGE_SIZE", "This image size could not be read.");
    }
    const maxBytes = input.kind === "avatar" ? MAX_AVATAR_BYTES : MAX_BANNER_BYTES;
    if (input.sizeBytes > maxBytes) {
      throw new ChannelError(
        "CHANNEL_IMAGE_TOO_LARGE",
        input.kind === "avatar" ? "Keep channel avatars under 5 MB." : "Keep channel banners under 10 MB.",
        413,
      );
    }

    const assetId = randomUUID();
    const assetKind = input.kind === "avatar" ? "CHANNEL_AVATAR" : "CHANNEL_BANNER";
    const objectKey = `channels/${channelId}/channel-assets/${assetId}/${input.kind}.${extension}`;

    await this.database.client.mediaAsset.create({
      data: {
        id: assetId,
        channelId,
        kind: assetKind,
        status: "PENDING",
        r2ObjectKey: objectKey,
        mimeType,
        sizeBytes: BigInt(input.sizeBytes),
      },
    });

    try {
      const authorization = await this.storage.authorizeSinglePut({
        key: objectKey,
        contentType: mimeType,
        expiresInSeconds: this.storageConfig.uploadUrlTtlSeconds,
      });
      return {
        assetId,
        kind: input.kind,
        upload: {
          url: authorization.url,
          method: "PUT" as const,
          headers: { "content-type": mimeType },
        },
      };
    } catch (error) {
      await this.database.client.mediaAsset.updateMany({
        where: { id: assetId, status: "PENDING" },
        data: { status: "REJECTED", removedAt: new Date() },
      });
      throw error;
    }
  }

  async completeChannelAsset(actor: ChannelEditActor, channelId: string, assetId: string) {
    await this.assertCanEdit(actor, channelId);
    const asset = await this.database.client.mediaAsset.findFirst({
      where: {
        id: assetId,
        channelId,
        kind: { in: ["CHANNEL_AVATAR", "CHANNEL_BANNER"] },
        status: "PENDING",
        removedAt: null,
      },
      select: {
        id: true,
        kind: true,
        r2ObjectKey: true,
        mimeType: true,
        sizeBytes: true,
      },
    });
    if (!asset) {
      throw new ChannelError(
        "CHANNEL_IMAGE_NOT_FOUND",
        "This channel image upload is no longer active.",
        404,
      );
    }

    const object = await this.storage.headObject(asset.r2ObjectKey).catch(() => null);
    if (
      !object ||
      object.sizeBytes !== Number(asset.sizeBytes) ||
      (object.contentType && object.contentType.toLowerCase() !== asset.mimeType.toLowerCase())
    ) {
      throw new ChannelError(
        "CHANNEL_IMAGE_UPLOAD_MISMATCH",
        "The channel image upload could not be verified. Please try it again.",
        409,
      );
    }

    const appearance = await this.database.client.channelAppearance.findUnique({
      where: { channelId },
      select: { avatarAssetId: true, bannerAssetId: true },
    });
    const previousAssetId =
      asset.kind === "CHANNEL_AVATAR" ? appearance?.avatarAssetId : appearance?.bannerAssetId;
    const previousAsset =
      previousAssetId && previousAssetId !== asset.id
        ? await this.database.client.mediaAsset.findUnique({
            where: { id: previousAssetId },
            select: { id: true, r2ObjectKey: true },
          })
        : null;
    const selectedField =
      asset.kind === "CHANNEL_AVATAR"
        ? { avatarAssetId: asset.id }
        : { bannerAssetId: asset.id };

    await this.database.client.$transaction([
      this.database.client.mediaAsset.update({
        where: { id: asset.id },
        data: { status: "UPLOADED" },
      }),
      this.database.client.channelAppearance.upsert({
        where: { channelId },
        update: selectedField,
        create: { channelId, ...selectedField },
      }),
      ...(previousAsset
        ? [
            this.database.client.mediaAsset.updateMany({
              where: { id: previousAsset.id, status: { in: ["UPLOADED", "VALIDATED"] } },
              data: { status: "REMOVED", removedAt: new Date() },
            }),
          ]
        : []),
    ]);

    if (previousAsset) {
      await this.storage.deleteObject(previousAsset.r2ObjectKey).catch(() => undefined);
    }

    return {
      appearance: await this.readAppearance(channelId),
    };
  }

  private publicChannelSelect() {
    return {
      id: true,
      handle: true,
      name: true,
      description: true,
      status: true,
      removedAt: true,
      createdAt: true,
      primaryTvChannel: {
        select: { id: true, slug: true, name: true, status: true },
      },
      videos: {
        where: {
          status: "PUBLISHED" as const,
          visibility: "PUBLIC" as const,
          removedAt: null,
        },
        orderBy: [{ publishedAt: "desc" as const }, { createdAt: "desc" as const }],
        take: 24,
        select: {
          id: true,
          slug: true,
          title: true,
          description: true,
          durationMs: true,
          publishedAt: true,
          mediaAssets: {
            where: {
              kind: "THUMBNAIL" as const,
              status: { in: ["UPLOADED" as const, "VALIDATED" as const] },
              removedAt: null,
            },
            orderBy: { updatedAt: "desc" as const },
            take: 1,
            select: { r2ObjectKey: true, mimeType: true },
          },
        },
      },
      playlists: {
        where: { isPublic: true, deletedAt: null },
        orderBy: { createdAt: "desc" as const },
        take: 12,
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          _count: { select: { items: true } },
        },
      },
    };
  }

  private async readAppearance(channelId: string) {
    const appearance = await this.database.client.channelAppearance.findUnique({
      where: { channelId },
      select: {
        avatarAssetId: true,
        bannerAssetId: true,
        accentColor: true,
      },
    });
    const assetIds = [appearance?.avatarAssetId, appearance?.bannerAssetId].filter(
      (value): value is string => Boolean(value),
    );
    const assets =
      assetIds.length > 0
        ? await this.database.client.mediaAsset.findMany({
            where: {
              id: { in: assetIds },
              status: { in: ["UPLOADED", "VALIDATED"] },
              removedAt: null,
            },
            select: { id: true, r2ObjectKey: true, mimeType: true },
          })
        : [];
    const byId = new Map(assets.map((asset) => [asset.id, asset]));

    const avatar = appearance?.avatarAssetId ? byId.get(appearance.avatarAssetId) : undefined;
    const banner = appearance?.bannerAssetId ? byId.get(appearance.bannerAssetId) : undefined;
    return {
      accentColor: appearance?.accentColor ?? null,
      avatar: avatar
        ? { assetId: avatar.id, objectKey: avatar.r2ObjectKey, mimeType: avatar.mimeType }
        : null,
      banner: banner
        ? { assetId: banner.id, objectKey: banner.r2ObjectKey, mimeType: banner.mimeType }
        : null,
    };
  }

  private async assertCanEdit(actor: ChannelEditActor, channelId: string): Promise<void> {
    if (actor.kind === "owner") {
      const membership = await this.database.client.channelMember.findFirst({
        where: { accountId: actor.accountId, channelId, role: "OWNER" },
        select: { id: true },
      });
      if (!membership) {
        throw new ChannelError(
          "CHANNEL_OWNER_REQUIRED",
          "Only the channel owner can edit this channel.",
          403,
        );
      }
      return;
    }

    const assignment = await this.database.client.adminRoleAssignment.findFirst({
      where: {
        accountId: actor.accountId,
        role: { in: ["ADMIN", "SUPERADMIN"] },
      },
      select: { id: true },
    });
    if (!assignment) {
      throw new ChannelError("ADMIN_REQUIRED", "An AYIN admin role is required.", 403);
    }
  }

  private async assertHandleAvailable(
    tx: Prisma.TransactionClient,
    handle: string,
    channelId: string,
  ): Promise<void> {
    const current = await tx.channel.findUnique({
      where: { handle },
      select: { id: true },
    });
    if (current && current.id !== channelId) {
      throw new ChannelError("CHANNEL_HANDLE_UNAVAILABLE", "That channel handle is already in use.", 409);
    }

    const redirect = await tx.channelHandleRedirect.findUnique({
      where: { oldHandle: handle },
      select: { channelId: true },
    });
    if (redirect && redirect.channelId !== channelId) {
      throw new ChannelError(
        "CHANNEL_HANDLE_UNAVAILABLE",
        "That channel handle is reserved by an existing AYIN channel.",
        409,
      );
    }
  }
}
