import type { DiscoveryRowData } from "./discovery";
import type { Locale } from "./i18n/config";
import { translateKidsDiscoverySource } from "./i18n/kids";
import {
  translatePublicDiscovery,
  type PublicDiscoveryTranslationKey,
} from "./i18n/public-discovery";

const automaticTitles: Record<string, PublicDiscoveryTranslationKey> = {
  "auto-continue-watching": "home.continue",
  "auto-movies": "home.movies",
  "auto-documentaries": "home.documentaries",
  "auto-creator-videos": "home.creators",
  "auto-clips": "home.clips",
  "auto-discover": "home.recent",
};

export function discoveryRowTitle(
  locale: Locale,
  row: DiscoveryRowData,
  kidsMode = false,
  automatic = false,
): string {
  if (kidsMode) return translateKidsDiscoverySource(locale, row.source, row.title);
  const key = automatic ? automaticTitles[row.key] : undefined;
  return key ? translatePublicDiscovery(locale, key) : row.title;
}

export function homeSectionAnchor(key: string): string {
  // An ASCII fragment ID avoids URL-decoding mismatches for Unicode row keys.
  return `discover-${Array.from(key, (character) => character.codePointAt(0)!.toString(16)).join("-")}`;
}

export function formatMediaDuration(durationMs: number | null): string | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  const total = Math.floor(durationMs / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = (total % 60).toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}
