import { apiBaseUrl } from "./api";
import type { AdminRole } from "./admin-control";
import { readAdminApiError } from "./admin-reauthentication";
export const canReadObservability = (roles: AdminRole[]) => roles.includes("SUPERADMIN");
export interface ObservabilitySnapshot {
  releaseSha: string;
  telemetry: { provider: string; externalConnected: boolean };
  api: {
    scope: "PROCESS";
    sampleLimit: number;
    windowSeconds: number;
    requests: number;
    requestsPerSecond: number;
    statusClasses: Record<"1xx" | "2xx" | "3xx" | "4xx" | "5xx", number>;
    latencyMs: { average: number; p50: number; p95: number; max: number };
  };
  worker: {
    queueDepth: number;
    oldestQueuedAgeSeconds: number;
    activeJobs: number;
    failures: number;
    jobsWithRetries: number;
  };
  errors: {
    counterScope: "PROCESS_LIFETIME";
    counters: Record<string, number>;
    adIntegrationLast24Hours: number;
  };
}
export async function getObservability(signal: AbortSignal): Promise<ObservabilitySnapshot> {
  const response = await fetch(`${apiBaseUrl}/admin/observability`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(await readAdminApiError(response));
  const data = (await response.json()) as ObservabilitySnapshot;
  const nonnegative = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (
    !data ||
    typeof data.releaseSha !== "string" ||
    typeof data.telemetry?.provider !== "string" ||
    typeof data.telemetry.externalConnected !== "boolean" ||
    data.api?.scope !== "PROCESS" ||
    !nonnegative(data.api.sampleLimit) ||
    !data.api.sampleLimit ||
    !nonnegative(data.api.windowSeconds) ||
    !data.api.windowSeconds ||
    !nonnegative(data.api.requests) ||
    !nonnegative(data.api.requestsPerSecond) ||
    !["1xx", "2xx", "3xx", "4xx", "5xx"].every((key) =>
      nonnegative(data.api.statusClasses?.[key as keyof typeof data.api.statusClasses]),
    ) ||
    !["average", "p50", "p95", "max"].every((key) =>
      nonnegative(data.api.latencyMs?.[key as keyof typeof data.api.latencyMs]),
    ) ||
    !["queueDepth", "oldestQueuedAgeSeconds", "activeJobs", "failures", "jobsWithRetries"].every(
      (key) => nonnegative(data.worker?.[key as keyof typeof data.worker]),
    ) ||
    data.errors?.counterScope !== "PROCESS_LIFETIME" ||
    !nonnegative(data.errors.adIntegrationLast24Hours) ||
    !data.errors.counters ||
    Array.isArray(data.errors.counters) ||
    typeof data.errors.counters !== "object" ||
    !Object.values(data.errors.counters).every(nonnegative)
  )
    throw new Error("Service observability returned an invalid snapshot.");
  return data;
}
