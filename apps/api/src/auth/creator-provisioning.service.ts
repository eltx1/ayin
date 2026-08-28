import { createHash } from "node:crypto";

import type { Prisma } from "@ayin/db";
import { Injectable } from "@nestjs/common";

export class ProvisioningConflictError extends Error {}

export interface CreatorProvisioningInput {
  accountId: string;
  displayName: string;
}

function stableUuid(accountId: string, namespace: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(`${namespace}:${accountId}`).digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function handleBase(displayName: string): string {
  const normalized = displayName
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 47)
    .replace(/-+$/g, "");

  return normalized || "ayin";
}

function accountSuffix(accountId: string): string {
  return accountId.replaceAll("-", "");
}

@Injectable()
export class CreatorProvisioningService {
  async provision(tx: Prisma.TransactionClient, input: CreatorProvisioningInput) {
    const ids = {
      profile: stableUuid(input.accountId, "default-viewer-profile"),
      channel: stableUuid(input.accountId, "default-channel"),
      member: stableUuid(input.accountId, "default-channel-owner"),
      settings: stableUuid(input.accountId, "default-channel-settings"),
      playlist: stableUuid(input.accountId, "uploads-playlist"),
      tv: stableUuid(input.accountId, "primary-creator-tv"),
      contract: stableUuid(input.accountId, "default-creator-contract"),
    };

    const existingChannel = await tx.channel.findUnique({
      where: { id: ids.channel },
      select: { handle: true, primaryTvChannelId: true },
    });
    const handle =
      existingChannel?.handle ??
      (await this.generateHandle(tx, input.displayName, input.accountId, ids.channel));

    const profile = await tx.viewerProfile.upsert({
      where: { id: ids.profile },
      update: {},
      create: {
        id: ids.profile,
        accountId: input.accountId,
        name: input.displayName,
        slug: "default",
        isDefault: true,
      },
    });

    const channel = await tx.channel.upsert({
      where: { id: ids.channel },
      update: {},
      create: {
        id: ids.channel,
        handle,
        name: input.displayName,
        status: "ACTIVE",
      },
    });

    await tx.channelMember.upsert({
      where: { id: ids.member },
      update: {},
      create: {
        id: ids.member,
        accountId: input.accountId,
        channelId: channel.id,
        role: "OWNER",
      },
    });

    await tx.channelSettings.upsert({
      where: { id: ids.settings },
      update: {},
      create: {
        id: ids.settings,
        channelId: channel.id,
      },
    });

    const uploadsPlaylist = await tx.playlist.upsert({
      where: { id: ids.playlist },
      update: {},
      create: {
        id: ids.playlist,
        channelId: channel.id,
        slug: "uploads",
        name: "Uploads",
        systemKey: "UPLOADS",
        isProtected: true,
        isPublic: true,
      },
    });

    const existingTv = await tx.creatorTvChannel.findUnique({
      where: { id: ids.tv },
      select: { id: true, sourcePlaylistId: true },
    });
    const tvSlug = existingTv
      ? undefined
      : await this.generateTvSlug(tx, handle, input.accountId, ids.tv);

    const creatorTv = await tx.creatorTvChannel.upsert({
      where: { id: ids.tv },
      update: existingTv?.sourcePlaylistId ? {} : { sourcePlaylistId: uploadsPlaylist.id },
      create: {
        id: ids.tv,
        channelId: channel.id,
        sourcePlaylistId: uploadsPlaylist.id,
        slug: tvSlug ?? `${handle}-tv`,
        name: `${input.displayName} TV`,
        status: "ACTIVE",
      },
    });

    if (!existingChannel?.primaryTvChannelId) {
      await tx.channel.update({
        where: { id: channel.id },
        data: { primaryTvChannelId: creatorTv.id },
      });
    }

    const creatorContract = await tx.creatorContract.upsert({
      where: { id: ids.contract },
      update: {},
      create: {
        id: ids.contract,
        channelId: channel.id,
        status: "PENDING",
      },
    });

    return {
      channel,
      creatorContract,
      creatorTv,
      profile,
      uploadsPlaylist,
    };
  }

  private async generateHandle(
    tx: Prisma.TransactionClient,
    displayName: string,
    accountId: string,
    channelId: string,
  ): Promise<string> {
    const base = handleBase(displayName);
    const baseOwner = await tx.channel.findUnique({
      where: { handle: base },
      select: { id: true },
    });
    if (!baseOwner || baseOwner.id === channelId) {
      return base;
    }

    const fallback = `${base}-${accountSuffix(accountId)}`;
    const fallbackOwner = await tx.channel.findUnique({
      where: { handle: fallback },
      select: { id: true },
    });
    if (fallbackOwner && fallbackOwner.id !== channelId) {
      throw new ProvisioningConflictError("Unable to allocate the deterministic channel handle.");
    }
    return fallback;
  }

  private async generateTvSlug(
    tx: Prisma.TransactionClient,
    handle: string,
    accountId: string,
    tvId: string,
  ): Promise<string> {
    const base = `${handle}-tv`;
    const baseOwner = await tx.creatorTvChannel.findUnique({
      where: { slug: base },
      select: { id: true },
    });
    if (!baseOwner || baseOwner.id === tvId) {
      return base;
    }

    const fallback = `${handle}-${accountSuffix(accountId)}-tv`;
    const fallbackOwner = await tx.creatorTvChannel.findUnique({
      where: { slug: fallback },
      select: { id: true },
    });
    if (fallbackOwner && fallbackOwner.id !== tvId) {
      throw new ProvisioningConflictError("Unable to allocate the deterministic Creator TV slug.");
    }
    return fallback;
  }
}
