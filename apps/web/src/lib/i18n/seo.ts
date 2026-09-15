import { absoluteUrl } from "@/lib/seo";

import { defaultLocale, isLocale, type Locale, supportedLocales } from "./config";
import { localizePath } from "./routing";

export function localizedAlternates(path: string, locale: Locale) {
  const languages = Object.fromEntries(
    supportedLocales.map((supportedLocale) => [
      supportedLocale,
      absoluteUrl(localizePath(path, supportedLocale)),
    ]),
  ) as Record<Locale, string>;

  return {
    canonical: absoluteUrl(localizePath(path, locale)),
    languages: {
      ...languages,
      "x-default": absoluteUrl(localizePath(path, defaultLocale)),
    },
  };
}

export function localizedSitemapLinks(path: string) {
  return [
    ...supportedLocales.map((locale) => ({
      hreflang: locale,
      href: absoluteUrl(localizePath(path, locale)),
    })),
    {
      hreflang: "x-default",
      href: absoluteUrl(localizePath(path, defaultLocale)),
    },
  ];
}

export function localizedEntityAlternates(
  path: string,
  requestedLocale: Locale,
  availableLocales: readonly string[],
) {
  const locales = entityLocales(availableLocales);
  const canonicalLocale = locales.includes(requestedLocale) ? requestedLocale : defaultLocale;
  const languages = Object.fromEntries(
    locales.map((locale) => [locale, absoluteUrl(localizePath(path, locale))]),
  ) as Partial<Record<Locale, string>>;

  return {
    canonical: absoluteUrl(localizePath(path, canonicalLocale)),
    languages: {
      ...languages,
      "x-default": absoluteUrl(localizePath(path, defaultLocale)),
    },
  };
}

export function localizedEntitySitemapLinks(path: string, availableLocales: readonly string[]) {
  const locales = entityLocales(availableLocales);
  return [
    ...locales.map((locale) => ({
      hreflang: locale,
      href: absoluteUrl(localizePath(path, locale)),
    })),
    {
      hreflang: "x-default",
      href: absoluteUrl(localizePath(path, defaultLocale)),
    },
  ];
}

function entityLocales(availableLocales: readonly string[]): Locale[] {
  const localized = new Set<Locale>([defaultLocale]);
  for (const value of availableLocales) {
    const normalized = value.trim().toLowerCase();
    if (isLocale(normalized)) localized.add(normalized);
  }
  return supportedLocales.filter((locale) => localized.has(locale));
}
