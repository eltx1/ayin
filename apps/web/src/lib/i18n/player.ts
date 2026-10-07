import type { Locale } from "./config";
import { formatNumber } from "./format";
import { playerAr, playerEn } from "./resources/player";
import type { TranslationValues } from "./translator";

export type PlayerTranslationKey = keyof typeof playerEn;

export function translatePlayer(
  locale: Locale,
  key: PlayerTranslationKey,
  values: TranslationValues = {},
): string {
  const template = (locale === "ar" ? playerAr : playerEn)[key] ?? playerEn[key];
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token: string) => {
    const value = values[token];
    return value === undefined ? match : String(value);
  });
}

export function formatPlayerTime(milliseconds: number, locale: Locale): string {
  const totalSeconds = Number.isFinite(milliseconds)
    ? Math.max(0, Math.floor(milliseconds / 1000))
    : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const number = (value: number, minimumIntegerDigits = 1) =>
    formatNumber(value, locale, { minimumIntegerDigits, useGrouping: false });
  return hours > 0
    ? `${number(hours)}:${number(minutes, 2)}:${number(seconds, 2)}`
    : `${number(minutes)}:${number(seconds, 2)}`;
}
