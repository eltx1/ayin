import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import {
  LIVE_INGEST_PROVIDER,
  type LiveIngestProvider,
  LiveProviderUnavailableError,
} from "./live-provider.js";

export class LiveError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "LiveError";
  }
}

export interface CreateLiveInput {
  title: string;
  description?: string | null | undefined;
  scheduledStartAt?: string | null | undefined;
}

@Injectable()
export class LiveService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(LIVE_INGEST_PROVIDER) private readonly provider: LiveIngestProvider,
  ) {}

  async studioStreams(accountId: string) {
    const channel = await this.creatorChannel(accountId);
    const streams = await this.database.client.liveStream.findMany({
      where: { channelId: channel.id },
      orderBy: [{ scheduledStartAt: "desc" }, { createdAt: "desc" }],
    });
    return { provider: this.providerStatus(), channel, streams: streams.map(stripSecretHash) };
  }

  async create(accountId: string, input: CreateLiveInput) {
    const channel = await this.creatorChannel(accountId);
    const scheduledStartAt = input.scheduledStartAt ? new Date(input.scheduledStartAt) : null;
    const slug = await this.uniqueSlug(input.title);
    const stream = await this.database.client.liveStream.create({
      data: {
        channelId: channel.id,
        createdByAccountId: accountId,
        slug,
        title: input.title,
        description: input.description ?? null,
        scheduledStartAt,
        status: scheduledStartAt ? "SCHEDULED" : "DRAFT",
      },
    });
    return stripSecretHash(stream);
  }

  async provision(accountId: string, streamId: string) {
    const stream = await this.ownedStream(accountId, streamId);
    if (!this.provider.configured)
      throw new LiveError(
        "LIVE_PROVIDER_UNCONFIGURED",
        "Live ingest/transcoding requires a configured provider; R2 remains VOD storage only.",
        503,
      );
    const streamKey = randomBytes(30).toString("base64url");
    try {
      const provisioned = await this.provider.provision({
        streamId: stream.id,
        channelId: stream.channelId,
        title: stream.title,
        streamKey,
      });
      const updated = await this.database.client.liveStream.update({
        where: { id: stream.id },
        data: {
          providerKey: provisioned.providerKey,
          providerStreamId: provisioned.providerStreamId,
          ingestEndpoint: provisioned.ingestEndpoint,
          playbackUrl: provisioned.playbackUrl,
          streamKeyHash: hashKey(streamKey),
          status: "READY",
        },
      });
      return { stream: stripSecretHash(updated), streamKey };
    } catch (error) {
      if (error instanceof LiveProviderUnavailableError)
        throw new LiveError("LIVE_PROVIDER_UNCONFIGURED", error.message, 503);
      throw error;
    }
  }

  async rotateKey(accountId: string, streamId: string) {
    const stream = await this.ownedStream(accountId, streamId);
    if (!this.provider.configured)
      throw new LiveError("LIVE_PROVIDER_UNCONFIGURED", "Live provider is not configured.", 503);
    const streamKey = randomBytes(30).toString("base64url");
    const provisioned = await this.provider.rotateKey({
      streamId: stream.id,
      channelId: stream.channelId,
      title: stream.title,
      streamKey,
    });
    const updated = await this.database.client.liveStream.update({
      where: { id: stream.id },
      data: {
        providerKey: provisioned.providerKey,
        providerStreamId: provisioned.providerStreamId,
        ingestEndpoint: provisioned.ingestEndpoint,
        playbackUrl: provisioned.playbackUrl,
        streamKeyHash: hashKey(streamKey),
      },
    });
    return { stream: stripSecretHash(updated), streamKey };
  }

  async setState(accountId: string, streamId: string, status: "LIVE" | "ENDED" | "CANCELLED") {
    const stream = await this.ownedStream(accountId, streamId);
    if (status === "LIVE" && (!stream.playbackUrl || stream.providerKey === "unconfigured"))
      throw new LiveError(
        "LIVE_PLAYBACK_UNAVAILABLE",
        "A configured playback output is required.",
        409,
      );
    if (status === "ENDED") await this.provider.stop(stream.providerStreamId);
    const updated = await this.database.client.liveStream.update({
      where: { id: stream.id },
      data: {
        status,
        ...(status === "LIVE" ? { startedAt: new Date() } : {}),
        ...(status === "ENDED" ? { endedAt: new Date() } : {}),
      },
    });
    return stripSecretHash(updated);
  }

  async publicStream(slug: string) {
    const stream = await this.database.client.liveStream.findUnique({ where: { slug } });
    if (!stream) throw new LiveError("LIVE_NOT_FOUND", "Live stream not found.", 404);
    const channel = await this.database.client.channel.findFirst({
      where: { id: stream.channelId, status: "ACTIVE", removedAt: null },
      select: { id: true, handle: true, name: true },
    });
    if (!channel) throw new LiveError("LIVE_NOT_FOUND", "Live stream not found.", 404);
    return {
      ...stripSecretHash(stream),
      channel,
      adBreakHook: stream.adBreaksEnabled ? "IMA_CLIENT_BREAK" : null,
    };
  }

  async chat(slug: string) {
    const stream = await this.publicStream(slug);
    const messages = await this.database.client.liveChatMessage.findMany({
      where: { liveStreamId: stream.id, status: "PUBLISHED" },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return { chatEnabled: stream.chatEnabled, messages };
  }

  async postChat(accountId: string, slug: string, body: string) {
    const stream = await this.publicStream(slug);
    if (!stream.chatEnabled)
      throw new LiveError("LIVE_CHAT_DISABLED", "Live chat is disabled.", 409);
    if (stream.status !== "LIVE")
      throw new LiveError("LIVE_CHAT_NOT_ACTIVE", "Chat is available while live.", 409);
    const profile = await this.database.client.viewerProfile.findFirst({
      where: { accountId, isDefault: true, deletedAt: null },
      select: { id: true },
    });
    if (!profile) throw new LiveError("PROFILE_REQUIRED", "A viewer profile is required.", 403);
    return this.database.client.liveChatMessage.create({
      data: { liveStreamId: stream.id, authorProfileId: profile.id, body },
    });
  }

  async moderateMessage(
    accountId: string,
    streamId: string,
    messageId: string,
    action: "HIDE_MESSAGE" | "REMOVE_MESSAGE",
    reason?: string | null,
  ) {
    const stream = await this.ownedStream(accountId, streamId);
    const message = await this.database.client.liveChatMessage.findFirst({
      where: { id: messageId, liveStreamId: stream.id },
    });
    if (!message) throw new LiveError("CHAT_MESSAGE_NOT_FOUND", "Chat message not found.", 404);
    await this.database.client.$transaction([
      this.database.client.liveChatMessage.update({
        where: { id: message.id },
        data: {
          status: action === "HIDE_MESSAGE" ? "HIDDEN" : "REMOVED",
          ...(action === "REMOVE_MESSAGE" ? { removedAt: new Date() } : {}),
        },
      }),
      this.database.client.liveModerationAction.create({
        data: {
          liveStreamId: stream.id,
          messageId,
          actorAccountId: accountId,
          action,
          reason: reason ?? null,
        },
      }),
    ]);
    return { messageId, status: action === "HIDE_MESSAGE" ? "HIDDEN" : "REMOVED" };
  }

  async setChatEnabled(accountId: string, streamId: string, enabled: boolean) {
    const stream = await this.ownedStream(accountId, streamId);
    await this.database.client.$transaction([
      this.database.client.liveStream.update({
        where: { id: stream.id },
        data: { chatEnabled: enabled },
      }),
      this.database.client.liveModerationAction.create({
        data: {
          liveStreamId: stream.id,
          actorAccountId: accountId,
          action: enabled ? "ENABLE_CHAT" : "DISABLE_CHAT",
        },
      }),
    ]);
    return { streamId, chatEnabled: enabled };
  }

  providerStatus() {
    return { key: this.provider.key, configured: this.provider.configured };
  }

  private async creatorChannel(accountId: string) {
    const membership = await this.database.client.channelMember.findFirst({
      where: {
        accountId,
        role: { in: ["OWNER", "ADMIN", "EDITOR"] },
        channel: { status: "ACTIVE" },
      },
      orderBy: { createdAt: "asc" },
      select: { channel: { select: { id: true, handle: true, name: true } } },
    });
    if (!membership)
      throw new LiveError("CHANNEL_REQUIRED", "An active creator channel is required.", 403);
    return membership.channel;
  }

  private async ownedStream(accountId: string, streamId: string) {
    const channel = await this.creatorChannel(accountId);
    const stream = await this.database.client.liveStream.findFirst({
      where: { id: streamId, channelId: channel.id },
    });
    if (!stream) throw new LiveError("LIVE_NOT_FOUND", "Live stream not found.", 404);
    return stream;
  }

  private async uniqueSlug(title: string) {
    const base =
      title
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 120) || "live";
    for (let i = 0; i < 8; i += 1) {
      const slug = `${base}-${randomBytes(4).toString("hex")}`;
      const exists = await this.database.client.liveStream.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!exists) return slug;
    }
    throw new LiveError("LIVE_SLUG_EXHAUSTED", "Could not allocate a live URL.", 500);
  }
}

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stripSecretHash<T extends { streamKeyHash: string | null }>(
  stream: T,
): Omit<T, "streamKeyHash"> {
  const { streamKeyHash: _streamKeyHash, ...safe } = stream;
  return safe;
}
