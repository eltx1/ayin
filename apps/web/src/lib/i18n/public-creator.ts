import type { Locale } from "./config";
import { publicCreatorAr, publicCreatorEn } from "./resources/public-creator";
import type { TranslationValues } from "./translator";

export type PublicCreatorTranslationKey = keyof typeof publicCreatorEn;

export function translatePublicCreator(
  locale: Locale,
  key: PublicCreatorTranslationKey,
  values: TranslationValues = {},
): string {
  const template = (locale === "ar" ? publicCreatorAr : publicCreatorEn)[key];
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token: string) => {
    const value = values[token];
    return value === undefined ? match : String(value);
  });
}
