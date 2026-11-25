import { apiBaseUrl } from "./api";

export interface PageAdLayoutSlot {
  key: string;
  routePatterns: string[];
  /** Reserved ad height in CSS pixels below 768px; 0 when the slot does not serve there. */
  mobile: number;
  /** Reserved ad height in CSS pixels from 768px; 0 when the slot does not serve there. */
  desktop: number;
}

/** Label (15px), gap (0.45rem) and padding (2 × 0.55rem) the slot draws around the creative. */
export const PAGE_AD_CHROME_PX = 40;

export function pageAdRouteMatches(pattern: string, route: string) {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return route.startsWith(pattern.slice(0, -1));
  return pattern === route;
}

function isLayoutSlot(value: unknown): value is PageAdLayoutSlot {
  if (!value || typeof value !== "object") return false;
  const slot = value as Record<string, unknown>;
  return (
    typeof slot.key === "string" &&
    Array.isArray(slot.routePatterns) &&
    slot.routePatterns.every((pattern) => typeof pattern === "string") &&
    typeof slot.mobile === "number" &&
    typeof slot.desktop === "number" &&
    slot.mobile >= 0 &&
    slot.mobile <= 1200 &&
    slot.desktop >= 0 &&
    slot.desktop <= 1200
  );
}

/**
 * Server-side: the slots that serve right now and the space they reserve. Cached briefly and
 * bounded in time; any failure means "reserve nothing", which is the behaviour before this existed.
 */
export async function fetchPageAdLayout(): Promise<PageAdLayoutSlot[]> {
  try {
    const response = await fetch(`${apiBaseUrl}/ads/page/layout`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { slots?: unknown };
    return Array.isArray(body.slots) ? body.slots.filter(isLayoutSlot) : [];
  } catch {
    return [];
  }
}
