import { createHmac, timingSafeEqual } from "node:crypto";

import {
  type LiveEncoderConfiguration,
  type LiveIngestProvider,
  type LiveProviderCapabilities,
  type LiveProviderDiagnostics,
  type LiveProviderRecording,
  type LiveProviderStatus,
  type LiveProviderWebhookEvent,
  LiveProviderOperationError,
  LiveProviderUnavailableError,
  type LiveProvisionRequest,
  type LiveProvisionResult,
} from "./live-provider.js";

const MUX_VIDEO_API = "https://api.mux.com/video/v1";
const MUX_RTMPS_SERVER = "rtmps://global-live.mux.com:443/app";
const MUX_SRT_SERVER = "srt://global-live.mux.com:6001";
const MUX_HLS_ORIGIN = "https://stream.mux.com";
const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface MuxLiveEnvironment {
  MUX_TOKEN_ID?: string | undefined;
  MUX_TOKEN_SECRET?: string | undefined;
  MUX_WEBHOOK_SIGNING_SECRET?: string | undefined;
  MUX_LIVE_PRODUCTION_ENABLED?: string | undefined;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface MuxEnvelope {
  data?: unknown;
}

interface MuxLiveStreamData {
  id: string;
  streamKey?: string;
  srtPassphrase?: string;
  status: string | undefined;
  playbackId: string | null;
  activeAssetId: string | null;
  connected: boolean;
  recording: boolean;
}

interface MuxWebhookEnvelope {
  id?: unknown;
  type?: unknown;
  created_at?: unknown;
  data?: unknown;
}

export class MuxLiveIngestProvider implements LiveIngestProvider {
  readonly key = "mux";

  constructor(
    private readonly environment: MuxLiveEnvironment = process.env,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  get configured(): boolean {
    return this.missingControlConfiguration().length === 0;
  }

  capabilities(): LiveProviderCapabilities {
    return {
      ingestProtocols: ["RTMPS", "SRT"],
      playbackProtocols: ["HLS", "LL_HLS"],
      supportsKeyRotation: true,
      supportsRecording: true,
      webhookVerification: "SIGNED",
    };
  }

  async provision(input: LiveProvisionRequest): Promise<LiveProvisionResult> {
    this.assertProvisioningEnabled();
    const payload = await this.requestJson("/live-streams", {
      method: "POST",
      body: JSON.stringify({
        playback_policies: ["public"],
        latency_mode: "low",
        reconnect_window: 60,
        meta: {
          external_id: input.streamId,
        },
        new_asset_settings: {
          playback_policies: ["public"],
          video_quality: "plus",
          static_renditions: [{ resolution: "highest" }],
          meta: {
            external_id: input.streamId,
          },
        },
      }),
    });
    return this.provisionResult(parseMuxLiveStream(payload, true));
  }

  async rotateKey(providerStreamId: string): Promise<LiveProvisionResult> {
    this.assertProvisioningEnabled();
    if (!providerStreamId) {
      throw new LiveProviderOperationError(
        "MUX_STREAM_ID_REQUIRED",
        "A provider stream ID is required to rotate live credentials.",
      );
    }
    const payload = await this.requestJson(
      `/live-streams/${encodeURIComponent(providerStreamId)}/reset-stream-key`,
      { method: "POST" },
    );
    return this.provisionResult(parseMuxLiveStream(payload, true));
  }

  async retrieveStatus(providerStreamId: string): Promise<LiveProviderStatus> {
    this.assertConfigured();
    const payload = await this.requestJson(
      `/live-streams/${encodeURIComponent(providerStreamId)}`,
      { method: "GET" },
    );
    const live = parseMuxLiveStream(payload, false);
    const state = muxStatusState(live.status);
    return {
      providerKey: this.key,
      providerStreamId: live.id,
      state,
      playable: state === "PLAYABLE",
      connected: live.connected,
      recording: live.recording,
      playbackUrl: live.playbackId ? muxPlaybackUrl(live.playbackId) : null,
      activeAssetId: live.activeAssetId,
    };
  }

  async retrieveRecording(
    providerAssetId: string,
    renditionName: string,
  ): Promise<LiveProviderRecording> {
    this.assertConfigured();
    if (!providerAssetId || !renditionName) {
      throw new LiveProviderOperationError(
        "MUX_RECORDING_ID_REQUIRED",
        "A provider asset ID and rendition name are required to retrieve a live recording.",
      );
    }
    const payload = await this.requestJson(`/assets/${encodeURIComponent(providerAssetId)}`, {
      method: "GET",
    });
    return parseMuxRecordingAsset(payload, providerAssetId, renditionName);
  }

  async stop(providerStreamId: string | null): Promise<void> {
    if (!providerStreamId) return;
    this.assertConfigured();
    await this.requestJson(`/live-streams/${encodeURIComponent(providerStreamId)}/disable`, {
      method: "PUT",
    });
  }

  async discard(providerStreamId: string): Promise<void> {
    this.assertConfigured();
    await this.requestJson(`/live-streams/${encodeURIComponent(providerStreamId)}`, {
      method: "DELETE",
    });
  }

  async deleteRecordingAsset(providerAssetId: string): Promise<void> {
    this.assertConfigured();
    await this.requestJson(`/assets/${encodeURIComponent(providerAssetId)}`, {
      method: "DELETE",
    });
  }

  verifyWebhook(
    rawBody: string | Buffer,
    signatureHeader: string | undefined,
  ): LiveProviderWebhookEvent {
    const secret = this.environment.MUX_WEBHOOK_SIGNING_SECRET?.trim();
    if (!secret) {
      throw new LiveProviderUnavailableError("Mux webhook verification is not configured.");
    }

    const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    verifyMuxSignature(body, signatureHeader, secret, this.now());

    let parsed: unknown;
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      throw new LiveProviderOperationError(
        "MUX_WEBHOOK_INVALID_JSON",
        "Mux webhook payload is not valid JSON.",
      );
    }
    return normalizeMuxWebhook(parsed, this.now());
  }

  diagnostics(): LiveProviderDiagnostics {
    const missingControlConfiguration = this.missingControlConfiguration();
    const missingConfiguration = [
      ...missingControlConfiguration,
      ...(this.environment.MUX_LIVE_PRODUCTION_ENABLED === "1"
        ? []
        : ["MUX_LIVE_PRODUCTION_ENABLED=1"]),
    ];
    const capabilities = this.capabilities();
    return {
      key: this.key,
      configured: missingControlConfiguration.length === 0,
      productionEnabled: this.environment.MUX_LIVE_PRODUCTION_ENABLED === "1",
      apiCredentialsConfigured: Boolean(
        this.environment.MUX_TOKEN_ID?.trim() && this.environment.MUX_TOKEN_SECRET?.trim(),
      ),
      webhookVerificationConfigured: Boolean(this.environment.MUX_WEBHOOK_SIGNING_SECRET?.trim()),
      missingConfiguration,
      ingestProtocols: [...capabilities.ingestProtocols],
      playbackProtocols: [...capabilities.playbackProtocols],
      liveEvidencePolicy: "Mux video.live_stream.active or API status=active",
    };
  }

  private provisionResult(live: MuxLiveStreamData): LiveProvisionResult {
    if (!live.streamKey) {
      throw new LiveProviderOperationError(
        "MUX_STREAM_KEY_MISSING",
        "Mux did not return a stream key for the requested credential operation.",
      );
    }
    if (!live.playbackId) {
      throw new LiveProviderOperationError(
        "MUX_PLAYBACK_ID_MISSING",
        "Mux did not return a public playback ID for the live stream.",
      );
    }

    return {
      providerKey: this.key,
      providerStreamId: live.id,
      ingestEndpoint: MUX_RTMPS_SERVER,
      playbackUrl: muxPlaybackUrl(live.playbackId),
      encoder: muxEncoderConfiguration(live.streamKey, live.srtPassphrase),
    };
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    const tokenId = this.environment.MUX_TOKEN_ID?.trim();
    const tokenSecret = this.environment.MUX_TOKEN_SECRET?.trim();
    if (!tokenId || !tokenSecret) {
      throw new LiveProviderUnavailableError("Mux API credentials are not configured.");
    }

    const response = await this.fetchImpl(`${MUX_VIDEO_API}${path}`, {
      ...init,
      headers: {
        authorization: `Basic ${Buffer.from(`${tokenId}:${tokenSecret}`, "utf8").toString(
          "base64",
        )}`,
        "content-type": "application/json",
      },
    });
    if (!response.ok) {
      throw new LiveProviderOperationError(
        "MUX_API_REQUEST_FAILED",
        `Mux API request failed with HTTP ${response.status}.`,
        response.status,
      );
    }
    if (response.status === 204) return null;
    return (await response.json()) as unknown;
  }

  private missingControlConfiguration(): string[] {
    const missing: string[] = [];
    if (!this.environment.MUX_TOKEN_ID?.trim()) missing.push("MUX_TOKEN_ID");
    if (!this.environment.MUX_TOKEN_SECRET?.trim()) missing.push("MUX_TOKEN_SECRET");
    if (!this.environment.MUX_WEBHOOK_SIGNING_SECRET?.trim()) {
      missing.push("MUX_WEBHOOK_SIGNING_SECRET");
    }
    return missing;
  }

  private assertConfigured(): void {
    const missing = this.missingControlConfiguration();
    if (missing.length > 0) {
      throw new LiveProviderUnavailableError(
        `Mux live control is unavailable; missing configuration: ${missing.join(", ")}.`,
      );
    }
  }

  private assertProvisioningEnabled(): void {
    this.assertConfigured();
    if (this.environment.MUX_LIVE_PRODUCTION_ENABLED !== "1") {
      throw new LiveProviderUnavailableError(
        "Mux live provisioning is disabled by MUX_LIVE_PRODUCTION_ENABLED.",
      );
    }
  }
}

export function muxEncoderConfiguration(
  streamKey: string,
  srtPassphrase?: string,
): LiveEncoderConfiguration {
  return {
    rtmps: {
      serverUrl: MUX_RTMPS_SERVER,
      streamKey,
    },
    ...(srtPassphrase
      ? {
          srt: {
            url: `${MUX_SRT_SERVER}?streamid=${encodeURIComponent(
              streamKey,
            )}&passphrase=${encodeURIComponent(srtPassphrase)}`,
          },
        }
      : {}),
  };
}

export function verifyMuxSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
  nowMilliseconds = Date.now(),
): void {
  if (!signatureHeader) {
    throw new LiveProviderOperationError(
      "MUX_WEBHOOK_SIGNATURE_MISSING",
      "Mux webhook signature is missing.",
    );
  }

  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") timestamp = value;
    if (key === "v1" && value) signatures.push(value);
  }

  const timestampNumber = timestamp ? Number(timestamp) : Number.NaN;
  if (!timestamp || !Number.isFinite(timestampNumber) || signatures.length === 0) {
    throw new LiveProviderOperationError(
      "MUX_WEBHOOK_SIGNATURE_INVALID",
      "Mux webhook signature format is invalid.",
    );
  }

  const ageSeconds = Math.abs(Math.floor(nowMilliseconds / 1000) - timestampNumber);
  if (ageSeconds > WEBHOOK_TOLERANCE_SECONDS) {
    throw new LiveProviderOperationError(
      "MUX_WEBHOOK_SIGNATURE_STALE",
      "Mux webhook signature timestamp is outside the allowed tolerance.",
    );
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  const expectedBytes = Buffer.from(expected, "utf8");
  const valid = signatures.some((signature) => {
    const signatureBytes = Buffer.from(signature, "utf8");
    return (
      signatureBytes.length === expectedBytes.length &&
      timingSafeEqual(signatureBytes, expectedBytes)
    );
  });
  if (!valid) {
    throw new LiveProviderOperationError(
      "MUX_WEBHOOK_SIGNATURE_INVALID",
      "Mux webhook signature verification failed.",
    );
  }
}

