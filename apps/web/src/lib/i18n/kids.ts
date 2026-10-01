import type { Locale } from "./config";
import { kidsAr, kidsEn } from "./resources/kids";

export type KidsTranslationKey = keyof typeof kidsEn;

export function translateKids(locale: Locale, key: KidsTranslationKey): string {
  return (locale === "ar" ? kidsAr : kidsEn)[key];
}

const kidsDiscoverySourceKeys: Record<string, KidsTranslationKey> = {
  NEW_ON_AYIN: "kids.rowNewOnAyin",
  MOVIES: "kids.rowMovies",
  RECENTLY_ADDED: "kids.rowRecentlyAdded",
};

export function translateKidsDiscoverySource(
  locale: Locale,
  source: string | undefined,
  fallback: string,
): string {
  const key = source ? kidsDiscoverySourceKeys[source] : undefined;
  return key ? translateKids(locale, key) : fallback;
}
