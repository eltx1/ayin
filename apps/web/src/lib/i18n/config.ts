export const supportedLocales = ["en", "ar"] as const;

export type Locale = (typeof supportedLocales)[number];
export type TextDirection = "ltr" | "rtl";

export const defaultLocale: Locale = "en";
export const localeCookieName = "ayin_locale";
export const requestLocaleHeader = "x-ayin-locale";

const directions: Record<Locale, TextDirection> = {
  en: "ltr",
  ar: "rtl",
};

const intlLocales: Record<Locale, string> = {
  en: "en-US",
  ar: "ar-EG",
};

export function isLocale(value: string | null | undefined): value is Locale {
  return Boolean(value && supportedLocales.includes(value as Locale));
}

export function getTextDirection(locale: Locale): TextDirection {
  return directions[locale];
}

export function getIntlLocale(locale: Locale): string {
  return intlLocales[locale];
}
