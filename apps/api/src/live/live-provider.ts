import { Injectable } from "@nestjs/common";

export const LIVE_INGEST_PROVIDER = Symbol("LIVE_INGEST_PROVIDER");

export type LiveProviderEvidenceState =
  | "IDLE"
  | "CONNECTED"
  | "RECORDING"
  | "PLAYABLE"
  | "DISCONNECTED"
  | "ENDED"
  | "DISABLED"
  | "ERROR"
  | "UNKNOWN";

export type LiveProviderWebhookKind =
  | "CONNECTED"
  | "STARTED"
  | "PLAYABLE"
  | "DISCONNECTED"
  | "ENDED"
  | "RECORDING_FINALIZED"
  | "RECORDING_READY"
  | "ERROR"
  | "IGNORED";

export interface LiveProvisionRequest {
  streamId: string;
  channelId: string;
  title: string;
}

export interface LiveEncoderConfiguration {
  rtmps: {
    serverUrl: string;
    streamKey: string;
  };
  srt?: {
    url: string;
  };
}

export interface LiveProvisionResult {
  providerKey: string;
  providerStreamId: string;
  ingestEndpoint: string;
  playbackUrl: string;
  encoder: LiveEncoderConfiguration;
}

export interface LiveProviderStatus {
  providerKey: string;
  providerStreamId: string;
  state: LiveProviderEvidenceState;
  playable: boolean;
  connected: boolean;
  recording: boolean;
  playbackUrl: string | null;
  activeAssetId: string | null;
}

export interface LiveProviderRecording {
  providerAssetId: string;
  ayinStreamId: string | null;
  downloadUrl: string | null;
  renditionName: string | null;
}

export interface LiveProviderWebhookEvent {
  eventId: string;
  providerStreamId: string | null;
  kind: LiveProviderWebhookKind;
  rawType: string;
  occurredAt: Date;
  playable: boolean;
  fatal: boolean;
  activeAssetId: string | null;
  recording: LiveProviderRecording | null;
}

export interface LiveProviderCapabilities {
  ingestProtocols: Array<"RTMPS" | "SRT">;
  playbackProtocols: Array<"HLS" | "LL_HLS">;
  supportsKeyRotation: boolean;
  supportsRecording: boolean;
  webhookVerification: "SIGNED" | "UNAVAILABLE";
}

export interface LiveProviderDiagnostics {
  key: string;
  configured: boolean;
  productionEnabled: boolean;
  apiCredentialsConfigured: boolean;
  webhookVerificationConfigured: boolean;
  missingConfiguration: string[];
  ingestProtocols: string[];
  playbackProtocols: string[];
  liveEvidencePolicy: string;
}

export interface LiveIngestProvider {
  readonly key: string;
  readonly configured: boolean;
  capabilities(): LiveProviderCapabilities;
  provision(input: LiveProvisionRequest): Promise<LiveProvisionResult>;
  rotateKey(providerStreamId: string): Promise<LiveProvisionResult>;
  retrieveStatus(providerStreamId: string): Promise<LiveProviderStatus>;
  stop(providerStreamId: string | null): Promise<void>;
  discard(providerStreamId: string): Promise<void>;
  deleteRecordingAsset(providerAssetId: string): Promise<void>;
  verifyWebhook(
    rawBody: string | Buffer,
    signatureHeader: string | undefined,
  ): LiveProviderWebhookEvent;
  diagnostics(): LiveProviderDiagnostics;
}

@Injectable()
export class UnconfiguredLiveIngestProvider implements LiveIngestProvider {
  readonly key = "unconfigured";
  readonly configured = false;

  capabilities(): LiveProviderCapabilities {
    return {
      ingestProtocols: [],
      playbackProtocols: [],
      supportsKeyRotation: false,
      supportsRecording: false,
      webhookVerification: "UNAVAILABLE",
    };
  }

  async provision(): Promise<LiveProvisionResult> {
    throw new LiveProviderUnavailableError();
  }

  async rotateKey(): Promise<LiveProvisionResult> {
    throw new LiveProviderUnavailableError();
  }

  async retrieveStatus(): Promise<LiveProviderStatus> {
    throw new LiveProviderUnavailableError();
  }

  async stop(): Promise<void> {
    return;
  }

  async discard(): Promise<void> {
    throw new LiveProviderUnavailableError();
  }

  async deleteRecordingAsset(): Promise<void> {
    throw new LiveProviderUnavailableError();
  }

  verifyWebhook(): LiveProviderWebhookEvent {
    throw new LiveProviderUnavailableError();
  }

  diagnostics(): LiveProviderDiagnostics {
    return {
      key: this.key,
      configured: false,
      productionEnabled: false,
      apiCredentialsConfigured: false,
      webhookVerificationConfigured: false,
      missingConfiguration: ["LIVE_INGEST_PROVIDER"],
      ingestProtocols: [],
      playbackProtocols: [],
      liveEvidencePolicy: "Provider evidence unavailable",
    };
  }
}

export class LiveProviderUnavailableError extends Error {
  constructor(message = "A live ingest/transcoding provider is not configured.") {
    super(message);
    this.name = "LiveProviderUnavailableError";
  }
}

export class LiveProviderOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly providerStatusCode?: number,
  ) {
    super(message);
    this.name = "LiveProviderOperationError";
  }
}
