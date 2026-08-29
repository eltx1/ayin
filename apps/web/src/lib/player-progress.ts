import { apiBaseUrl } from "@/lib/api";

export interface PlayerProgressPolicy {
  progressSaveIntervalMs: number;
  completionThresholdPercent: number;
}

export interface WatchProgressSnapshot {
  profileId: string;
  videoId: string;
  positionMs: number;
  completedAt: string | null;
  lastWatchedAt: string | null;
  policy: PlayerProgressPolicy;
}

export interface ProgressThrottleState {
  nowMs: number;
  lastPersistedAtMs: number;
  positionMs: number;
  lastPersistedPositionMs: number;
  intervalMs: number;
  force?: boolean | undefined;
}

export function shouldPersistProgress(state: ProgressThrottleState): boolean {
  if (state.force) return Math.abs(state.positionMs - state.lastPersistedPositionMs) >= 250;
  if (state.nowMs - state.lastPersistedAtMs < state.intervalMs) return false;
  return Math.abs(state.positionMs - state.lastPersistedPositionMs) >= 1000;
}

export function resumablePositionMs(
  progress: Pick<WatchProgressSnapshot, "positionMs" | "completedAt"> | null,
  durationMs: number | null,
): number {
  if (!progress || progress.completedAt || progress.positionMs < 3000) return 0;
  if (durationMs && progress.positionMs >= durationMs - 5000) return 0;
  return Math.max(0, progress.positionMs);
}

export function completionReached(
  positionMs: number,
  durationMs: number,
  completionThresholdPercent: number,
): boolean {
  if (durationMs <= 0) return false;
  return positionMs / durationMs >= completionThresholdPercent / 100;
}

export async function readWatchProgress(
  videoId: string,
  profileId?: string,
): Promise<WatchProgressSnapshot | null> {
  const query = profileId ? `?profileId=${encodeURIComponent(profileId)}` : "";
  const response = await fetch(
    `${apiBaseUrl}/watch/progress/${encodeURIComponent(videoId)}${query}`,
    {
      cache: "no-store",
      credentials: "include",
    },
  );
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) return null;
  return (await response.json()) as WatchProgressSnapshot;
}

export async function persistWatchProgress(
  videoId: string,
  input: { profileId?: string | undefined; positionMs: number; durationMs?: number | undefined },
  keepalive = false,
): Promise<WatchProgressSnapshot | null> {
  const body: Record<string, unknown> = { positionMs: Math.max(0, Math.floor(input.positionMs)) };
  if (input.profileId) body.profileId = input.profileId;
  if (input.durationMs && Number.isFinite(input.durationMs))
    body.durationMs = Math.floor(input.durationMs);

  const response = await fetch(`${apiBaseUrl}/watch/progress/${encodeURIComponent(videoId)}`, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive,
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) return null;
  return (await response.json()) as WatchProgressSnapshot;
}
