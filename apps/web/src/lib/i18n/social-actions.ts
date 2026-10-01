import type { Locale } from "./config";
import { socialActionsAr, socialActionsEn } from "./resources/social-actions";

export type SocialActionTranslationKey = keyof typeof socialActionsEn;

export function translateSocialAction(locale: Locale, key: SocialActionTranslationKey): string {
  return (locale === "ar" ? socialActionsAr : socialActionsEn)[key];
}
