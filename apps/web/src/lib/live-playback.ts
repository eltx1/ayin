"use client";

export const LIVE_EDGE_THRESHOLD_SECONDS = 3;
const LIVE_RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000] as const;

export type LiveReconnectReason =
  | "NETWORK"
  | "MANIFEST"
  | "MEDIA"
  | "STARTUP"
  | "UNSUPPORTED"
  | "OFFLINE"
  | "OTHER";

export interface LiveEdgeSnapshot {
  seekableStartSeconds: number | null;
  seekableEndSeconds: number | null;
  behindLiveSeconds: number | null;
  atLiveEdge: boolean;
}

type LiveVideoLike = Pick<HTMLVideoElement, "currentTime" | "seekable">;

export function liveReconnectDelayMs(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 0) return null;
  return LIVE_RECONNECT_DELAYS_MS[attempt] ?? null;
}

export function liveEdgeSnapshot(
  video: LiveVideoLike,
  thresholdSeconds = LIVE_EDGE_THRESHOLD_SECONDS,
): LiveEdgeSnapshot {
  if (!video.seekable.length) {
    return {
      seekableStartSeconds: null,
      seekableEndSeconds: null,
      behindLiveSeconds: null,
      atLiveEdge: true,
    };
  }

  const lastRange = video.seekable.length - 1;
  const start = video.seekable.start(lastRange);
  const end = video.seekable.end(lastRange);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return {
      seekableStartSeconds: null,
      seekableEndSeconds: null,
      behindLiveSeconds: null,
      atLiveEdge: true,
    };
  }

  const current = Number.isFinite(video.currentTime) ? video.currentTime : end;
  const behind = Math.max(0, end - current);
  return {
    seekableStartSeconds: start,
    seekableEndSeconds: end,
    behindLiveSeconds: behind,
    atLiveEdge: behind <= Math.max(0, thresholdSeconds),
  };
}

export function moveToLiveEdge(video: LiveVideoLike): boolean {
  if (!video.seekable.length) return false;
  const lastRange = video.seekable.length - 1;
  const end = video.seekable.end(lastRange);
  if (!Number.isFinite(end)) return false;
  try {
    video.currentTime = Math.max(0, end - 0.15);
    return true;
  } catch {
    return false;
  }
}

export function usefulLiveLatencyLabel(snapshot: LiveEdgeSnapshot): string | null {
  if (snapshot.behindLiveSeconds === null || snapshot.atLiveEdge) return null;
  const seconds = Math.max(1, Math.round(snapshot.behindLiveSeconds));
  return `≈ ${seconds}s behind live`;
}
