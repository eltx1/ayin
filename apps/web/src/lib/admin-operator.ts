import { apiBaseUrl } from "./api";
import { readAdminApiError } from "./admin-reauthentication";
import type { AdminRole } from "./admin-control";

export function canReadMediaOperations(roles: AdminRole[]) {
  return roles.some((role) => ["SUPERADMIN", "ADMIN", "OPERATIONS"].includes(role));
}
export function canReadDatabaseOperations(roles: AdminRole[]) {
  // Existing AdminGuard treats SUPERADMIN metadata as a hard boundary.
  return roles.includes("SUPERADMIN");
}

export interface MediaOperations {
  capacity: { enabled: boolean; concurrentJobs: number; retryLimit: number; leaseSeconds: number };
  active: number;
  counts: Record<string, number>;
  workers: Array<{
    id: string;
    hostName: string;
    status: string;
    activeJobCount: number;
    concurrencyLimit: number;
    heartbeatAt: string;
    releaseSha: string;
  }>;
  jobs: Array<{
    id: string;
    videoId: string;
    status: string;
    stage: string;
    progressPercent: number;
    attempt: number;
    updatedAt: string;
    errorCode: string | null;
    video: { title: string; slug: string; channelId: string };
  }>;
}
export interface AdaptiveOperations {
  controls: {
    generationEnabled: boolean;
    playbackEnabled: boolean;
    newUploadsEnabled: boolean;
    backfillEnabled: boolean;
    backfillPaused: boolean;
    batchSize: number;
    maxInFlight: number;
  };
  catalog: {
    eligible: number;
    queued: number;
    processing: number;
    adaptiveReady: number;
    failed: number;
    fallbackOnly: number;
  };
  metrics: {
    windowDays: number;
    hlsStartupSuccess: number;
    fatalAdaptiveFailure: number;
    mp4Fallbacks: number;
    mp4FallbackRate: number;
    outputStorageBytes: string;
    outputStorageGrowthBytes: string;
    sampledReadyGenerations: number;
    averageProcessingDurationMsBySourceResolution: Record<string, number>;
  };
}
export interface DatabaseOperations {
  pool: { max: number; min: number; applicationName: string };
  server: {
    maxConnections: number | null;
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    idleInTransactionConnections: number;
    byApplication: Array<{ applicationName: string; connections: number; active: number }>;
  };
  slowStatements: {
    available: boolean;
    extensionInstalled: boolean;
    note: string;
    rows: Array<{
      queryId: string;
      calls: number;
      totalExecMs: number;
      meanExecMs: number;
      rows: number;
    }>;
  };
}

async function snapshot<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(await readAdminApiError(response));
  return response.json() as Promise<T>;
}
export const getMediaOperations = (signal: AbortSignal) =>
  snapshot<MediaOperations>("/admin/media-processing", signal);
export const getAdaptiveOperations = (signal: AbortSignal) =>
  snapshot<AdaptiveOperations>("/admin/media-processing/adaptive-rollout", signal);
export const getDatabaseOperations = (signal: AbortSignal) =>
  snapshot<DatabaseOperations>("/admin/observability/postgres", signal);
