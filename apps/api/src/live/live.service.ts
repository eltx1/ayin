import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { LiveStream, Prisma } from "@ayin/db";

import { DatabaseService } from "../database/database.service.js";
import {
  LIVE_INGEST_PROVIDER,
  type LiveIngestProvider,
  type LiveProviderStatus,
  type LiveProviderWebhookEvent,
  LiveProviderOperationError,
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
    const channel = await this.creatorChannel(accountId);
    this.assertProviderConfigured();
    let createdProviderStreamId: string | null = null;

    try {
      return await this.database.client.$transaction(
        async (transaction) => {
          await this.acquireProviderMutationLock(transaction, streamId);
          const stream = await transaction.liveStream.findFirst({
            where: { id: streamId, channelId: channel.id },
          });
          if (!stream) throw new LiveError("LIVE_NOT_FOUND", "Live stream not found.", 404);
          if (stream.providerStreamId) {
            throw new LiveError(
              "LIVE_ALREADY_PROVISIONED",
              "This live session already has a provider resource. Rotate credentials instead.",
              409,
            );
          }

          const provisioned = await this.provider.provision({
            streamId: stream.id,
            channelId: stream.channelId,
            title: stream.title,
          });
          createdProviderStreamId = provisioned.providerStreamId;

          const updated = await transaction.liveStream.update({
            where: { id: stream.id },
            data: {
              providerKey: provisioned.providerKey,
              providerStreamId: provisioned.providerStreamId,
              ingestEndpoint: provisioned.ingestEndpoint,
              playbackUrl: provisioned.playbackUrl,
              streamKeyHash: hashKey(provisioned.encoder.rtmps.streamKey),
              status: "READY",
            },
          });
          return { stream: stripSecretHash(updated), encoder: provisioned.encoder };
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      if (createdProviderStreamId) {
        try {
          await this.provider.discard(createdProviderStreamId);
        } catch {
          throw new LiveError(
            "LIVE_PROVIDER_CLEANUP_REQUIRED",
            `Mux resource ${createdProviderStreamId} was created but AYIN could not persist or clean it up. Operator cleanup is required before retrying.`,
            502,
          );
        }
      }
      this.throwProviderError(error);
    }
  }

  async rotateKey(accountId: string, streamId: string) {
    const channel = await this.creatorChannel(accountId);
    this.assertProviderConfigured();

    try {
      return await this.database.client.$transaction(
        async (transaction) => {
          await this.acquireProviderMutationLock(transaction, streamId);
          const stream = await transaction.liveStream.findFirst({
            where: { id: streamId, channelId: channel.id },
          });
          if (!stream) throw new LiveError("LIVE_NOT_FOUND", "Live stream not found.", 404);
          if (!stream.providerStreamId) {
            throw new LiveError(
              "LIVE_PROVIDER_RESOURCE_MISSING",
              "Provision this live session before rotating its credentials.",
              409,
            );
          }

          const provisioned = await this.provider.rotateKey(stream.providerStreamId);
          const updated = await transaction.liveStream.update({
            where: { id: stream.id },
            data: {
              providerKey: provisioned.providerKey,
              providerStreamId: provisioned.providerStreamId,
              ingestEndpoint: provisioned.ingestEndpoint,
              playbackUrl: provisioned.playbackUrl,
              streamKeyHash: hashKey(provisioned.encoder.rtmps.streamKey),
            },
          });
          return { stream: stripSecretHash(updated), encoder: provisioned.encoder };
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      this.throwProviderError(error);
    }
  }

  async syncProviderStatus(accountId: string, streamId: string) {
    const stream = await this.ownedStream(accountId, streamId);
    this.assertProviderConfigured();
    if (!stream.providerStreamId) {
      throw new LiveError(
        "LIVE_PROVIDER_RESOURCE_MISSING",
        "Provision this live session before synchronizing provider status.",
        409,
      );
    }

    try {
      const evidence = await this.provider.retrieveStatus(stream.providerStreamId);
      const updated = await this.applyProviderEvidence(stream, evidence);
      return { stream: stripSecretHash(updated), evidence };
    } catch (error) {
      this.throwProviderError(error);
    }
  }

  async providerDiagnostics(accountId: string, streamId: string) {
    const stream = await this.ownedStream(accountId, streamId);
    const provider = this.provider.diagnostics();
    if (!stream.providerStreamId || !this.provider.configured) {
      return {
        provider,
        stream: {
          id: stream.id,
          status: stream.status,
          providerStreamId: stream.providerStreamId,
          playbackUrl: stream.playbackUrl,
        },
        evidence: null,
      };
    }

    try {
      const evidence = await this.provider.retrieveStatus(stream.providerStreamId);
      return {
        provider,
        stream: {
          id: stream.id,
          status: stream.status,
          providerStreamId: stream.providerStreamId,
          playbackUrl: stream.playbackUrl,
        },
        evidence,
      };
    } catch (error) {
      this.throwProviderError(error);
    }
  }

  async handleProviderWebhook(rawBody: string | Buffer, signatureHeader: string | undefined) {
    this.assertProviderConfigured();
    let event: LiveProviderWebhookEvent;
    try {
      event = this.provider.verifyWebhook(rawBody, signatureHeader);
    } catch (error) {
      if (
        error instanceof LiveProviderOperationError &&
        error.code.startsWith("MUX_WEBHOOK_SIGNATURE_")
      ) {
        throw new LiveError("LIVE_WEBHOOK_SIGNATURE_INVALID", error.message, 401);
      }
      this.throwProviderError(error);
    }

    if (event.kind === "IGNORED" || !event.providerStreamId) {
      return { accepted: true, ignored: true, eventId: event.eventId, event: event.kind };
    }

    const stream = await this.database.client.liveStream.findFirst({
      where: {
        providerKey: this.provider.key,
        providerStreamId: event.providerStreamId,
      },
    });
    if (!stream) {
      return { accepted: true, ignored: true, eventId: event.eventId, event: event.kind };
    }

    const updated = await this.applyWebhookEvent(stream, event);
    return {
      accepted: true,
      ignored: false,
      eventId: event.eventId,
      event: event.kind,
      stream: stripSecretHash(updated),
    };
  }

  async setState(accountId: string, streamId: string, status: "LIVE" | "ENDED" | "CANCELLED") {
    if (status === "LIVE") {
      const synced = await this.syncProviderStatus(accountId, streamId);
      if (synced.stream.status !== "LIVE") {
        throw new LiveError(
          "LIVE_PROVIDER_NOT_PLAYABLE",
          "The provider has not yet confirmed a playable live output.",
          409,
        );
      }
      return synced.stream;
    }

    const stream = await this.ownedStream(accountId, streamId);
    if (stream.providerStreamId) {
      this.assertProviderConfigured();
      try {
        await this.provider.stop(stream.providerStreamId);
      } catch (error) {
        this.throwProviderError(error);
      }
    }
    const updated = await this.database.client.liveStream.update({
      where: { id: stream.id },
      data: {
        status,
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
    return this.provider.diagnostics();
  }

  private async acquireProviderMutationLock(
    transaction: Prisma.TransactionClient,
    streamId: string,
  ) {
    const lockKey = `ayin-live-provider:${streamId}`;
    const rows = await transaction.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS locked
    `;
    if (!rows[0]?.locked) {
      throw new LiveError(
        "LIVE_PROVIDER_OPERATION_IN_PROGRESS",
        "Another provider credential operation is already in progress for this live session.",
        409,
      );
    }
  }

  private assertProviderConfigured() {
    if (!this.provider.configured) {
      throw new LiveError(
        "LIVE_PROVIDER_UNCONFIGURED",
        "Live ingest/transcoding requires a configured provider; R2 remains VOD storage only.",
        503,
      );
    }
  }

  private throwProviderError(error: unknown): never {
    if (error instanceof LiveProviderUnavailableError) {
      throw new LiveError("LIVE_PROVIDER_UNCONFIGURED", error.message, 503);
    }
    if (error instanceof LiveProviderOperationError) {
      throw new LiveError("LIVE_PROVIDER_REQUEST_FAILED", error.message, 502);
    }
    throw error;
  }

  private async applyProviderEvidence(
    stream: LiveStream,
    evidence: LiveProviderStatus,
  ) {
    if (evidence.playable) {
      if (stream.status === "ENDED" || stream.status === "CANCELLED") return stream;
      return this.database.client.liveStream.update({
        where: { id: stream.id },
        data: {
          status: "LIVE",
          playbackUrl: evidence.playbackUrl ?? stream.playbackUrl,
          startedAt: stream.startedAt ?? new Date(),
        },
      });
    }

    const providerEnded =
      evidence.state === "ENDED" ||
      evidence.state === "DISABLED" ||
      (evidence.state === "IDLE" && Boolean(stream.startedAt));
    if (providerEnded && stream.status !== "CANCELLED") {
      return this.database.client.liveStream.update({
        where: { id: stream.id },
        data: {
          status: "ENDED",
          playbackUrl: evidence.playbackUrl ?? stream.playbackUrl,
          endedAt: stream.endedAt ?? new Date(),
        },
      });
    }

    if (evidence.playbackUrl && evidence.playbackUrl !== stream.playbackUrl) {
      return this.database.client.liveStream.update({
        where: { id: stream.id },
        data: { playbackUrl: evidence.playbackUrl },
      });
    }
    return stream;
  }

  private async applyWebhookEvent(
    stream: LiveStream,
    event: LiveProviderWebhookEvent,
  ) {
    if (event.kind === "PLAYABLE") {
      if (stream.status === "ENDED" || stream.status === "CANCELLED") return stream;
      return this.database.client.liveStream.update({
        where: { id: stream.id },
        data: {
          status: "LIVE",
          startedAt: stream.startedAt ?? event.occurredAt,
        },
      });
    }

    if (event.kind === "ENDED" && stream.status !== "CANCELLED") {
      return this.database.client.liveStream.update({
        where: { id: stream.id },
        data: {
          status: "ENDED",
          endedAt: stream.endedAt ?? event.occurredAt,
        },
      });
    }

    if (event.kind === "ERROR" && event.fatal) {
      return this.database.client.liveStream.update({
        where: { id: stream.id },
        data: { status: "FAILED" },
      });
    }
    return stream;
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
  const { streamKeyHash, ...safe } = stream;
  void streamKeyHash;
  return safe;
}
