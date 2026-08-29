import { apiBaseUrl } from "./api";

export type VideoAdSlot = "PRE_ROLL" | "MID_ROLL" | "POST_ROLL";
export type VideoAdEventType =
  | "REQUEST"
  | "FILL"
  | "IMPRESSION"
  | "START"
  | "QUARTILE_25"
  | "MIDPOINT"
  | "QUARTILE_75"
  | "COMPLETE"
  | "CLICK"
  | "ERROR";

export interface VideoAdDecision {
  enabled: true;
  provider: "GOOGLE_IMA";
  tagUrl: string;
  preRollEnabled: boolean;
  midRollEnabled: boolean;
  postRollEnabled: boolean;
  midRollEverySec: number;
  frequencyCapPerSession: number;
  attribution: { videoId: string; channelId: string };
}

export interface DisabledVideoAdDecision {
  enabled: false;
  reason: string;
}

export interface VideoAdCallbacks {
  onEvent(type: VideoAdEventType, errorCode?: string): void;
  onContentPause(): void;
  onContentResume(): void;
}

export interface VideoAdService {
  initialize(container: HTMLDivElement, contentVideo: HTMLVideoElement): Promise<void>;
  play(slot: VideoAdSlot, tagUrl: string, callbacks: VideoAdCallbacks): Promise<void>;
  contentComplete(): void;
  destroy(): void;
}

export async function fetchVideoAdDecision(videoId: string, signal?: AbortSignal) {
  const response = await fetch(`${apiBaseUrl}/ads/video/decision/${encodeURIComponent(videoId)}`, {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok)
    return { enabled: false, reason: "DECISION_UNAVAILABLE" } as DisabledVideoAdDecision;
  return (await response.json()) as VideoAdDecision | DisabledVideoAdDecision;
}

export function getVideoAdSessionId(): string {
  const key = "ayin.videoAds.sessionId";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const next = crypto.randomUUID();
  sessionStorage.setItem(key, next);
  return next;
}

export function canServeSessionAd(cap: number): boolean {
  if (cap <= 0) return true;
  return Number(sessionStorage.getItem("ayin.videoAds.count") ?? "0") < cap;
}

export function markSessionAdServed(): void {
  const count = Number(sessionStorage.getItem("ayin.videoAds.count") ?? "0");
  sessionStorage.setItem("ayin.videoAds.count", String(count + 1));
}

export async function recordVideoAdEvent(input: {
  videoId: string;
  slot: VideoAdSlot;
  eventType: VideoAdEventType;
  requestId: string;
  sessionId: string;
  provider: "GOOGLE_IMA";
  errorCode?: string;
}) {
  try {
    await fetch(`${apiBaseUrl}/ads/video/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify(input),
    });
  } catch {
    // Advertising telemetry is best-effort and must never block content playback.
  }
}
