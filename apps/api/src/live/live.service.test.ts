import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { LiveStream } from "@ayin/db";

import type { DatabaseService } from "../database/database.service.js";
import {
  type LiveIngestProvider,
  type LiveProviderStatus,
  type LiveProviderWebhookEvent,
  LiveProviderUnavailableError,
} from "./live-provider.js";
import { type LiveError, LiveService } from "./live.service.js";

const baseStream: LiveStream = {
  id: "stream-1",
  channelId: "channel-1",
  createdByAccountId: "account-1",
  slug: "live-stream-1",
  title: "Live fixture",
  description: null,
  status: "READY",
  providerKey: "mux",
  providerStreamId: "mux-live-1",
  streamKeyHash: "existing-hash",
  ingestEndpoint: "rtmps://global-live.mux.com:443/app",
  playbackUrl: "https://stream.mux.com/playback-1.m3u8",
  providerLastEventAt: null,
  providerLastEventId: null,
  recordingLastEventAt: null,
  recordingLastEventId: null,
  providerRecordingAssetId: null,
  recordingHandoffStatus: "NONE",
  recordingR2ObjectKey: null,
  recordingMediaAssetId: null,
  recordingProviderDownloadUrl: null,
  recordingRenditionName: null,
  recordingHandoffAttempt: 0,
  recordingHandoffStartedAt: null,
  recordingHandoffHeartbeatAt: null,
  recordingHandoffAt: null,
  recordingProviderDeletedAt: null,
  recordingHandoffError: null,
  scheduledStartAt: null,
  startedAt: null,
  endedAt: null,
  chatEnabled: true,
  adBreaksEnabled: true,
  createdAt: new Date("2026-09-20T00:00:00.000Z"),
  updatedAt: new Date("2026-09-20T00:00:00.000Z"),
};

function databaseFixture() {
  const update = vi.fn(async (input: { data: Record<string, unknown> }) => ({
    ...baseStream,
    ...input.data,
  }));
  const findFirst = vi.fn(async (): Promise<LiveStream> => ({ ...baseStream }));
  const findUnique = vi.fn(async (): Promise<LiveStream> => ({ ...baseStream }));
  const mediaAssetUpsert = vi.fn(async () => ({ id: "media-asset-1" }));
  const queryRaw = vi.fn(async () => [{ locked: true }]);
  const transactionClient = {
    liveStream: {
      findFirst,
      findUnique,
      update,
    },
    mediaAsset: {
      upsert: mediaAssetUpsert,
    },
    $queryRaw: queryRaw,
  };
  const transaction = vi.fn(
    async (operation: (client: typeof transactionClient) => Promise<unknown>) =>
      operation(transactionClient),
  );
  return {
    database: {
      client: {
        channelMember: {
          findFirst: vi.fn(async () => ({
            channel: { id: "channel-1", handle: "fixture", name: "Fixture" },
          })),
        },
        liveStream: {
          findFirst,
          findUnique,
          update,
        },
        mediaAsset: {
          upsert: mediaAssetUpsert,
        },
        $transaction: transaction,
      },
    } as unknown as DatabaseService,
    findFirst,
    findUnique,
    mediaAssetUpsert,
    queryRaw,
    transaction,
    update,
  };
}

function providerFixture(status: LiveProviderStatus): LiveIngestProvider {
  return {
    key: "mux",
    configured: true,
    capabilities: () => ({
      ingestProtocols: ["RTMPS", "SRT"],
      playbackProtocols: ["HLS", "LL_HLS"],
      supportsKeyRotation: true,
      supportsRecording: true,
      webhookVerification: "SIGNED",
    }),
    provision: vi.fn(async () => ({
      providerKey: "mux",
      providerStreamId: "mux-live-1",
      ingestEndpoint: "rtmps://global-live.mux.com:443/app",
      playbackUrl: "https://stream.mux.com/playback-1.m3u8",
      encoder: {
        rtmps: {
          serverUrl: "rtmps://global-live.mux.com:443/app",
          streamKey: "raw-one-time-stream-key",
        },
      },
    })),
    rotateKey: vi.fn(async () => {
      throw new LiveProviderUnavailableError();
    }),
    retrieveStatus: vi.fn(async () => status),
    retrieveRecording: vi.fn(async (providerAssetId: string, renditionName: string) => ({
      providerAssetId,
      ayinStreamId: "stream-1",
      downloadUrl: `https://stream.mux.com/playback/${renditionName}`,
      renditionName,
    })),
    stop: vi.fn(async () => undefined),
    discard: vi.fn(async () => undefined),
    deleteRecordingAsset: vi.fn(async () => undefined),
    verifyWebhook: vi.fn(() => {
      throw new LiveProviderUnavailableError();
    }),
    diagnostics: () => ({
      key: "mux",
      configured: true,
      productionEnabled: true,
      apiCredentialsConfigured: true,
      webhookVerificationConfigured: true,
      missingConfiguration: [],
      ingestProtocols: ["RTMPS", "SRT"],
      playbackProtocols: ["HLS", "LL_HLS"],
      liveEvidencePolicy: "Mux active only",
    }),
  };
}

