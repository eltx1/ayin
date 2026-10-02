import type { Locale } from "./config";
import { liveViewerAr, liveViewerEn } from "./resources/live-viewer";
import type { TranslationValues } from "./translator";

export type LiveViewerTranslationKey = keyof typeof liveViewerEn;

export function translateLiveViewer(
  locale: Locale,
  key: LiveViewerTranslationKey,
  values: TranslationValues = {},
): string {
  const template = (locale === "ar" ? liveViewerAr : liveViewerEn)[key];
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token: string) => {
    const value = values[token];
    return value === undefined ? match : String(value);
  });
}
