import { Injectable } from "@nestjs/common";

export const LIVE_INGEST_PROVIDER = Symbol("LIVE_INGEST_PROVIDER");

export interface LiveProvisionRequest {
  streamId: string;
  channelId: string;
  title: string;
  streamKey: string;
}

export interface LiveProvisionResult {
  providerKey: string;
  providerStreamId: string | null;
  ingestEndpoint: string | null;
  playbackUrl: string | null;
}

export interface LiveIngestProvider {
  readonly key: string;
  readonly configured: boolean;
  provision(input: LiveProvisionRequest): Promise<LiveProvisionResult>;
  rotateKey(input: LiveProvisionRequest): Promise<LiveProvisionResult>;
  stop(providerStreamId: string | null): Promise<void>;
}

@Injectable()
export class UnconfiguredLiveIngestProvider implements LiveIngestProvider {
  readonly key = "unconfigured";
  readonly configured = false;

  async provision(): Promise<LiveProvisionResult> {
    throw new LiveProviderUnavailableError();
  }

  async rotateKey(): Promise<LiveProvisionResult> {
    throw new LiveProviderUnavailableError();
  }

  async stop(): Promise<void> {
    return;
  }
}

export class LiveProviderUnavailableError extends Error {
  constructor() {
    super("A live ingest/transcoding provider is not configured.");
    this.name = "LiveProviderUnavailableError";
  }
}
