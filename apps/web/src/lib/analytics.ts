"use client";

import type { AyinPlayerAnalytics, AyinPlayerAnalyticsEvent } from "./ayin-player";
import { apiBaseUrl } from "./api";

export type AnalyticsEventName =
  | "APP_OPEN"
  | "SESSION_OPEN"
  | "CONTENT_IMPRESSION"
  | "CONTENT_CLICK"
  | "VIDEO_START"
  | "VIDEO_PROGRESS"
  | "VIDEO_COMPLETE"
  | "VIDEO_PAUSE"
  | "VIDEO_SEEK"
  | "VIDEO_BUFFER"
  | "SEARCH"
  | "SEARCH_CLICK"
  | "SUBSCRIBE"
  | "LIKE"
  | "COMMENT"
  | "SHARE"
  | "TV_START"
  | "UPLOAD_START"
  | "UPLOAD_COMPLETE"
  | "PUBLISH"
  | "AD_REQUEST"
  | "AD_START"
  | "AD_QUARTILE"
  | "AD_COMPLETE"
  | "AD_CLICK"
  | "AD_ERROR";

type Primitive = string | number | boolean | null;

interface QueuedEvent {
  clientEventId: string;
  schemaVersion: 1;
  eventName: AnalyticsEventName;
  occurredAt: string;
  sessionId: string;
  profileId?: string | null;
  videoId?: string | null;
  channelId?: string | null;
  source: "WEB" | "PWA";
  deviceClass: "MOBILE" | "TABLET" | "DESKTOP" | "TV" | "UNKNOWN";
  durationDeltaMs?: number | null;
  positionMs?: number | null;
  metadata?: Record<string, Primitive>;
}

const queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let lifecycleBound = false;

function sessionId() {
  if (typeof window === "undefined") return "server-session-unavailable";
  const key = "ayin.analytics.session.v1";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const next = crypto.randomUUID();
  sessionStorage.setItem(key, next);
  return next;
}

function source(): "WEB" | "PWA" {
  return window.matchMedia?.("(display-mode: standalone)").matches ? "PWA" : "WEB";
}

function deviceClass(): QueuedEvent["deviceClass"] {
  const width = window.innerWidth;
  if (window.matchMedia?.("(pointer: coarse) and (min-width: 1100px)").matches) return "TV";
  if (width < 640) return "MOBILE";
  if (width < 1024) return "TABLET";
  return "DESKTOP";
}

function bindLifecycle() {
  if (lifecycleBound || typeof window === "undefined") return;
  lifecycleBound = true;
  const flush = () => void flushAnalytics(true);
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

export function trackAnalyticsEvent(
  eventName: AnalyticsEventName,
  input: Omit<
    Partial<QueuedEvent>,
    | "clientEventId"
    | "schemaVersion"
    | "eventName"
    | "occurredAt"
    | "sessionId"
    | "source"
    | "deviceClass"
  > = {},
) {
  if (typeof window === "undefined") return;
  bindLifecycle();
  queue.push({
    clientEventId: crypto.randomUUID(),
    schemaVersion: 1,
    eventName,
    occurredAt: new Date().toISOString(),
    sessionId: sessionId(),
    source: source(),
    deviceClass: deviceClass(),
    ...input,
  });
  if (queue.length >= 20) {
    void flushAnalytics();
    return;
  }
  if (!timer) timer = setTimeout(() => void flushAnalytics(), 3000);
}

export async function flushAnalytics(keepalive = false) {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!queue.length || typeof window === "undefined") return;
  const events = queue.splice(0, 100);
  const payload = JSON.stringify({ events });
  const url = `${apiBaseUrl}/analytics/events`;
  if (keepalive && navigator.sendBeacon) {
    const sent = navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
    if (sent) return;
  }
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      credentials: "include",
      keepalive,
    });
  } catch {
    // Analytics must never block or break product behavior.
  }
}

export function createPlayerAnalytics(profileId?: string): AyinPlayerAnalytics {
  let lastProgressMs: number | null = null;
  let started = false;
  return {
    emit(event: AyinPlayerAnalyticsEvent) {
      const common = {
        videoId: event.videoId,
        ...(profileId ? { profileId } : {}),
      };
      switch (event.type) {
        case "play":
          trackAnalyticsEvent(started ? "CONTENT_CLICK" : "VIDEO_START", common);
          started = true;
          break;
        case "pause":
          trackAnalyticsEvent("VIDEO_PAUSE", { ...common, positionMs: event.positionMs });
          break;
        case "seek":
          lastProgressMs = event.positionMs;
          trackAnalyticsEvent("VIDEO_SEEK", { ...common, positionMs: event.positionMs });
          break;
        case "buffer":
          trackAnalyticsEvent("VIDEO_BUFFER", { ...common, positionMs: event.positionMs });
          break;
        case "progress_checkpoint": {
          const delta =
            lastProgressMs === null
              ? Math.min(15_000, event.positionMs)
              : Math.max(0, Math.min(60_000, event.positionMs - lastProgressMs));
          lastProgressMs = event.positionMs;
          trackAnalyticsEvent("VIDEO_PROGRESS", {
            ...common,
            positionMs: event.positionMs,
            durationDeltaMs: delta,
          });
          break;
        }
        case "complete":
          trackAnalyticsEvent("VIDEO_COMPLETE", common);
          break;
        case "error":
          trackAnalyticsEvent("VIDEO_BUFFER", {
            ...common,
            metadata: { message: event.message.slice(0, 200) },
          });
          break;
        case "next":
          trackAnalyticsEvent("CONTENT_CLICK", { ...common, metadata: { action: "next" } });
          break;
        case "ad_mode":
          break;
      }
    },
  };
}