export function normalizeMuxWebhook(
  payload: unknown,
  nowMilliseconds = Date.now(),
): LiveProviderWebhookEvent {
  if (!payload || typeof payload !== "object") {
    throw new LiveProviderOperationError(
      "MUX_WEBHOOK_INVALID_PAYLOAD",
      "Mux webhook payload is invalid.",
    );
  }
  const envelope = payload as MuxWebhookEnvelope;
  const eventId = typeof envelope.id === "string" ? envelope.id : "";
  const rawType = typeof envelope.type === "string" ? envelope.type : "";
  if (!eventId || !rawType) {
    throw new LiveProviderOperationError(
      "MUX_WEBHOOK_INVALID_PAYLOAD",
      "Mux webhook payload is missing its event ID or type.",
    );
  }

  const data =
    envelope.data && typeof envelope.data === "object"
      ? (envelope.data as Record<string, unknown>)
      : {};
  const kind = muxWebhookKind(rawType);
  const liveEvent = rawType.startsWith("video.live_stream.");
  const staticRenditionEvent = rawType.startsWith("video.asset.static_rendition.");
  const assetEvent = rawType.startsWith("video.asset.");
  const providerStreamId = liveEvent && typeof data.id === "string" ? data.id : null;
  const activeAssetId = staticRenditionEvent
    ? typeof data.asset_id === "string"
      ? data.asset_id
      : null
    : typeof data.active_asset_id === "string"
      ? data.active_asset_id
      : assetEvent && typeof data.id === "string"
        ? data.id
        : null;
  const recording = staticRenditionEvent
    ? muxStaticRenditionFromWebhook(data)
    : assetEvent
      ? muxAssetRecordingFromWebhook(data)
      : null;
  const occurredAt = muxWebhookDate(envelope.created_at, nowMilliseconds);
  return {
    eventId,
    providerStreamId,
    kind,
    rawType,
    occurredAt,
    playable: kind === "PLAYABLE",
    fatal: rawType === "video.asset.errored",
    activeAssetId,
    recording,
  };
}

