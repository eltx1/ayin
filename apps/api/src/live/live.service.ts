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
    this.assertProviderProvisioningEnabled();
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
    this.assertProviderProvisioningEnabled();

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
          providerRecordingAssetId: stream.providerRecordingAssetId,
          recordingHandoffStatus: stream.recordingHandoffStatus,
          recordingMediaAssetId: stream.recordingMediaAssetId,
          recordingR2ObjectKey: stream.recordingR2ObjectKey,
          recordingProviderDeletedAt: stream.recordingProviderDeletedAt,
          recordingHandoffError: stream.recordingHandoffError,
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
          providerRecordingAssetId: stream.providerRecordingAssetId,
          recordingHandoffStatus: stream.recordingHandoffStatus,
          recordingMediaAssetId: stream.recordingMediaAssetId,
          recordingR2ObjectKey: stream.recordingR2ObjectKey,
          recordingProviderDeletedAt: stream.recordingProviderDeletedAt,
          recordingHandoffError: stream.recordingHandoffError,
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

    if (event.kind === "IGNORED") {
      return { accepted: true, ignored: true, eventId: event.eventId, event: event.kind };
    }

    let stream = await this.findStreamForProviderEvent(event);

    if (event.kind === "RECORDING_READY") {
      const recording = event.recording;
      if (!recording?.providerAssetId || !recording.renditionName) {
        throw new LiveError(
          "LIVE_RECORDING_METADATA_INVALID",
          "Mux reported a ready recording without an asset ID or rendition name.",
          502,
        );
      }

      if (
        stream &&
        (this.isStaleRecordingEvent(stream, event) ||
          (stream.providerRecordingAssetId === recording.providerAssetId &&
            stream.recordingHandoffStatus === "READY" &&
            Boolean(stream.recordingProviderDeletedAt)))
      ) {
        return {
          accepted: true,
          ignored: true,
          eventId: event.eventId,
          event: event.kind,
          stream: stripSecretHash(stream),
        };
      }

      try {
        const enriched = await this.provider.retrieveRecording(
          recording.providerAssetId,
          recording.renditionName,
        );
        event = {
          ...event,
          activeAssetId: enriched.providerAssetId,
          recording: enriched,
        };
      } catch (error) {
        this.throwProviderError(error);
      }
      stream ??= await this.findStreamForProviderEvent(event);
    }

    if (!stream) {
      return { accepted: true, ignored: true, eventId: event.eventId, event: event.kind };
    }

    if (event.kind === "RECORDING_READY") {
      const result = await this.handleRecordingReady(stream, event);
      return {
        accepted: true,
        ignored: result.ignored,
        eventId: event.eventId,
        event: event.kind,
        stream: stripSecretHash(result.stream),
      };
    }

    const result = await this.applyOrderedWebhookEvent(stream.id, event);
    return {
      accepted: true,
      ignored: result.ignored,
      eventId: event.eventId,
      event: event.kind,
      stream: stripSecretHash(result.stream),
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

  private assertProviderProvisioningEnabled() {
    this.assertProviderConfigured();
    if (!this.provider.diagnostics().productionEnabled) {
      throw new LiveError(
        "LIVE_PROVIDER_PROVISIONING_DISABLED",
        "New live provisioning and credential rotation are disabled by the provider kill switch.",
        503,
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

  private async findStreamForProviderEvent(event: LiveProviderWebhookEvent) {
    if (event.providerStreamId) {
      return this.database.client.liveStream.findFirst({
        where: {
          providerKey: this.provider.key,
          providerStreamId: event.providerStreamId,
        },
      });
    }
    if (event.recording?.ayinStreamId) {
      return this.database.client.liveStream.findFirst({
        where: {
          id: event.recording.ayinStreamId,
          providerKey: this.provider.key,
        },
      });
    }
    if (event.recording?.providerAssetId) {
      return this.database.client.liveStream.findFirst({
        where: {
          providerKey: this.provider.key,
          providerRecordingAssetId: event.recording.providerAssetId,
        },
      });
    }
    return null;
  }

  private async applyOrderedWebhookEvent(streamId: string, event: LiveProviderWebhookEvent) {
    return this.database.client.$transaction(
      async (transaction) => {
        await this.acquireProviderMutationLock(transaction, streamId);
        const stream = await transaction.liveStream.findUnique({ where: { id: streamId } });
        if (!stream) throw new LiveError("LIVE_NOT_FOUND", "Live stream not found.", 404);
        const recordingEvent = Boolean(event.recording);
        if (
          recordingEvent
            ? this.isStaleRecordingEvent(stream, event)
            : this.isStaleProviderEvent(stream, event)
        ) {
          return { ignored: true, stream };
        }

        const data: Prisma.LiveStreamUpdateInput = {
          ...(recordingEvent
            ? {
                recordingLastEventAt: event.occurredAt,
                recordingLastEventId: event.eventId,
              }
            : {
                providerLastEventAt: event.occurredAt,
                providerLastEventId: event.eventId,
              }),
          ...(event.activeAssetId
            ? {
                providerRecordingAssetId: event.activeAssetId,
                ...(stream.recordingHandoffStatus === "NONE"
                  ? { recordingHandoffStatus: "WAITING" as const }
                  : {}),
              }
            : {}),
        };

        if (
          event.kind === "PLAYABLE" &&
          stream.status !== "ENDED" &&
          stream.status !== "CANCELLED"
        ) {
          data.status = "LIVE";
          data.startedAt = stream.startedAt ?? event.occurredAt;
        } else if (event.kind === "ENDED" && stream.status !== "CANCELLED") {
          data.status = "ENDED";
          data.endedAt = stream.endedAt ?? event.occurredAt;
        } else if (event.kind === "RECORDING_FINALIZED" && event.recording) {
          data.providerRecordingAssetId = event.recording.providerAssetId;
          if (
            stream.recordingHandoffStatus !== "READY" &&
            stream.recordingHandoffStatus !== "CLEANUP_PENDING"
          ) {
            data.recordingHandoffStatus = "WAITING";
          }
        } else if (event.kind === "ERROR" && event.fatal && event.recording) {
          data.providerRecordingAssetId = event.recording.providerAssetId;
          data.recordingHandoffStatus = "FAILED";
          data.recordingHandoffError = "Mux recording asset processing failed.";
        } else if (event.kind === "ERROR" && event.fatal) {
          data.status = "FAILED";
        }

        const updated = await transaction.liveStream.update({
          where: { id: stream.id },
          data,
        });
        return { ignored: false, stream: updated };
      },
      { timeout: 30_000 },
    );
  }

  private async handleRecordingReady(stream: LiveStream, event: LiveProviderWebhookEvent) {
    const recording = event.recording;
    if (!recording?.downloadUrl || !recording.renditionName) {
      throw new LiveError(
        "LIVE_RECORDING_DOWNLOAD_UNAVAILABLE",
        "Mux reported a ready recording without a downloadable static rendition.",
        502,
      );
    }

    return this.database.client.$transaction(
      async (transaction) => {
        await this.acquireProviderMutationLock(transaction, stream.id);
        const current = await transaction.liveStream.findUnique({ where: { id: stream.id } });
        if (!current) throw new LiveError("LIVE_NOT_FOUND", "Live stream not found.", 404);

        const sameAsset = current.providerRecordingAssetId === recording.providerAssetId;
        if (
          sameAsset &&
          current.recordingHandoffStatus === "READY" &&
          current.recordingProviderDeletedAt
        ) {
          return { ignored: true, stream: current };
        }
        if (
          current.recordingHandoffStatus !== "FAILED" &&
          current.recordingHandoffStatus !== "CLEANUP_PENDING" &&
          this.isStaleRecordingEvent(current, event)
        ) {
          return { ignored: true, stream: current };
        }

        const updated = await transaction.liveStream.update({
          where: { id: current.id },
          data: {
            recordingLastEventAt: event.occurredAt,
            recordingLastEventId: event.eventId,
            providerRecordingAssetId: recording.providerAssetId,
            recordingProviderDownloadUrl: recording.downloadUrl,
            recordingRenditionName: recording.renditionName,
            ...(current.recordingHandoffStatus === "READY" ||
            current.recordingHandoffStatus === "CLEANUP_PENDING"
              ? {}
              : {
                  recordingHandoffStatus: "WAITING",
                  recordingHandoffStartedAt: null,
                  recordingHandoffError: null,
                }),
          },
        });
        return { ignored: false, stream: updated };
      },
      { timeout: 30_000 },
    );
  }

  private isStaleProviderEvent(stream: LiveStream, event: LiveProviderWebhookEvent) {
    if (stream.providerLastEventId === event.eventId) return true;
    return Boolean(
      stream.providerLastEventAt &&
      event.occurredAt.getTime() < stream.providerLastEventAt.getTime(),
    );
  }

  private isStaleRecordingEvent(stream: LiveStream, event: LiveProviderWebhookEvent) {
    if (stream.recordingLastEventId === event.eventId) return true;
    return Boolean(
      stream.recordingLastEventAt &&
      event.occurredAt.getTime() < stream.recordingLastEventAt.getTime(),
    );
  }

  private async applyProviderEvidence(stream: LiveStream, evidence: LiveProviderStatus) {
    const observedAt = new Date();
    if (evidence.playable) {
      if (stream.status === "ENDED" || stream.status === "CANCELLED") return stream;
      return this.database.client.liveStream.update({
        where: { id: stream.id },
        data: {
          status: "LIVE",
          playbackUrl: evidence.playbackUrl ?? stream.playbackUrl,
          startedAt: stream.startedAt ?? observedAt,
          providerLastEventAt: observedAt,
          providerLastEventId: null,
          ...(evidence.activeAssetId
            ? {
                providerRecordingAssetId: evidence.activeAssetId,
                ...(stream.recordingHandoffStatus === "NONE"
                  ? { recordingHandoffStatus: "WAITING" as const }
                  : {}),
              }
            : {}),
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
          endedAt: stream.endedAt ?? observedAt,
          providerLastEventAt: observedAt,
          providerLastEventId: null,
        },
      });
    }

    if (evidence.playbackUrl && evidence.playbackUrl !== stream.playbackUrl) {
      return this.database.client.liveStream.update({
        where: { id: stream.id },
        data: {
          playbackUrl: evidence.playbackUrl,
          providerLastEventAt: observedAt,
          providerLastEventId: null,
        },
      });
    }
    return this.database.client.liveStream.update({
      where: { id: stream.id },
      data: {
        providerLastEventAt: observedAt,
        providerLastEventId: null,
      },
    });
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

type PublicLiveStream = Omit<
  LiveStream,
  | "streamKeyHash"
  | "providerLastEventAt"
  | "providerLastEventId"
  | "recordingLastEventAt"
  | "recordingLastEventId"
  | "providerRecordingAssetId"
  | "recordingHandoffStatus"
  | "recordingR2ObjectKey"
  | "recordingMediaAssetId"
  | "recordingProviderDownloadUrl"
  | "recordingRenditionName"
  | "recordingHandoffAttempt"
  | "recordingHandoffStartedAt"
  | "recordingHandoffHeartbeatAt"
  | "recordingHandoffAt"
  | "recordingProviderDeletedAt"
  | "recordingHandoffError"
>;

function stripSecretHash(stream: LiveStream): PublicLiveStream {
  const {
    streamKeyHash,
    providerLastEventAt,
    providerLastEventId,
    recordingLastEventAt,
    recordingLastEventId,
    providerRecordingAssetId,
    recordingHandoffStatus,
    recordingR2ObjectKey,
    recordingMediaAssetId,
    recordingProviderDownloadUrl,
    recordingRenditionName,
    recordingHandoffAttempt,
    recordingHandoffStartedAt,
    recordingHandoffHeartbeatAt,
    recordingHandoffAt,
    recordingProviderDeletedAt,
    recordingHandoffError,
    ...safe
  } = stream;
  void streamKeyHash;
  void providerLastEventAt;
  void providerLastEventId;
  void recordingLastEventAt;
  void recordingLastEventId;
  void providerRecordingAssetId;
  void recordingHandoffStatus;
  void recordingR2ObjectKey;
  void recordingMediaAssetId;
  void recordingProviderDownloadUrl;
  void recordingRenditionName;
  void recordingHandoffAttempt;
  void recordingHandoffStartedAt;
  void recordingHandoffHeartbeatAt;
  void recordingHandoffAt;
  void recordingProviderDeletedAt;
  void recordingHandoffError;
  return safe;
}