function statusFixture(state: LiveProviderStatus["state"], playable = false): LiveProviderStatus {
  return {
    providerKey: "mux",
    providerStreamId: "mux-live-1",
    state,
    playable,
    connected: state === "CONNECTED" || playable,
    recording: state === "RECORDING" || playable,
    playbackUrl: "https://stream.mux.com/playback-1.m3u8",
    activeAssetId: playable ? "asset-1" : null,
  };
}

describe("LiveService provider evidence policy", () => {
  it("does not mark a session LIVE when Mux has not confirmed playable output", async () => {
    const { database, update } = databaseFixture();
    const service = new LiveService(database, providerFixture(statusFixture("CONNECTED")));

    await expect(service.setState("account-1", "stream-1", "LIVE")).rejects.toMatchObject({
      code: "LIVE_PROVIDER_NOT_PLAYABLE",
      statusCode: 409,
    } satisfies Partial<LiveError>);
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "LIVE" }),
      }),
    );
  });

  it("marks a session LIVE only after provider PLAYABLE evidence", async () => {
    const { database, update } = databaseFixture();
    const service = new LiveService(database, providerFixture(statusFixture("PLAYABLE", true)));

    const result = await service.setState("account-1", "stream-1", "LIVE");

    expect(result.status).toBe("LIVE");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "LIVE",
          playbackUrl: "https://stream.mux.com/playback-1.m3u8",
        }),
      }),
    );
  });

  it("rejects overlapping provider credential operations before calling Mux", async () => {
    const { database, queryRaw } = databaseFixture();
    queryRaw.mockResolvedValue([{ locked: false }]);
    const provider = providerFixture(statusFixture("IDLE"));
    const service = new LiveService(database, provider);

    await expect(service.rotateKey("account-1", "stream-1")).rejects.toMatchObject({
      code: "LIVE_PROVIDER_OPERATION_IN_PROGRESS",
      statusCode: 409,
    });
    expect(provider.rotateKey).not.toHaveBeenCalled();
  });

  it("deletes a newly created Mux resource if the database write cannot be committed", async () => {
    const { database, findFirst, update } = databaseFixture();
    findFirst.mockResolvedValue({
      ...baseStream,
      status: "DRAFT",
      providerKey: "unconfigured",
      providerStreamId: null,
      streamKeyHash: null,
      ingestEndpoint: null,
      playbackUrl: null,
    });
    update.mockRejectedValueOnce(new Error("database write failed"));
    const provider = providerFixture(statusFixture("IDLE"));
    const service = new LiveService(database, provider);

    await expect(service.provision("account-1", "stream-1")).rejects.toThrow(
      "database write failed",
    );
    expect(provider.discard).toHaveBeenCalledWith("mux-live-1");
  });

  it("ignores an older lifecycle webhook after newer provider evidence", async () => {
    const { database, findFirst, findUnique, update } = databaseFixture();
    const current = {
      ...baseStream,
      status: "LIVE" as const,
      providerLastEventAt: new Date("2026-09-20T02:00:00.000Z"),
      providerLastEventId: "newer-active",
    };
    findFirst.mockResolvedValue(current);
    findUnique.mockResolvedValue(current);
    const provider = providerFixture(statusFixture("PLAYABLE", true));
    provider.verifyWebhook = vi.fn((): LiveProviderWebhookEvent => ({
      eventId: "older-idle",
      providerStreamId: "mux-live-1",
      kind: "ENDED",
      rawType: "video.live_stream.idle",
      occurredAt: new Date("2026-09-20T01:59:00.000Z"),
      playable: false,
      fatal: false,
      activeAssetId: "asset-1",
      recording: null,
    }));
    const service = new LiveService(database, provider);

    const result = await service.handleProviderWebhook("{}", "signed");

    expect(result.ignored).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  it("ignores a duplicate ready-recording webhook after the Mux asset was cleaned up", async () => {
    const { database, findFirst, findUnique } = databaseFixture();
    const current = {
      ...baseStream,
      status: "ENDED" as const,
      providerRecordingAssetId: "asset-1",
      recordingLastEventAt: new Date("2026-09-20T02:10:00.000Z"),
      recordingLastEventId: "rendition-ready-1",
      recordingHandoffStatus: "READY" as const,
      recordingProviderDeletedAt: new Date("2026-09-20T02:15:00.000Z"),
    };
    findFirst.mockResolvedValue(current);
    findUnique.mockResolvedValue(current);
    const provider = providerFixture(statusFixture("IDLE"));
    provider.verifyWebhook = vi.fn(
      (): LiveProviderWebhookEvent => ({
        eventId: "rendition-ready-1",
        providerStreamId: null,
        kind: "RECORDING_READY",
        rawType: "video.asset.static_rendition.ready",
        occurredAt: new Date("2026-09-20T02:10:00.000Z"),
        playable: false,
        fatal: false,
        activeAssetId: "asset-1",
        recording: {
          providerAssetId: "asset-1",
          ayinStreamId: null,
          downloadUrl: null,
          renditionName: "highest.mp4",
        },
      }),
    );
    const service = new LiveService(database, provider);

    const result = await service.handleProviderWebhook("{}", "signed");

    expect(result.ignored).toBe(true);
    expect(provider.retrieveRecording).not.toHaveBeenCalled();
  });

  it("does not let a newer live lifecycle clock suppress an independent recording event", async () => {
    const { database, findFirst, findUnique, update } = databaseFixture();
    const current = {
      ...baseStream,
      status: "ENDED" as const,
      providerLastEventAt: new Date("2026-09-20T02:20:00.000Z"),
      providerLastEventId: "newer-live-idle",
      recordingLastEventAt: new Date("2026-09-20T02:00:00.000Z"),
      recordingLastEventId: "recording-finalized",
      providerRecordingAssetId: "asset-1",
      recordingHandoffStatus: "WAITING" as const,
    };
    findFirst.mockResolvedValue(current);
    findUnique.mockResolvedValue(current);
    const provider = providerFixture(statusFixture("IDLE"));
    provider.verifyWebhook = vi.fn((): LiveProviderWebhookEvent => ({
      eventId: "rendition-ready-cross-clock",
      providerStreamId: null,
      kind: "RECORDING_READY",
      rawType: "video.asset.static_rendition.ready",
      occurredAt: new Date("2026-09-20T02:10:00.000Z"),
      playable: false,
      fatal: false,
      activeAssetId: "asset-1",
      recording: {
        providerAssetId: "asset-1",
        ayinStreamId: null,
        downloadUrl: null,
        renditionName: "highest.mp4",
      },
    }));
    const service = new LiveService(database, provider);

    const result = await service.handleProviderWebhook("{}", "signed");

    expect(result.ignored).toBe(false);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordingLastEventId: "rendition-ready-cross-clock",
          recordingProviderDownloadUrl: "https://stream.mux.com/playback/highest.mp4",
        }),
      }),
    );
  });

  it("enqueues a ready Mux recording without blocking the webhook on file transfer", async () => {
    const { database, findFirst, findUnique, update } = databaseFixture();
    const current = {
      ...baseStream,
      status: "ENDED" as const,
      providerRecordingAssetId: "asset-1",
      recordingHandoffStatus: "WAITING" as const,
    };
    findFirst.mockResolvedValue(current);
    findUnique.mockResolvedValue(current);
    const provider = providerFixture(statusFixture("IDLE"));
    provider.verifyWebhook = vi.fn((): LiveProviderWebhookEvent => ({
      eventId: "rendition-ready-1",
      providerStreamId: null,
      kind: "RECORDING_READY",
      rawType: "video.asset.static_rendition.ready",
      occurredAt: new Date("2026-09-20T02:10:00.000Z"),
      playable: false,
      fatal: false,
      activeAssetId: "asset-1",
      recording: {
        providerAssetId: "asset-1",
        ayinStreamId: null,
        downloadUrl: null,
        renditionName: "highest.mp4",
      },
    }));
    const service = new LiveService(database, provider);

    const result = await service.handleProviderWebhook("{}", "signed");

    expect(result.ignored).toBe(false);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerRecordingAssetId: "asset-1",
          recordingProviderDownloadUrl: "https://stream.mux.com/playback/highest.mp4",
          recordingRenditionName: "highest.mp4",
          recordingHandoffStatus: "WAITING",
        }),
      }),
    );
    expect(provider.deleteRecordingAsset).not.toHaveBeenCalled();
  });

  it("persists only a hash of the one-time provider stream key", async () => {
    const { database, findFirst, update } = databaseFixture();
    const provider = providerFixture(statusFixture("IDLE"));
    const unprovisioned: LiveStream = {
      ...baseStream,
      status: "DRAFT",
      providerKey: "unconfigured",
      providerStreamId: null,
      streamKeyHash: null,
      ingestEndpoint: null,
      playbackUrl: null,
    };
    findFirst.mockResolvedValue(unprovisioned);
    const service = new LiveService(database, provider);

    const result = await service.provision("account-1", "stream-1");
    const expectedHash = createHash("sha256").update("raw-one-time-stream-key").digest("hex");

    expect(result.encoder.rtmps.streamKey).toBe("raw-one-time-stream-key");
    expect(result.stream).not.toHaveProperty("streamKeyHash");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          streamKeyHash: expectedHash,
          providerStreamId: "mux-live-1",
          status: "READY",
        }),
      }),
    );
    expect(JSON.stringify(update.mock.calls)).not.toContain('"raw-one-time-stream-key"');
  });
});
