export interface MuxProofEnvironment {
  MUX_TOKEN_ID?: string | undefined;
  MUX_TOKEN_SECRET?: string | undefined;
  MUX_TASK72_PROOF?: string | undefined;
}

export type MuxProofResult =
  | {
      status: "BLOCKED";
      provider: "mux";
      reason: "MUX_CREDENTIALS_UNAVAILABLE" | "MUX_PROOF_NOT_OPTED_IN";
      networkAttempted: false;
    }
  | {
      status: "VERIFIED";
      provider: "mux";
      networkAttempted: true;
      testMode: true;
      liveStreamCreated: true;
      keyRotationVerified: true;
      cleanupVerified: true;
      playbackIdPresent: true;
    };

export function muxTask72ProofExitCode(status: MuxProofResult["status"]): 0 | 1 {
  return status === "VERIFIED" ? 0 : 1;
}

interface MuxLiveStreamData {
  id: string;
  stream_key: string;
  playback_ids?: Array<{ id?: string; policy?: string }>;
}

interface MuxEnvelope {
  data?: unknown;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const MUX_API = "https://api.mux.com/video/v1";

export function muxTask72ProofRequestBody() {
  return {
    test: true,
    latency_mode: "low",
    reconnect_window: 60,
    playback_policies: ["public"],
    new_asset_settings: {
      playback_policies: ["public"],
    },
  } as const;
}

export function muxTask72ProofEligibility(
  environment: MuxProofEnvironment,
):
  | { eligible: true; tokenId: string; tokenSecret: string }
  | { eligible: false; reason: "MUX_CREDENTIALS_UNAVAILABLE" | "MUX_PROOF_NOT_OPTED_IN" } {
  const tokenId = environment.MUX_TOKEN_ID?.trim();
  const tokenSecret = environment.MUX_TOKEN_SECRET?.trim();
  if (!tokenId || !tokenSecret) {
    return { eligible: false, reason: "MUX_CREDENTIALS_UNAVAILABLE" };
  }
  if (environment.MUX_TASK72_PROOF !== "1") {
    return { eligible: false, reason: "MUX_PROOF_NOT_OPTED_IN" };
  }
  return { eligible: true, tokenId, tokenSecret };
}

export async function runMuxTask72ControlPlaneProof(
  environment: MuxProofEnvironment,
  fetchImpl: FetchLike = fetch,
): Promise<MuxProofResult> {
  const eligibility = muxTask72ProofEligibility(environment);
  if (!eligibility.eligible) {
    return {
      status: "BLOCKED",
      provider: "mux",
      reason: eligibility.reason,
      networkAttempted: false,
    };
  }

  const authorization = `Basic ${Buffer.from(
    `${eligibility.tokenId}:${eligibility.tokenSecret}`,
    "utf8",
  ).toString("base64")}`;
  const headers = {
    authorization,
    "content-type": "application/json",
  };

  let liveStreamId: string | null = null;
  let cleanupVerified = false;
  try {
    const createResponse = await fetchImpl(`${MUX_API}/live-streams`, {
      method: "POST",
      headers,
      body: JSON.stringify(muxTask72ProofRequestBody()),
    });
    if (!createResponse.ok) {
      throw new Error(`MUX_PROOF_CREATE_FAILED:${createResponse.status}`);
    }

    const created = parseMuxLiveStream(await createResponse.json());
    liveStreamId = created.id;
    const initialStreamKey = created.stream_key;
    const playbackIdPresent = Boolean(
      created.playback_ids?.some((playback) => typeof playback.id === "string" && playback.id),
    );
    if (!playbackIdPresent) throw new Error("MUX_PROOF_PLAYBACK_ID_MISSING");

    const rotateResponse = await fetchImpl(
      `${MUX_API}/live-streams/${encodeURIComponent(liveStreamId)}/reset-stream-key`,
      {
        method: "POST",
        headers,
      },
    );
    if (!rotateResponse.ok) {
      throw new Error(`MUX_PROOF_ROTATE_FAILED:${rotateResponse.status}`);
    }
    const rotated = parseMuxLiveStream(await rotateResponse.json());
    if (rotated.stream_key === initialStreamKey) {
      throw new Error("MUX_PROOF_STREAM_KEY_DID_NOT_ROTATE");
    }

    const deleteResponse = await fetchImpl(
      `${MUX_API}/live-streams/${encodeURIComponent(liveStreamId)}`,
      {
        method: "DELETE",
        headers,
      },
    );
    if (!deleteResponse.ok && deleteResponse.status !== 204) {
      throw new Error(`MUX_PROOF_DELETE_FAILED:${deleteResponse.status}`);
    }
    cleanupVerified = true;
    liveStreamId = null;

    return {
      status: "VERIFIED",
      provider: "mux",
      networkAttempted: true,
      testMode: true,
      liveStreamCreated: true,
      keyRotationVerified: true,
      cleanupVerified,
      playbackIdPresent,
    };
  } finally {
    if (liveStreamId && !cleanupVerified) {
      await fetchImpl(`${MUX_API}/live-streams/${encodeURIComponent(liveStreamId)}`, {
        method: "DELETE",
        headers,
      }).catch(() => undefined);
    }
  }
}

function parseMuxLiveStream(payload: unknown): MuxLiveStreamData {
  if (!payload || typeof payload !== "object") throw new Error("MUX_PROOF_INVALID_RESPONSE");
  const data = (payload as MuxEnvelope).data;
  if (!data || typeof data !== "object") throw new Error("MUX_PROOF_INVALID_RESPONSE");

  const id = (data as { id?: unknown }).id;
  const streamKey = (data as { stream_key?: unknown }).stream_key;
  const playbackIds = (data as { playback_ids?: unknown }).playback_ids;
  if (typeof id !== "string" || !id.trim() || typeof streamKey !== "string" || !streamKey.trim()) {
    throw new Error("MUX_PROOF_INVALID_RESPONSE");
  }
  const normalizedPlaybackIds = Array.isArray(playbackIds)
    ? (playbackIds as NonNullable<MuxLiveStreamData["playback_ids"]>)
    : null;
  return normalizedPlaybackIds
    ? { id, stream_key: streamKey, playback_ids: normalizedPlaybackIds }
    : { id, stream_key: streamKey };
}
