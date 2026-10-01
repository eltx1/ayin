import type { Locale } from "./config";
import type { TranslationValues } from "./translator";
import { communityViewerAr, communityViewerEn } from "./resources/community-viewer";

export type CommunityViewerTranslationKey = keyof typeof communityViewerEn;

export function translateCommunityViewer(
  locale: Locale,
  key: CommunityViewerTranslationKey,
  values: TranslationValues = {},
): string {
  const template = (locale === "ar" ? communityViewerAr : communityViewerEn)[key];
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token: string) => {
    const value = values[token];
    return value === undefined ? match : String(value);
  });
}
