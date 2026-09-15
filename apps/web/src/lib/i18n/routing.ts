import { defaultLocale, isLocale, type Locale, supportedLocales } from "./config";

export interface LocaleResolutionInput {
  pathname?: string | null;
  cookieLocale?: string | null;
  acceptLanguage?: string | null;
}

function splitPathAndSuffix(input: string): { pathname: string; suffix: string } {
  const match = input.match(/^([^?#]*)(.*)$/);
  return {
    pathname: match?.[1] || "/",
    suffix: match?.[2] || "",
  };
}

export function localeFromPath(pathname: string): Locale | null {
  const firstSegment = pathname.split("/").filter(Boolean)[0];
  return isLocale(firstSegment) ? firstSegment : null;
}

export function stripLocalePrefix(input: string): string {
  const { pathname, suffix } = splitPathAndSuffix(input);
  const locale = localeFromPath(pathname);
  if (!locale) return `${pathname || "/"}${suffix}`;

  const segments = pathname.split("/").filter(Boolean);
  const stripped = `/${segments.slice(1).join("/")}`;
  return `${stripped === "/" || stripped === "" ? "/" : stripped}${suffix}`;
}

export function localizePath(input: string, locale: Locale): string {
  const normalized = stripLocalePrefix(input);
  const { pathname, suffix } = splitPathAndSuffix(normalized);
  if (locale === defaultLocale) return `${pathname || "/"}${suffix}`;
  const path = pathname === "/" ? "" : pathname;
  return `/${locale}${path}${suffix}`;
}

export function parseAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;

  const candidates = header
    .split(",")
    .map((part, index) => {
      const [rawTag, ...params] = part.trim().split(";");
      const tag = rawTag?.toLowerCase() ?? "";
      const qParam = params.find((param) => param.trim().startsWith("q="));
      const quality = qParam ? Number(qParam.trim().slice(2)) : 1;
      return { tag, quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((item) => item.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);

  for (const candidate of candidates) {
    const exact = supportedLocales.find((locale) => candidate.tag === locale);
    if (exact) return exact;
    const base = candidate.tag.split("-")[0];
    if (isLocale(base)) return base;
  }

  return null;
}

export function resolveLocale({
  pathname = "/",
  cookieLocale,
  acceptLanguage,
}: LocaleResolutionInput): Locale {
  const pathLocale = localeFromPath(pathname || "/");
  if (pathLocale) return pathLocale;
  if (isLocale(cookieLocale)) return cookieLocale;
  return parseAcceptLanguage(acceptLanguage) ?? defaultLocale;
}

export function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

export function localizeInternalHref(href: string, locale: Locale): string {
  return isInternalHref(href) ? localizePath(href, locale) : href;
}

export function localeSwitchHref(pathname: string, locale: Locale): string {
  const basePath = stripLocalePrefix(pathname || "/");
  const separator = basePath.includes("?") ? "&" : "?";
  return `${basePath}${separator}lang=${locale}`;
}
