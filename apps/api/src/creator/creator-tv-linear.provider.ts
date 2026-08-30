import { Injectable } from "@nestjs/common";

export interface LinearProgramSource {
  objectKey: string;
  mimeType: string;
}

export interface LinearProgram {
  occurrenceKey: string;
  videoId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  playbackOffsetMs: number;
  source: LinearProgramSource;
}

export interface LinearAdMarker {
  id: string;
  occurrenceKey: string;
  offsetMs: number;
  source: "HOUSE" | "DIRECT" | "PROGRAMMATIC";
  signaling: "SCTE35_INTENT";
}

export interface LinearChannelPlan {
  tvChannelId: string;
  channelId: string;
  channelHandle: string;
  generatedAt: string;
  windowEndsAt: string;
  programs: LinearProgram[];
  adMarkers: LinearAdMarker[];
  epg: {
    format: "XMLTV";
    xml: string;
  };
  fallback: {
    strategy: "PROGRESSIVE_MP4";
    enabled: true;
  };
}

export interface LinearOutputState {
  providerKey: string;
  configured: boolean;
  status: "UNCONFIGURED" | "PROVISIONING" | "READY" | "STOPPED" | "ERROR";
  hlsUrl: string | null;
  providerResourceId: string | null;
  lastPlanGeneratedAt: string | null;
  message: string | null;
}

export interface LinearStreamingProvider {
  readonly key: string;
  readonly configured: boolean;
  getState(tvChannelId: string): Promise<LinearOutputState>;
  provision(plan: LinearChannelPlan): Promise<LinearOutputState>;
  reconcile(plan: LinearChannelPlan): Promise<LinearOutputState>;
  stop(tvChannelId: string): Promise<LinearOutputState>;
}

export const CREATOR_TV_LINEAR_PROVIDER = Symbol("CREATOR_TV_LINEAR_PROVIDER");

export class LinearProviderUnavailableError extends Error {
  constructor() {
    super(
      "No linear streaming provider is configured. AYIN will keep using its progressive MP4 Creator TV fallback until real linear compute/provider credentials are supplied.",
    );
    this.name = "LinearProviderUnavailableError";
  }
}

@Injectable()
export class UnconfiguredLinearStreamingProvider implements LinearStreamingProvider {
  readonly key = "unconfigured";
  readonly configured = false;

  async getState(tvChannelId: string): Promise<LinearOutputState> {
    void tvChannelId;
    return this.state();
  }

  async provision(plan: LinearChannelPlan): Promise<LinearOutputState> {
    void plan;
    throw new LinearProviderUnavailableError();
  }

  async reconcile(plan: LinearChannelPlan): Promise<LinearOutputState> {
    void plan;
    throw new LinearProviderUnavailableError();
  }

  async stop(tvChannelId: string): Promise<LinearOutputState> {
    void tvChannelId;
    return this.state("STOPPED");
  }

  private state(status: LinearOutputState["status"] = "UNCONFIGURED"): LinearOutputState {
    return {
      providerKey: this.key,
      configured: false,
      status,
      hlsUrl: null,
      providerResourceId: null,
      lastPlanGeneratedAt: null,
      message:
        "Configure a real linear streaming provider or compute layer before enabling HLS output. Progressive MP4 remains available as the safe fallback.",
    };
  }
}
