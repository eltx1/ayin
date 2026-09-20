import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { LiveProviderOperationError } from "./live-provider.js";
import {
  MuxLiveIngestProvider,
  normalizeMuxWebhook,
  verifyMuxSignature,
} from "./mux-live-provider.js";

const enabledEnvironment = {
  MUX_TOKEN_ID: "mux-token-id",
  MUX_TOKEN_SECRET: "mux-token-secret",
  MUX_WEBHOOK_SIGNING_SECRET: "mux-webhook-secret",
  MUX_LIVE_PRODUCTION_ENABLED: "1",
} as const;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function liveStreamFixture(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: "mux-live-1",
      stream_key: "one-time-stream-key",
      srt_passphrase: "one-time-srt-passphrase",
      status: "idle",
      playback_ids: [{ id: "playback-1", policy: "public" }],
      ...overrides,
    },
  };
}

describe("MuxLiveIngestProvider", () => {
  it("requires API credentials, webhook verification, and the explicit production enable gate", () => {
    const disabled = new MuxLiveIngestProvider({
      MUX_TOKEN_ID: "id",
      MUX_TOKEN_SECRET: "secret",
    });
    expect(disabled.configured).toBe(false);
    expect(disabled.diagnostics()).toMatchObject({
      key: "mux",
      configured: false,
      productionEnabled: false,
      apiCredentialsConfigured: true,
      webhookVerificationConfigured: false,
    });
    expect(disabled.diagnostics().missingConfiguration).toEqual([
      "MUX_WEBHOOK_SIGNING_SECRET",
      "MUX_LIVE_PRODUCTION_ENABLED=1",
    ]);

    const enabled = new MuxLiveIngestProvider(enabledEnvironment);
    expect(enabled.configured).toBe(true);
    expect(enabled.capabilities()).toMatchObject({
      ingestProtocols: ["RTMPS", "SRT"],
      playbackProtocols: ["HLS", "LL_HLS"],
      supportsKeyRotation: true,
      webhookVerification: "SIGNED",
    });
  });

  it("provisions one-time encoder credentials and safe provider identifiers", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(liveStreamFixture(), 201));
    const provider = new MuxLiveIngestProvider(enabledEnvironment, fetchImpl);

    const result = await provider.provision({
      streamId: "ayin-stream-1",
      channelId: "channel-1",
      title: "Task 73 live",
    });

    expect(result).toEqual({
      providerKey: "mux",
      providerStreamId: "mux-live-1",
      ingestEndpoint: "rtmps://global-live.mux.com:443/app",
      playbackUrl: "https://stream.mux.com/playback-1.m3u8",
      encoder: {
        rtmps: {
          serverUrl: "rtmps://global-live.mux.com:443/app",
          streamKey: "one-time-stream-key",
        },
        srt: {
          url: "srt://global-live.mux.com:6001?streamid=one-time-stream-key&passphrase=one-time-srt-passphrase",
        },
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const request = fetchImpl.mock.calls[0];
    expect(request?.[0]).toBe("https://api.mux.com/video/v1/live-streams");
    const body = JSON.parse(String(request?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      playback_policies: ["public"],
      latency_mode: "low",
      reconnect_window: 60,
    });
    expect(JSON.stringify(body)).not.toContain("one-time-stream-key");
    expect(JSON.stringify(provider.diagnostics())).not.toContain("mux-token-secret");
    expect(JSON.stringify(provider.diagnostics())).not.toContain("mux-webhook-secret");
  });

  it("never exposes provider secrets from status synchronization", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          liveStreamFixture({
            status: "active",
            active_asset_id: "asset-live-1",
            connected: true,
            recording: true,
          }),
        ),
      );
    const provider = new MuxLiveIngestProvider(enabledEnvironment, fetchImpl);

    const status = await provider.retrieveStatus("mux-live-1");

    expect(status).toEqual({
      providerKey: "mux",
      providerStreamId: "mux-live-1",
      state: "PLAYABLE",
      playable: true,
      connected: true,
      recording: true,
      playbackUrl: "https://stream.mux.com/playback-1.m3u8",
      activeAssetId: "asset-live-1",
    });
    expect(JSON.stringify(status)).not.toContain("one-time-stream-key");
    expect(JSON.stringify(status)).not.toContain("one-time-srt-passphrase");
  });

  it("rotates credentials once and disables the provider resource on stop", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          liveStreamFixture({
            stream_key: "rotated-stream-key",
            srt_passphrase: "rotated-passphrase",
          }),
          201,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ data: {} }));
    const provider = new MuxLiveIngestProvider(enabledEnvironment, fetchImpl);

    const rotated = await provider.rotateKey("mux-live-1");
    expect(rotated.encoder.rtmps.streamKey).toBe("rotated-stream-key");
    expect(rotated.encoder.srt?.url).toContain("rotated-passphrase");

    await expect(provider.stop("mux-live-1")).resolves.toBeUndefined();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://api.mux.com/video/v1/live-streams/mux-live-1/reset-stream-key",
    );
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      "https://api.mux.com/video/v1/live-streams/mux-live-1/disable",
    );
    expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe("PUT");
  });

  it("verifies signed raw webhook bodies and normalizes the live lifecycle", () => {
    const now = 1_800_000_000_000;
    const timestamp = Math.floor(now / 1000);
    const body = JSON.stringify({
      id: "event-active-1",
      type: "video.live_stream.active",
      created_at: String(timestamp),
      data: { id: "mux-live-1" },
    });
    const signature = createHmac("sha256", enabledEnvironment.MUX_WEBHOOK_SIGNING_SECRET)
      .update(`${timestamp}.${body}`)
      .digest("hex");

    const provider = new MuxLiveIngestProvider(
      enabledEnvironment,
      vi.fn(),
      () => now,
    );
    expect(provider.verifyWebhook(body, `t=${timestamp},v1=${signature}`)).toMatchObject({
      eventId: "event-active-1",
      providerStreamId: "mux-live-1",
      kind: "PLAYABLE",
      playable: true,
    });

    expect(
      normalizeMuxWebhook({
        id: "connected",
        type: "video.live_stream.connected",
        data: { id: "mux-live-1" },
      }).kind,
    ).toBe("CONNECTED");
    expect(
      normalizeMuxWebhook({
        id: "recording",
        type: "video.live_stream.recording",
        data: { id: "mux-live-1" },
      }).kind,
    ).toBe("STARTED");
    expect(
      normalizeMuxWebhook({
        id: "disconnected",
        type: "video.live_stream.disconnected",
        data: { id: "mux-live-1" },
      }).kind,
    ).toBe("DISCONNECTED");
    expect(
      normalizeMuxWebhook({
        id: "idle",
        type: "video.live_stream.idle",
        data: { id: "mux-live-1" },
      }).kind,
    ).toBe("ENDED");
    expect(
      normalizeMuxWebhook({
        id: "warning",
        type: "video.live_stream.warning",
        data: { id: "mux-live-1" },
      }).kind,
    ).toBe("ERROR");
  });

  it("rejects forged and stale webhook signatures", () => {
    const now = 1_800_000_000_000;
    const timestamp = Math.floor(now / 1000);
    expect(() =>
      verifyMuxSignature("{}", `t=${timestamp},v1=not-valid`, "webhook-secret", now),
    ).toThrow(LiveProviderOperationError);

    const staleTimestamp = timestamp - 301;
    const staleBody = "{}";
    const staleSignature = createHmac("sha256", "webhook-secret")
      .update(`${staleTimestamp}.${staleBody}`)
      .digest("hex");
    expect(() =>
      verifyMuxSignature(
        staleBody,
        `t=${staleTimestamp},v1=${staleSignature}`,
        "webhook-secret",
        now,
      ),
    ).toThrow(/outside the allowed tolerance/);
  });

  it("sanitizes provider API failures instead of returning response bodies", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            messages: ["secret provider diagnostic that must not be surfaced"],
          },
        },
        500,
      ),
    );
    const provider = new MuxLiveIngestProvider(enabledEnvironment, fetchImpl);

    await expect(
      provider.provision({ streamId: "s", channelId: "c", title: "t" }),
    ).rejects.toMatchObject({
      code: "MUX_API_REQUEST_FAILED",
      message: "Mux API request failed with HTTP 500.",
    });
  });
});
