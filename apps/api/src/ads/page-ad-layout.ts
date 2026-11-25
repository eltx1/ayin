import type { PageAdPlacementConfig } from "./page-ad-policy.js";

/** Reference viewport widths for the two reserved-space breakpoints used by the web layout. */
const MOBILE_WIDTH = 360;
const DESKTOP_WIDTH = 1280;

export interface PageAdLayoutSlot {
  key: string;
  routePatterns: string[];
  /** Reserved ad height in CSS pixels below 768px (0 = not shown there). */
  mobile: number;
  /** Reserved ad height in CSS pixels from 768px (0 = not shown there). */
  desktop: number;
}

type Size = [number, number];

function sizesAt(config: Pick<PageAdPlacementConfig, "sizes" | "responsive">, width: number) {
  const mapping = [...config.responsive]
    .filter((entry) => entry.minWidth <= width)
    .sort((a, b) => b.minWidth - a.minWidth)[0];
  if (mapping) return mapping.sizes as Size[];
  const fitting = (config.sizes as Size[]).filter(([w]) => w <= width);
  return fitting.length > 0 ? fitting : (config.sizes as Size[]);
}

/**
 * The height to hold open before an ad arrives so the page does not jump (CLS). Ad Manager units
 * reserve their tallest mapped size, because Google may serve any of them. Pasted code reserves the
 * administrator's fixed height, or else the smallest expected banner, which keeps a gap minimal when
 * the network serves a short creative and still removes most of the shift.
 */
export function reservedAdHeight(config: PageAdPlacementConfig, width: number): number {
  if (config.demand.source === "CODE" && config.demand.height) return config.demand.height;
  const heights = sizesAt(config, width).map(([, h]) => h);
  if (heights.length === 0) return 0;
  return config.demand.source === "CODE" ? Math.min(...heights) : Math.max(...heights);
}

export function pageAdLayoutSlot(key: string, config: PageAdPlacementConfig): PageAdLayoutSlot {
  const onMobile = config.devices.includes("MOBILE");
  const onDesktop = config.devices.includes("DESKTOP") || config.devices.includes("TV");
  return {
    key,
    routePatterns: config.routePatterns,
    mobile: onMobile ? reservedAdHeight(config, MOBILE_WIDTH) : 0,
    desktop: onDesktop ? reservedAdHeight(config, DESKTOP_WIDTH) : 0,
  };
}
