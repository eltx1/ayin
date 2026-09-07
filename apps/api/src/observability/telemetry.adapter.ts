export const TELEMETRY_ADAPTER = Symbol("AYIN_TELEMETRY_ADAPTER");

export interface TelemetryAdapterStatus {
  provider: string;
  externalConnected: boolean;
}

export interface TelemetryEvent {
  event: string;
  severity: "info" | "warn" | "error";
  releaseSha: string;
  errorClass?: string;
  source?: string;
  statusCode?: number | null;
  path?: string | null;
}

export interface TelemetryAdapter {
  status(): TelemetryAdapterStatus;
  capture(event: TelemetryEvent): void | Promise<void>;
}

export class LocalTelemetryAdapter implements TelemetryAdapter {
  status(): TelemetryAdapterStatus {
    return { provider: "local", externalConnected: false };
  }

  capture(_event: TelemetryEvent): void {
    // Local structured logs and metrics remain the operational sink until a provider is explicitly configured.
  }
}
