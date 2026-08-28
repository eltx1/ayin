import { randomUUID } from "node:crypto";

import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";

export type PlaylistVisibilityValue = "PUBLIC" | "UNLISTED" | "PRIVATE";
export type PlaylistEditActor =
  | { kind: "owner"; accountId: string }
  | { kind: "admin"; accountId: string };

export interface PlaylistCreateInput {
  name: string;
  description?: string | null;
  visibility?: PlaylistVisibilityValue;
}

export interface PlaylistUpdateInput {
  name?: string;
  description?: string | null;
  visibility?: PlaylistVisibilityValue;
}

export class PlaylistError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "PlaylistError";
  }
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeDescription(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.trim() || null;
}

function slugBase(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
  return normalized || "playlist";
}

function isSystemPlaylist(playlist: { systemKey: string | null; isProtected: boolean }): boolean {
  return playlist.systemKey !== null || playlist.isProtected;
}

@Injectable()
export class PlaylistService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  async listEditablePlaylists(actor: PlaylistEditActor, channelId: string) {
    await this.assertCanManageChannel(actor, channelId);
    const renameUploadsAllowed = await this.creatorUploadsRenameAllowed(actor);
    const playlists = await this.database.client.playlist.findMany({
      where: { channelId, deletedAt: null },
      orderBy: [{ systemKey: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        channelId: true,
        slug: true,
        name: true,
        description: true,
        systemKey: true,
        isProtected: true,
        visibility: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { items: true } },
      },
    });

