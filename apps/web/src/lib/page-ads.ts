import { apiBaseUrl } from "./api";

export type PageAdDevice = "MOBILE" | "DESKTOP" | "TV";
export type PageAdSize = [number, number];

export interface HousePageAdDemand {
  provider: "HOUSE";
  imageUrl: string;
  clickUrl: string | null;
  altText: string;
}

export interface GoogleGptPageAdDemand {
  provider: "GOOGLE_GPT";
  adUnitPath: string;
}

export interface PageAdDecision {
  enabled: true;
  placementId: string;
  key: string;
  sizes: PageAdSize[];
  responsive: Array<{ minWidth: number; sizes: PageAdSize[] }>;
  demand: HousePageAdDemand | GoogleGptPageAdDemand;
  fallback: HousePageAdDemand | null;
}

export interface DisabledPageAdDecision {
  enabled: false;
  reason: string;
}

export function detectPageAdDevice(): PageAdDevice {
  if (window.matchMedia("(pointer: coarse) and (min-width: 1200px)").matches) return "TV";
  return window.innerWidth < 768 ? "MOBILE" : "DESKTOP";
}

export async function fetchPageAdDecision(
  key: string,
  route: string,
  device: PageAdDevice,
  signal?: AbortSignal,
) {
  const search = new URLSearchParams({ route, device });
  const response = await fetch(
    `${apiBaseUrl}/ads/page/decision/${encodeURIComponent(key)}?${search.toString()}`,
    {
      cache: "no-store",
      credentials: "include",
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) return { enabled: false, reason: "DECISION_UNAVAILABLE" } as const;
  return (await response.json()) as PageAdDecision | DisabledPageAdDecision;
}

export async function recordPageAdEvent(input: {
  key: string;
  eventType: "REQUEST" | "FILL" | "IMPRESSION" | "CLICK" | "ERROR";
  requestId: string;
  sessionId: string;
  provider: "GOOGLE_GPT" | "HOUSE";
  errorCode?: string;
}) {
  try {
    await fetch(`${apiBaseUrl}/ads/page/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify(input),
    });
  } catch {
    // Page ad telemetry must never affect the surrounding content experience.
  }
}

export function getPageAdSessionId() {
  const key = "ayin.pageAds.sessionId";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const next = crypto.randomUUID();
  sessionStorage.setItem(key, next);
  return next;
}