function parseMuxLiveStream(payload: unknown, requireSecrets: boolean): MuxLiveStreamData {
  if (!payload || typeof payload !== "object") {
    throw new LiveProviderOperationError(
      "MUX_INVALID_RESPONSE",
      "Mux returned an invalid response.",
    );
  }
  const data = (payload as MuxEnvelope).data;
  if (!data || typeof data !== "object") {
    throw new LiveProviderOperationError(
      "MUX_INVALID_RESPONSE",
      "Mux returned an invalid response.",
    );
  }
  const record = data as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  const streamKey = typeof record.stream_key === "string" ? record.stream_key : undefined;
  const srtPassphrase =
    typeof record.srt_passphrase === "string" ? record.srt_passphrase : undefined;
  if (!id || (requireSecrets && !streamKey)) {
    throw new LiveProviderOperationError(
      "MUX_INVALID_RESPONSE",
      "Mux returned an invalid live stream.",
    );
  }

  const playbackId = publicPlaybackId(record.playback_ids);
  return {
    id,
    ...(streamKey ? { streamKey } : {}),
    ...(srtPassphrase ? { srtPassphrase } : {}),
    status: typeof record.status === "string" ? record.status : undefined,
    playbackId,
    activeAssetId: typeof record.active_asset_id === "string" ? record.active_asset_id : null,
    connected: record.connected === true,
    recording: record.recording === true,
  };
}

