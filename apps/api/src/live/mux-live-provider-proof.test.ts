import { describe, expect, it, vi } from "vitest";

import {
  muxTask72ProofRequestBody,
  runMuxTask72ControlPlaneProof,
} from "./mux-live-provider-proof.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Mux Task 72 control-plane proof", () => {
  it("does not touch the network without credentials", async () => {
    const fetchImpl = vi.fn();
    await expect(runMuxTask72ControlPlaneProof({}, fetchImpl)).resolves.toEqual({
      status: "BLOCKED",
      provider: "mux",
      reason: "MUX_CREDENTIALS_UNAVAILABLE",
      networkAttempted: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires an explicit proof opt-in even when credentials exist", async () => {
    const fetchImpl = vi.fn();
    await expect(
      runMuxTask72ControlPlaneProof({ MUX_TOKEN_ID: "id", MUX_TOKEN_SECRET: "secret" }, fetchImpl),
    ).resolves.toMatchObject({
      status: "BLOCKED",
      reason: "MUX_PROOF_NOT_OPTED_IN",
      networkAttempted: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses Mux test mode, verifies rotation, and deletes the proof stream", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              id: "live-proof-1",
              stream_key: "initial-secret-key",
              playback_ids: [{ id: "playback-proof-1", policy: "public" }],
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              id: "live-proof-1",
              stream_key: "rotated-secret-key",
              playback_ids: [{ id: "playback-proof-1", policy: "public" }],
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await runMuxTask72ControlPlaneProof(
      {
        MUX_TOKEN_ID: "test-token-id",
        MUX_TOKEN_SECRET: "test-token-secret",
        MUX_TASK72_PROOF: "1",
      },
      fetchImpl,
    );

    expect(result).toEqual({
      status: "VERIFIED",
      provider: "mux",
      networkAttempted: true,
      testMode: true,
      liveStreamCreated: true,
      keyRotationVerified: true,
      cleanupVerified: true,
      playbackIdPresent: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual(
      muxTask72ProofRequestBody(),
    );
    expect(JSON.stringify(result)).not.toContain("initial-secret-key");
    expect(JSON.stringify(result)).not.toContain("rotated-secret-key");
  });
});
