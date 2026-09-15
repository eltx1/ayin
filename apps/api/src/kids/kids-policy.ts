export const KIDS_ALLOWED_DISCOVERY_SOURCES = new Set(["NEW_ON_AYIN", "MOVIES", "RECENTLY_ADDED"]);

export function isKidsDiscoverySourceAllowed(source: string): boolean {
  return KIDS_ALLOWED_DISCOVERY_SOURCES.has(source);
}

export function isKidsSearchResultTypeAllowed(type: string): boolean {
  return type === "VIDEO";
}

export function kidsSafeHref(href: string): string {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}kids=1`;
}

export const KIDS_SURFACE_POLICY = {
  mode: "KIDS" as const,
  contentEligibility: "EXPLICIT_KIDS_CLASSIFICATION_REQUIRED" as const,
  advertising: {
    inventoryClass: "KIDS" as const,
    personalizedTargetingAllowed: false,
  },
  socialCommunity: {
    enabled: false,
  },
  legalReview: {
    required: true,
    complianceClaimed: false,
  },
};
