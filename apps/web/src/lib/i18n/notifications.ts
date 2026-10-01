import type { Locale } from "./config";
import type { TranslationValues } from "./translator";
import { notificationsAr, notificationsEn } from "./resources/notifications";

export type NotificationTranslationKey = keyof typeof notificationsEn;

export function translateNotification(
  locale: Locale,
  key: NotificationTranslationKey,
  values: TranslationValues = {},
): string {
  const template = (locale === "ar" ? notificationsAr : notificationsEn)[key];
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token: string) => {
    const value = values[token];
    return value === undefined ? match : String(value);
  });
}
