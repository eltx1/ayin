import type { Locale } from "./config";
import { publicDiscoveryAr, publicDiscoveryEn } from "./resources/public-discovery";

export type PublicDiscoveryTranslationKey = keyof typeof publicDiscoveryEn;

export function translatePublicDiscovery(
  locale: Locale,
  key: PublicDiscoveryTranslationKey,
): string {
  return (locale === "ar" ? publicDiscoveryAr : publicDiscoveryEn)[key];
}
