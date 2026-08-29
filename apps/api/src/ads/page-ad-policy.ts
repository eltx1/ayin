export type PageAdDevice = "MOBILE" | "DESKTOP" | "TV";
export type PageAdAudience = "ANY" | "SIGNED_IN" | "SIGNED_OUT";

export interface PageAdPlacementConfig {
  routePatterns: string[];
  sizes: [number, number][];
  responsive: Array<{ minWidth: number; sizes: [number, number][] }>;
  devices: PageAdDevice[];
  audience: PageAdAudience;
  categories: string[];
  demand: {
    source: "GOOGLE_GPT" | "HOUSE";
    adUnitPath: string | null;
  };
  fallback: "HOUSE" | "COLLAPSE";
}

export interface PageAdContext {
  route: string;
  device: PageAdDevice;
  signedIn: boolean;
  category: string | null;
}

function routeMatches(pattern: string, route: string) {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return route.startsWith(pattern.slice(0, -1));
  return pattern === route;
}

export function isPageAdEligible(config: PageAdPlacementConfig, context: PageAdContext) {
  if (!config.devices.includes(context.device)) return false;
  if (!config.routePatterns.some((pattern) => routeMatches(pattern, context.route))) return false;
  if (config.audience === "SIGNED_IN" && !context.signedIn) return false;
  if (config.audience === "SIGNED_OUT" && context.signedIn) return false;
  if (
    config.categories.length > 0 &&
    (!context.category || !config.categories.includes(context.category))
  ) {
    return false;
  }
  return true;
}
