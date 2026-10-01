import type { Locale } from "./config";
import type { TranslationValues } from "./translator";
import { communityAr, communityEn } from "./resources/community";

export type CommunityTranslationKey = keyof typeof communityEn;

export function translateCommunity(
  locale: Locale,
  key: CommunityTranslationKey,
  values: TranslationValues = {},
): string {
  const template = (locale === "ar" ? communityAr : communityEn)[key];
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token: string) => {
    const value = values[token];
    return value === undefined ? match : String(value);
  });
}
