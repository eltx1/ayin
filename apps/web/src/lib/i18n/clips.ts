import type { Locale } from "./config";
import { clipsAr, clipsEn } from "./resources/clips";
import type { TranslationValues } from "./translator";

export type ClipsTranslationKey = keyof typeof clipsEn;

export function translateClips(
  locale: Locale,
  key: ClipsTranslationKey,
  values: TranslationValues = {},
): string {
  const template = (locale === "ar" ? clipsAr : clipsEn)[key];
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token: string) => {
    const value = values[token];
    return value === undefined ? match : String(value);
  });
}
