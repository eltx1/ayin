import type { Locale } from "./config";
import { kidsAr, kidsEn } from "./resources/kids";

export type KidsTranslationKey = keyof typeof kidsEn;

export function translateKids(locale: Locale, key: KidsTranslationKey): string {
  return (locale === "ar" ? kidsAr : kidsEn)[key];
}
