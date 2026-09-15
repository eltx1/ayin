"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";

import { type Locale, getTextDirection } from "@/lib/i18n/config";
import { formatDate, formatNumber } from "@/lib/i18n/format";
import { localizeInternalHref } from "@/lib/i18n/routing";
import { translate, type TranslationKey, type TranslationValues } from "@/lib/i18n/translator";

interface I18nContextValue {
  locale: Locale;
  direction: "ltr" | "rtl";
  t: (key: TranslationKey, values?: TranslationValues) => string;
  href: (value: string) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children, locale }: { children: ReactNode; locale: Locale }) {
  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      direction: getTextDirection(locale),
      t: (key, values) => translate(locale, key, values),
      href: (target) => localizeInternalHref(target, locale),
      formatNumber: (number, options) => formatNumber(number, locale, options),
      formatDate: (date, options) => formatDate(date, locale, options),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
