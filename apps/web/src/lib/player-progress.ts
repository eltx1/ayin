import { apiBaseUrl } from "@/lib/api";
import { AccountScopeError, readBoundedAccountJson } from "@/lib/account-scope";

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
  revision: string | null;
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

export interface PlayerProgressScope {
  accountId: string;
  profileId: string;
  signal: AbortSignal;
}

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const maximumPositionMs = 7 * 24 * 60 * 60 * 1000;

export class WatchProgressConflictError extends Error {
  readonly code = "WATCH_PROGRESS_CONFLICT";
  constructor() {
    super("Watch progress changed before this checkpoint was saved.");
  }
}

function validRevision(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value)
  );
}

interface ProgressWrite {
  positionMs: number;
  durationMs?: number | undefined;
  expectedRevision: string | null;
}

function parseProgress(value: unknown, videoId: string, profileId: string): WatchProgressSnapshot {
  const invalid = () => new AccountScopeError(0, "INVALID_PROGRESS_RESPONSE");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const item = value as Record<string, unknown>;
  const policy = item.policy;
  const date = (input: unknown) =>
    input === null || (typeof input === "string" && Number.isFinite(Date.parse(input)));
  if (
    item.videoId !== videoId ||
    item.profileId !== profileId ||
    !Number.isSafeInteger(item.positionMs) ||
    (item.positionMs as number) < 0 ||
    (item.positionMs as number) > maximumPositionMs ||
    !date(item.completedAt) ||
    !date(item.lastWatchedAt) ||
    !validRevision(item.revision) ||
    item.revision !== item.lastWatchedAt ||
    (item.revision === null && (item.positionMs !== 0 || item.completedAt !== null)) ||
    !policy ||
    typeof policy !== "object" ||
    Array.isArray(policy)
  )
    throw invalid();
  const settings = policy as Record<string, unknown>;
  if (
    !Number.isSafeInteger(settings.progressSaveIntervalMs) ||
    (settings.progressSaveIntervalMs as number) <= 0 ||
    typeof settings.completionThresholdPercent !== "number" ||
    !Number.isFinite(settings.completionThresholdPercent) ||
    settings.completionThresholdPercent <= 0 ||
    settings.completionThresholdPercent > 100
  )
    throw invalid();
  return {
    profileId,
    videoId,
    positionMs: item.positionMs as number,
    completedAt: item.completedAt as string | null,
    lastWatchedAt: item.lastWatchedAt as string | null,
    revision: item.revision,
    policy: {
      progressSaveIntervalMs: settings.progressSaveIntervalMs as number,
      completionThresholdPercent: settings.completionThresholdPercent,
    },
  };
}

async function requestProgress(
  videoId: string,
  scope: PlayerProgressScope,
  input?: ProgressWrite,
  keepalive = false,
): Promise<WatchProgressSnapshot> {
  if (!uuid.test(videoId) || !uuid.test(scope.accountId) || !uuid.test(scope.profileId))
    throw new AccountScopeError(400, "INVALID_PROGRESS_SCOPE");
  if (
    input &&
    (!Number.isFinite(input.positionMs) ||
      input.positionMs < 0 ||
      input.positionMs > maximumPositionMs)
  )
    throw new AccountScopeError(400, "INVALID_PROGRESS_POSITION");
  if (input && !validRevision(input.expectedRevision))
    throw new AccountScopeError(400, "INVALID_PROGRESS_REVISION");
  scope.signal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(scope.signal.reason);
  // A keepalive PUT is captured only while its owner's lease is current. Once
  // started, give that immutable final snapshot a separate short lifetime;
  // owner teardown still cancels every read/ordinary write and fences all ACK
  // effects in the player. This does not start retries or refresh credentials.
  if (!keepalive) scope.signal.addEventListener("abort", abort, { once: true });
  const deadline = setTimeout(() => controller.abort(), keepalive ? 5_000 : 15_000);
  try {
    const query = input ? "" : `?profileId=${encodeURIComponent(scope.profileId)}`;
    const response = await fetch(
      `${apiBaseUrl}/watch/progress/${encodeURIComponent(videoId)}${query}`,
      {
        method: input ? "PUT" : "GET",
        cache: "no-store",
        credentials: "include",
        signal: controller.signal,
        headers: {
          "x-ayin-expected-account": scope.accountId,
          ...(input ? { "content-type": "application/json" } : {}),
        },
        ...(input
          ? {
              body: JSON.stringify({
                profileId: scope.profileId,
                expectedRevision: input.expectedRevision,
                positionMs: Math.floor(input.positionMs),
                ...(input.durationMs && Number.isFinite(input.durationMs) && input.durationMs > 0
                  ? { durationMs: Math.floor(input.durationMs) }
                  : {}),
              }),
              keepalive,
            }
          : {}),
      },
    );
    controller.signal.throwIfAborted();
    if (!response.ok) {
      if (response.status === 409) {
        const error: unknown = await readBoundedAccountJson(
          response,
          controller.signal,
          16_384,
        ).catch(() => null);
        if (error && typeof error === "object" && "error" in error) {
          const detail = error.error;
          if (
            detail &&
            typeof detail === "object" &&
            "code" in detail &&
            detail.code === "WATCH_PROGRESS_CONFLICT"
          )
            throw new WatchProgressConflictError();
        }
      }
      throw new AccountScopeError(response.status, "PROGRESS_REJECTED");
    }
    const result = parseProgress(
      await readBoundedAccountJson(response, controller.signal, 16_384),
      videoId,
      scope.profileId,
    );
    controller.signal.throwIfAborted();
    // The server may clamp at its authoritative duration. It cannot acknowledge
    // a later position than the value this request actually submitted.
    if (
      input &&
      (result.positionMs > Math.floor(input.positionMs) ||
        result.revision === null ||
        (input.expectedRevision !== null &&
          Date.parse(result.revision) <= Date.parse(input.expectedRevision)))
    )
      throw new AccountScopeError(0, "INVALID_PROGRESS_ACK");
    return result;
  } finally {
    clearTimeout(deadline);
    if (!keepalive) scope.signal.removeEventListener("abort", abort);
  }
}

export function readWatchProgress(videoId: string, scope: PlayerProgressScope) {
  return requestProgress(videoId, scope);
}

export function persistWatchProgress(
  videoId: string,
  input: ProgressWrite,
  scope: PlayerProgressScope,
  keepalive = false,
) {
  return requestProgress(videoId, scope, input, keepalive);
}
