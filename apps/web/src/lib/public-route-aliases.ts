import { localeFromPath, localizePath, stripLocalePrefix } from "./i18n/routing";
import type { Locale } from "./i18n/config";

export const publicRouteAliases: Readonly<Record<string, string>> = {
  "/shorts": "/clips",
  "/uploads": "/upload",
};
export function canonicalPublicPath(pathname: string, fallbackLocale: Locale = "en"): string {
  const source = stripLocalePrefix(pathname).replace(/\/$/, "") || "/";
  const target = publicRouteAliases[source];
  return target ? localizePath(target, localeFromPath(pathname) ?? fallbackLocale) : pathname;
}
