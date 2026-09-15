import { absoluteUrl } from "@/lib/seo";

import { defaultLocale, type Locale, supportedLocales } from "./config";
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
