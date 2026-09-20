import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { DatabaseService } from "../database/database.service.js";
import {
  type LiveIngestProvider,
  type LiveProviderStatus,
  LiveProviderUnavailableError,
} from "./live-provider.js";
import { LiveError, LiveService } from "./live.service.js";

const baseStream = {
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
  return {
    database: {
      client: {
        channelMember: {
          findFirst: vi.fn(async () => ({
            channel: { id: "channel-1", handle: "fixture", name: "Fixture" },
          })),
        },
        liveStream: {
          findFirst: vi.fn(async () => ({ ...baseStream })),
          update,
        },
      },
    } as unknown as DatabaseService,
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
    stop: vi.fn(async () => undefined),
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
    expect(update).not.toHaveBeenCalled();
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

  it("persists only a hash of the one-time provider stream key", async () => {
    const { database, update } = databaseFixture();
    const provider = providerFixture(statusFixture("IDLE"));
    const unprovisioned = {
      ...baseStream,
      status: "DRAFT",
      providerKey: "unconfigured",
      providerStreamId: null,
      streamKeyHash: null,
      ingestEndpoint: null,
      playbackUrl: null,
    };
    (
      database.client.liveStream.findFirst as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(unprovisioned);
    const service = new LiveService(database, provider);

    const result = await service.provision("account-1", "stream-1");
    const expectedHash = createHash("sha256")
      .update("raw-one-time-stream-key")
      .digest("hex");

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
