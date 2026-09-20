import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { MuxLiveIngestProvider } from "../src/live/mux-live-provider.js";

describe("Mux live provider deterministic integration", () => {
  it("executes provision, playable sync, credential rotation, signed webhook, and stop", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    let currentKey = "fixture-key-1";
    let disabled = false;

    const fetchFixture = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });

      if (url.endsWith("/live-streams") && method === "POST") {
        return jsonResponse(
          liveResource({
            stream_key: currentKey,
            srt_passphrase: "fixture-passphrase-1",
            status: "idle",
          }),
          201,
        );
      }

      if (url.endsWith("/live-streams/mux-fixture-1") && method === "GET") {
        return jsonResponse(
          liveResource({
            stream_key: currentKey,
            srt_passphrase: "fixture-passphrase-private",
            status: disabled ? "disabled" : "active",
            active_asset_id: disabled ? null : "asset-fixture-1",
            connected: !disabled,
            recording: !disabled,
          }),
        );
      }

      if (url.endsWith("/live-streams/mux-fixture-1/reset-stream-key") && method === "POST") {
        currentKey = "fixture-key-2";
        return jsonResponse(
          liveResource({
            stream_key: currentKey,
            srt_passphrase: "fixture-passphrase-2",
            status: "active",
          }),
          201,
        );
      }

      if (url.endsWith("/live-streams/mux-fixture-1/disable") && method === "PUT") {
        disabled = true;
        return jsonResponse({ data: {} });
      }

      return jsonResponse({ error: { type: "fixture_not_found" } }, 404);
    };

    const now = 1_800_000_000_000;
    const environment = {
      MUX_TOKEN_ID: "fixture-token-id",
      MUX_TOKEN_SECRET: "fixture-token-secret",
      MUX_WEBHOOK_SIGNING_SECRET: "fixture-webhook-secret",
      MUX_LIVE_PRODUCTION_ENABLED: "1",
    };
    const provider = new MuxLiveIngestProvider(environment, fetchFixture, () => now);

    const provisioned = await provider.provision({
      streamId: "ayin-live-1",
      channelId: "ayin-channel-1",
      title: "Provider fixture",
    });
    expect(provisioned.providerStreamId).toBe("mux-fixture-1");
    expect(provisioned.encoder.rtmps.streamKey).toBe("fixture-key-1");
    expect(provisioned.playbackUrl).toBe("https://stream.mux.com/playback-fixture-1.m3u8");

    const status = await provider.retrieveStatus(provisioned.providerStreamId);
    expect(status).toMatchObject({
      state: "PLAYABLE",
      playable: true,
      activeAssetId: "asset-fixture-1",
    });
    expect(JSON.stringify(status)).not.toContain("fixture-key-1");
    expect(JSON.stringify(status)).not.toContain("fixture-passphrase-private");

    const rotated = await provider.rotateKey(provisioned.providerStreamId);
    expect(rotated.encoder.rtmps.streamKey).toBe("fixture-key-2");
    expect(rotated.encoder.rtmps.streamKey).not.toBe(provisioned.encoder.rtmps.streamKey);

    const webhookBody = JSON.stringify({
      id: "fixture-event-active",
      type: "video.live_stream.active",
      created_at: String(Math.floor(now / 1000)),
      data: { id: "mux-fixture-1" },
    });
    const timestamp = Math.floor(now / 1000);
    const signature = createHmac("sha256", environment.MUX_WEBHOOK_SIGNING_SECRET)
      .update(`${timestamp}.${webhookBody}`)
      .digest("hex");
    expect(
      provider.verifyWebhook(webhookBody, `t=${timestamp},v1=${signature}`),
    ).toMatchObject({
      providerStreamId: "mux-fixture-1",
      kind: "PLAYABLE",
      playable: true,
    });

    await provider.stop(provisioned.providerStreamId);
    const stopped = await provider.retrieveStatus(provisioned.providerStreamId);
    expect(stopped).toMatchObject({ state: "DISABLED", playable: false });

    expect(calls).toEqual([
      { url: "https://api.mux.com/video/v1/live-streams", method: "POST" },
      { url: "https://api.mux.com/video/v1/live-streams/mux-fixture-1", method: "GET" },
      {
        url: "https://api.mux.com/video/v1/live-streams/mux-fixture-1/reset-stream-key",
        method: "POST",
      },
      {
        url: "https://api.mux.com/video/v1/live-streams/mux-fixture-1/disable",
        method: "PUT",
      },
      { url: "https://api.mux.com/video/v1/live-streams/mux-fixture-1", method: "GET" },
    ]);
  });
});

function liveResource(overrides: Record<string, unknown>) {
  return {
    data: {
      id: "mux-fixture-1",
      playback_ids: [{ id: "playback-fixture-1", policy: "public" }],
      ...overrides,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
