import type { Locale } from "./config";
import { arMessages } from "./resources/ar";
import { enMessages, type TranslationKey as CoreTranslationKey } from "./resources/en";
import { navigationAr, navigationEn } from "./resources/navigation";
import { studioFeedbackAr, studioFeedbackEn } from "./resources/studio-feedback";
import { playlistAr, playlistEn } from "./resources/playlists";
import { authRecoveryAr, authRecoveryEn } from "./resources/auth-recovery";

export type TranslationKey =
  | CoreTranslationKey
  | keyof typeof navigationEn
  | keyof typeof studioFeedbackEn
  | keyof typeof playlistEn
  | keyof typeof authRecoveryEn;

const english = {
  ...enMessages,
  ...navigationEn,
  ...studioFeedbackEn,
  ...playlistEn,
  ...authRecoveryEn,
};
const resources: Record<Locale, Partial<Record<TranslationKey, string>>> = {
  en: english,
  ar: { ...arMessages, ...navigationAr, ...studioFeedbackAr, ...playlistAr, ...authRecoveryAr },
};

export type TranslationValues = Record<string, string | number>;

export function translate(
  locale: Locale,
  key: TranslationKey,
  values: TranslationValues = {},
): string {
  const template = resources[locale][key] ?? english[key];
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token: string) => {
    const value = values[token];
    return value === undefined ? match : String(value);
  });
}

export function hasTranslation(locale: Locale, key: TranslationKey): boolean {
  return resources[locale][key] !== undefined;
}