function publicPlaybackId(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const playback = item as Record<string, unknown>;
    if (playback.policy === "public" && typeof playback.id === "string" && playback.id) {
      return playback.id;
    }
  }
  return null;
}

function muxPlaybackUrl(playbackId: string): string {
  return `${MUX_HLS_ORIGIN}/${encodeURIComponent(playbackId)}.m3u8`;
}

function muxStatusState(status: string | undefined): LiveProviderStatus["state"] {
  switch (status) {
    case "active":
      return "PLAYABLE";
    case "idle":
      return "IDLE";
    case "disabled":
      return "DISABLED";
    default:
      return "UNKNOWN";
  }
}

function muxWebhookKind(type: string): LiveProviderWebhookEvent["kind"] {
  switch (type) {
    case "video.live_stream.connected":
      return "CONNECTED";
    case "video.live_stream.recording":
      return "STARTED";
    case "video.live_stream.active":
      return "PLAYABLE";
    case "video.live_stream.disconnected":
      return "DISCONNECTED";
    case "video.live_stream.idle":
    case "video.live_stream.disabled":
    case "video.live_stream.deleted":
      return "ENDED";
    case "video.asset.live_stream_completed":
      return "RECORDING_FINALIZED";
    case "video.asset.static_rendition.ready":
      return "RECORDING_READY";
    case "video.live_stream.warning":
    case "video.asset.errored":
    case "video.asset.static_rendition.errored":
      return "ERROR";
    default:
      return "IGNORED";
  }
}