    return {
      playlists: playlists.map((playlist) => ({
        id: playlist.id,
        channelId: playlist.channelId,
        slug: playlist.slug,
        name: playlist.name,
        description: playlist.description,
        systemKey: playlist.systemKey,
        protected: playlist.isProtected,
        visibility: playlist.visibility,
        itemCount: playlist._count.items,
        createdAt: playlist.createdAt,
        updatedAt: playlist.updatedAt,
        capabilities: this.capabilities(playlist, renameUploadsAllowed),
      })),
    };
  }

  async getEditablePlaylist(actor: PlaylistEditActor, playlistId: string) {
    const playlist = await this.getPlaylistForActor(actor, playlistId);
    const renameUploadsAllowed = await this.creatorUploadsRenameAllowed(actor);
    const items = await this.database.client.playlistItem.findMany({
      where: { playlistId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        position: true,
        video: {
          select: {
            id: true,
            slug: true,
            title: true,
            status: true,
            visibility: true,
            publishedAt: true,
          },
        },
      },
    });
    const existingVideoIds = items.map((item) => item.video.id);
    const availableVideos = await this.database.client.video.findMany({
      where: {
        channelId: playlist.channelId,
        status: "PUBLISHED",
        removedAt: null,
        ...(existingVideoIds.length > 0 ? { id: { notIn: existingVideoIds } } : {}),
      },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        slug: true,
        title: true,
        visibility: true,
        publishedAt: true,
      },
    });

    return {
      playlist: {
        id: playlist.id,
        channelId: playlist.channelId,
        slug: playlist.slug,
        name: playlist.name,
        description: playlist.description,
        systemKey: playlist.systemKey,
        protected: playlist.isProtected,
        visibility: playlist.visibility,
        capabilities: this.capabilities(playlist, renameUploadsAllowed),
      },
      items,
      availableVideos,
    };
  }

  async createPlaylist(actor: PlaylistEditActor, channelId: string, input: PlaylistCreateInput) {
    await this.assertCanManageChannel(actor, channelId);
    const name = this.validateName(input.name);
    const description = this.validateDescription(input.description);
    const visibility = input.visibility ?? "PUBLIC";
    const id = randomUUID();
    const slug = `${slugBase(name)}-${id.slice(0, 8)}`;

    const playlist = await this.database.client.$transaction(async (tx) => {
      const created = await tx.playlist.create({
        data: {
          id,
          channelId,
          slug,
          name,
          description: description ?? null,
          visibility,
          isPublic: visibility === "PUBLIC",
          isProtected: false,
        },
        select: {
          id: true,
          channelId: true,
          slug: true,
          name: true,
          description: true,
          systemKey: true,
          isProtected: true,
          visibility: true,
        },
      });
      await this.auditIfAdmin(tx, actor, "playlist.create", created.id, {
        channelId,
        visibility,
      });
      return created;
    });

    return { playlist };
  }

  async updatePlaylist(actor: PlaylistEditActor, playlistId: string, input: PlaylistUpdateInput) {
    const current = await this.getPlaylistForActor(actor, playlistId);
    const system = isSystemPlaylist(current);
    const renameUploadsAllowed = await this.creatorUploadsRenameAllowed(actor);

    const data: Prisma.PlaylistUpdateInput = {};
    if (input.name !== undefined) {
      if (system && !renameUploadsAllowed) {
        throw new PlaylistError(
          "UPLOADS_RENAME_DISABLED",
          "AYIN's current playlist policy keeps the Uploads name fixed for creators.",
          409,
        );
      }
      data.name = this.validateName(input.name);
    }
    if (input.description !== undefined) {
      data.description = this.validateDescription(input.description) ?? null;
    }
    if (input.visibility !== undefined) {
      if (system && input.visibility !== current.visibility) {
        throw new PlaylistError(
          "SYSTEM_PLAYLIST_VISIBILITY_PROTECTED",
          "The Uploads playlist visibility is protected so published uploads stay discoverable consistently.",
          409,
        );
      }
      data.visibility = input.visibility;
      data.isPublic = input.visibility === "PUBLIC";
    }

    const playlist = await this.database.client.$transaction(async (tx) => {
      const updated = await tx.playlist.update({
        where: { id: playlistId },
        data,
        select: {
          id: true,
          channelId: true,
          slug: true,
          name: true,
          description: true,
          systemKey: true,
          isProtected: true,
          visibility: true,
        },
      });
      await this.auditIfAdmin(tx, actor, "playlist.update", playlistId, {
        channelId: current.channelId,
      });
      return updated;
    });

    return {
      playlist,
      capabilities: this.capabilities(playlist, renameUploadsAllowed),
    };
  }

  async deletePlaylist(actor: PlaylistEditActor, playlistId: string) {
    const current = await this.getPlaylistForActor(actor, playlistId, true);
    if (isSystemPlaylist(current)) {
      throw new PlaylistError(
        "SYSTEM_PLAYLIST_PROTECTED",
        "The system Uploads playlist cannot be deleted.",
        409,
      );
    }
    if (current.creatorTvFeeds.length > 0) {
      throw new PlaylistError(
        "PLAYLIST_IN_USE",
        "This playlist is currently connected to Creator TV and cannot be deleted yet.",
        409,
      );
    }

    await this.database.client.$transaction(async (tx) => {
      await tx.playlist.update({ where: { id: playlistId }, data: { deletedAt: new Date() } });
      await this.auditIfAdmin(tx, actor, "playlist.delete", playlistId, {
        channelId: current.channelId,
      });
    });
    return { deleted: true };
  }

  async addItem(actor: PlaylistEditActor, playlistId: string, videoId: string) {
    const current = await this.getPlaylistForActor(actor, playlistId);
    this.assertManualItemEditingAllowed(current);

    return this.database.client.$transaction(async (tx) => {
      await this.lockPlaylist(tx, playlistId);
      const video = await tx.video.findFirst({
        where: {
          id: videoId,
          channelId: current.channelId,
          status: "PUBLISHED",
          removedAt: null,
        },
        select: { id: true },
      });
      if (!video) {
        throw new PlaylistError(
          "PLAYLIST_VIDEO_UNAVAILABLE",
          "Choose a published video from this channel.",
          404,
        );
      }

      const existing = await tx.playlistItem.findUnique({
        where: { playlistId_videoId: { playlistId, videoId } },
        select: { id: true, position: true },
      });
      if (existing) {
        return { item: existing, alreadyPresent: true };
      }

      const last = await tx.playlistItem.aggregate({
        where: { playlistId },
        _max: { position: true },
      });
      const item = await tx.playlistItem.create({
        data: {
          playlistId,
          videoId,
          position: (last._max.position ?? -1) + 1,
        },
        select: { id: true, position: true },
      });
      await this.auditIfAdmin(tx, actor, "playlist.item.add", playlistId, {
        channelId: current.channelId,
        videoId,
      });
      return { item, alreadyPresent: false };
    });
  }

  async removeItem(actor: PlaylistEditActor, playlistId: string, itemId: string) {
    const current = await this.getPlaylistForActor(actor, playlistId);
    this.assertManualItemEditingAllowed(current);

    return this.database.client.$transaction(async (tx) => {
      await this.lockPlaylist(tx, playlistId);
      const item = await tx.playlistItem.findFirst({
        where: { id: itemId, playlistId },
        select: { id: true, videoId: true },
      });
      if (!item) {
        throw new PlaylistError("PLAYLIST_ITEM_NOT_FOUND", "This playlist item was not found.", 404);
      }
      await tx.playlistItem.delete({ where: { id: item.id } });
      await this.compactPositions(tx, playlistId);
      await this.auditIfAdmin(tx, actor, "playlist.item.remove", playlistId, {
        channelId: current.channelId,
        videoId: item.videoId,
      });
      return { removed: true };
    });
  }

  async reorderItems(actor: PlaylistEditActor, playlistId: string, itemIds: string[]) {
    const current = await this.getPlaylistForActor(actor, playlistId);
    this.assertManualItemEditingAllowed(current);
    if (new Set(itemIds).size !== itemIds.length) {
      throw new PlaylistError(
        "INVALID_PLAYLIST_ORDER",
        "Each playlist item must appear exactly once in the new order.",
      );
    }

    return this.database.client.$transaction(async (tx) => {
      await this.lockPlaylist(tx, playlistId);
      const existing = await tx.playlistItem.findMany({
        where: { playlistId },
        orderBy: { position: "asc" },
        select: { id: true },
      });
      if (
        existing.length !== itemIds.length ||
        existing.some((item) => !itemIds.includes(item.id))
      ) {
        throw new PlaylistError(
          "INVALID_PLAYLIST_ORDER",
          "Reorder the complete current playlist without adding or dropping items.",
          409,
        );
      }

      await tx.playlistItem.updateMany({
        where: { playlistId },
        data: { position: { increment: 1_000_000 } },
      });
      for (const [position, id] of itemIds.entries()) {
        await tx.playlistItem.update({ where: { id }, data: { position } });
      }
      await this.auditIfAdmin(tx, actor, "playlist.items.reorder", playlistId, {
        channelId: current.channelId,
        itemCount: itemIds.length,
      });
      return { reordered: true };
    });
  }

  async getPublicPlaylist(handleRaw: string, slugRaw: string) {
    const requestedHandle = handleRaw.normalize("NFKC").trim().toLowerCase();
    if (
      requestedHandle.length > 80 ||
      !/^[\p{L}\p{N}](?:[\p{L}\p{N}._-]{0,78}[\p{L}\p{N}])?$/u.test(requestedHandle)
    ) {
      throw new PlaylistError("PLAYLIST_NOT_FOUND", "This AYIN playlist could not be found.", 404);
    }
    const slug = slugRaw.trim();
    if (!slug || slug.length > 160) {
      throw new PlaylistError("PLAYLIST_NOT_FOUND", "This AYIN playlist could not be found.", 404);
    }

    let redirectedFrom: string | null = null;
    let channel = await this.database.client.channel.findUnique({
      where: { handle: requestedHandle },
      select: { id: true, handle: true, name: true, status: true, removedAt: true },
    });
    if (!channel) {
      const redirect = await this.database.client.channelHandleRedirect.findUnique({
        where: { oldHandle: requestedHandle },
        select: { channelId: true },
      });
      if (redirect) {
        channel = await this.database.client.channel.findUnique({
          where: { id: redirect.channelId },
          select: { id: true, handle: true, name: true, status: true, removedAt: true },
        });
        redirectedFrom = requestedHandle;
      }
    }
    if (!channel || channel.status !== "ACTIVE" || channel.removedAt) {
      throw new PlaylistError("PLAYLIST_NOT_FOUND", "This AYIN playlist could not be found.", 404);
    }

    const playlist = await this.database.client.playlist.findUnique({
      where: { channelId_slug: { channelId: channel.id, slug } },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        visibility: true,
        systemKey: true,
        deletedAt: true,
        items: {
          where: {
            video: {
              status: "PUBLISHED",
              visibility: "PUBLIC",
              removedAt: null,
            },
          },
          orderBy: { position: "asc" },
          select: {
            id: true,
            position: true,
            video: {
              select: {
                id: true,
                slug: true,
                title: true,
                description: true,
                durationMs: true,
                publishedAt: true,
                mediaAssets: {
                  where: {
                    kind: "THUMBNAIL",
                    status: { in: ["UPLOADED", "VALIDATED"] },
                    removedAt: null,
                  },
                  orderBy: { updatedAt: "desc" },
                  take: 1,
                  select: { r2ObjectKey: true, mimeType: true },
                },
              },
            },
          },
        },
      },
    });
    if (
      !playlist ||
      playlist.deletedAt ||
      (playlist.visibility !== "PUBLIC" && playlist.visibility !== "UNLISTED")
    ) {
      throw new PlaylistError("PLAYLIST_NOT_FOUND", "This AYIN playlist could not be found.", 404);
    }

    return {
      canonicalHandle: channel.handle,
      redirectedFrom,
      channel: { id: channel.id, handle: channel.handle, name: channel.name },
      playlist: {
        id: playlist.id,
        slug: playlist.slug,
        name: playlist.name,
        description: playlist.description,
        visibility: playlist.visibility,
        systemKey: playlist.systemKey,
      },
      items: playlist.items.map((item) => ({
        id: item.id,
        position: item.position,
        video: {
          id: item.video.id,
          slug: item.video.slug,
          title: item.video.title,
          description: item.video.description,
          durationMs: item.video.durationMs,
          publishedAt: item.video.publishedAt,
          thumbnail: item.video.mediaAssets[0]
            ? {
                objectKey: item.video.mediaAssets[0].r2ObjectKey,
                mimeType: item.video.mediaAssets[0].mimeType,
              }
            : null,
        },
      })),
    };
  }

  async ensureUploadsItemInTransaction(
    tx: Prisma.TransactionClient,
    channelId: string,
    videoId: string,
  ): Promise<{ playlistId: string; itemId: string; created: boolean }> {
    const uploads = await tx.playlist.findUnique({
      where: { channelId_systemKey: { channelId, systemKey: "UPLOADS" } },
      select: { id: true },
    });
    if (!uploads) {
      throw new PlaylistError(
        "UPLOADS_PLAYLIST_MISSING",
        "AYIN could not find this channel's Uploads playlist.",
        409,
      );
    }
    await this.lockPlaylist(tx, uploads.id);
    const existing = await tx.playlistItem.findUnique({
      where: { playlistId_videoId: { playlistId: uploads.id, videoId } },
      select: { id: true },
    });
    if (existing) return { playlistId: uploads.id, itemId: existing.id, created: false };

    const last = await tx.playlistItem.aggregate({
      where: { playlistId: uploads.id },
      _max: { position: true },
    });
    const item = await tx.playlistItem.create({
      data: {
        playlistId: uploads.id,
        videoId,
        position: (last._max.position ?? -1) + 1,
      },
      select: { id: true },
    });
    return { playlistId: uploads.id, itemId: item.id, created: true };
  }

  private validateName(value: string): string {
    const name = normalizeName(value);
    if (!name || name.length > 160) {
      throw new PlaylistError(
        "INVALID_PLAYLIST_NAME",
        "Keep the playlist name between 1 and 160 characters.",
      );
    }
    return name;
  }

  private validateDescription(value: string | null | undefined): string | null | undefined {
    const description = normalizeDescription(value);
    if (description && description.length > 5_000) {
      throw new PlaylistError(
        "PLAYLIST_DESCRIPTION_TOO_LONG",
        "Keep the playlist description under 5,000 characters.",
      );
    }
    return description;
  }

  private async getPlaylistForActor(
    actor: PlaylistEditActor,
    playlistId: string,
    includeTvFeeds = false,
  ) {
    const playlist = await this.database.client.playlist.findUnique({
      where: { id: playlistId },
      select: {
        id: true,
        channelId: true,
        slug: true,
        name: true,
        description: true,
        systemKey: true,
        isProtected: true,
        visibility: true,
        deletedAt: true,
        creatorTvFeeds: includeTvFeeds ? { select: { id: true } } : { select: { id: true }, take: 0 },
      },
    });
    if (!playlist || playlist.deletedAt) {
      throw new PlaylistError("PLAYLIST_NOT_FOUND", "This playlist could not be found.", 404);
    }
    await this.assertCanManageChannel(actor, playlist.channelId);
    return playlist;
  }

  private async assertCanManageChannel(actor: PlaylistEditActor, channelId: string): Promise<void> {
    if (actor.kind === "owner") {
      const membership = await this.database.client.channelMember.findFirst({
        where: { accountId: actor.accountId, channelId, role: "OWNER" },
        select: { id: true },
      });
      if (!membership) {
        throw new PlaylistError(
          "PLAYLIST_OWNER_REQUIRED",
          "Only the channel owner can manage these playlists.",
          403,
        );
      }
      return;
    }

    const assignment = await this.database.client.adminRoleAssignment.findFirst({
      where: { accountId: actor.accountId, role: { in: ["ADMIN", "SUPERADMIN"] } },
      select: { id: true },
    });
    if (!assignment) {
      throw new PlaylistError("ADMIN_REQUIRED", "An AYIN admin role is required.", 403);
    }
  }

  private async creatorUploadsRenameAllowed(actor: PlaylistEditActor): Promise<boolean> {
    if (actor.kind === "admin") return true;
    return (await this.settings.get("allowCreatorUploadsPlaylistRename")) as boolean;
  }

  private capabilities(
    playlist: { systemKey: string | null; isProtected: boolean },
    renameUploadsAllowed: boolean,
  ) {
    const system = isSystemPlaylist(playlist);
    return {
      canDelete: !system,
      canRename: !system || renameUploadsAllowed,
      canChangeVisibility: !system,
      canEditItems: !system,
    };
  }

  private assertManualItemEditingAllowed(playlist: {
    systemKey: string | null;
    isProtected: boolean;
  }): void {
    if (isSystemPlaylist(playlist)) {
      throw new PlaylistError(
        "SYSTEM_PLAYLIST_ITEMS_PROTECTED",
        "Uploads is maintained automatically so every published upload stays present exactly once.",
        409,
      );
    }
  }

  private async lockPlaylist(tx: Prisma.TransactionClient, playlistId: string): Promise<void> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${playlistId}))`;
  }

  private async compactPositions(tx: Prisma.TransactionClient, playlistId: string): Promise<void> {
    const items = await tx.playlistItem.findMany({
      where: { playlistId },
      orderBy: { position: "asc" },
      select: { id: true, position: true },
    });
    for (const [position, item] of items.entries()) {
      if (item.position !== position) {
        await tx.playlistItem.update({ where: { id: item.id }, data: { position } });
      }
    }
  }

  private async auditIfAdmin(
    tx: Prisma.TransactionClient,
    actor: PlaylistEditActor,
    action: string,
    playlistId: string,
    metadata: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    if (actor.kind !== "admin") return;
    await tx.adminAuditLog.create({
      data: {
        actorAccountId: actor.accountId,
        action,
        entityType: "Playlist",
        entityId: playlistId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}