function muxAssetRecordingFromWebhook(
  data: Record<string, unknown>,
): LiveProviderWebhookEvent["recording"] {
  const providerAssetId = typeof data.id === "string" ? data.id : "";
  if (!providerAssetId) return null;

  const meta =
    data.meta && typeof data.meta === "object" ? (data.meta as Record<string, unknown>) : {};
  const ayinStreamId = typeof meta.external_id === "string" ? meta.external_id : null;
  return {
    providerAssetId,
    ayinStreamId,
    downloadUrl: null,
    renditionName: null,
  };
}

function muxStaticRenditionFromWebhook(
  data: Record<string, unknown>,
): LiveProviderWebhookEvent["recording"] {
  const providerAssetId = typeof data.asset_id === "string" ? data.asset_id : "";
  if (!providerAssetId) return null;
  const renditionName =
    data.status === "ready" &&
    data.ext === "mp4" &&
    typeof data.name === "string" &&
    data.name.toLowerCase().endsWith(".mp4")
      ? data.name
      : null;
  return {
    providerAssetId,
    ayinStreamId: null,
    downloadUrl: null,
    renditionName,
  };
}

function parseMuxRecordingAsset(
  payload: unknown,
  expectedAssetId: string,
  renditionName: string,
): LiveProviderRecording {
  if (!payload || typeof payload !== "object") {
    throw new LiveProviderOperationError(
      "MUX_INVALID_RESPONSE",
      "Mux returned an invalid recording asset response.",
    );
  }
  const data = (payload as MuxEnvelope).data;
  if (!data || typeof data !== "object") {
    throw new LiveProviderOperationError(
      "MUX_INVALID_RESPONSE",
      "Mux returned an invalid recording asset response.",
    );
  }
  const record = data as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  if (!id || id !== expectedAssetId) {
    throw new LiveProviderOperationError(
      "MUX_RECORDING_ASSET_MISMATCH",
      "Mux returned a recording asset that did not match the requested asset.",
    );
  }

  const playbackId = publicPlaybackId(record.playback_ids);
  const staticRenditions =
    record.static_renditions && typeof record.static_renditions === "object"
      ? (record.static_renditions as Record<string, unknown>)
      : {};
  const files = Array.isArray(staticRenditions.files) ? staticRenditions.files : [];
  const readyRendition = files.some((item) => {
    if (!item || typeof item !== "object") return false;
    const file = item as Record<string, unknown>;
    return file.status === "ready" && file.ext === "mp4" && file.name === renditionName;
  });
  if (!playbackId || !readyRendition) {
    throw new LiveProviderOperationError(
      "MUX_RECORDING_NOT_READY",
      "Mux recording metadata is not ready for AYIN handoff.",
    );
  }

  const meta =
    record.meta && typeof record.meta === "object" ? (record.meta as Record<string, unknown>) : {};
  return {
    providerAssetId: id,
    ayinStreamId: typeof meta.external_id === "string" ? meta.external_id : null,
    downloadUrl: `${MUX_HLS_ORIGIN}/${encodeURIComponent(playbackId)}/${encodeURIComponent(
      renditionName,
    )}`,
    renditionName,
  };
}

function muxWebhookDate(value: unknown, nowMilliseconds: number): Date {
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric * 1000);
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value * 1000);
  return new Date(nowMilliseconds);
}
