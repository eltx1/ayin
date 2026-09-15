export const CATALOG_GLOBAL_FALLBACK_LOCALE = "en";

export interface CatalogLocalizationCopy {
  locale: string;
  title?: string | null;
  synopsis?: string | null;
  shortDescription?: string | null;
}

export interface CatalogPrimaryCopy {
  title?: string | null;
  synopsis?: string | null;
  shortDescription?: string | null;
}

export interface ResolvedCatalogCopy {
  locale: string;
  title: string | null;
  synopsis: string | null;
  shortDescription: string | null;
  availableLocales: string[];
  source: {
    title: "requested" | "primary" | "english" | "none";
    synopsis: "requested" | "primary" | "english" | "none";
    shortDescription: "requested" | "primary" | "english" | "none";
  };
}

export function normalizeCatalogLocale(value?: string | null) {
  const locale = value?.trim().replace(/_/g, "-").toLowerCase() ?? "";
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(locale) ? locale : CATALOG_GLOBAL_FALLBACK_LOCALE;
}

function clean(value?: string | null) {
  const result = value?.trim();
  return result ? result : null;
}

function selectField(
  requested: string | null | undefined,
  primary: string | null | undefined,
  english: string | null | undefined,
) {
  const requestedValue = clean(requested);
  if (requestedValue) return { value: requestedValue, source: "requested" as const };
  const primaryValue = clean(primary);
  if (primaryValue) return { value: primaryValue, source: "primary" as const };
  const englishValue = clean(english);
  if (englishValue) return { value: englishValue, source: "english" as const };
  return { value: null, source: "none" as const };
}

export function resolveCatalogCopy(
  requestedLocale: string | null | undefined,
  primary: CatalogPrimaryCopy,
  localizations: ReadonlyArray<CatalogLocalizationCopy>,
): ResolvedCatalogCopy {
  const locale = normalizeCatalogLocale(requestedLocale);
  const byLocale = new Map(
    localizations.map((item) => [normalizeCatalogLocale(item.locale), item] as const),
  );
  const requested = byLocale.get(locale);
  const english = byLocale.get(CATALOG_GLOBAL_FALLBACK_LOCALE);
  const title = selectField(requested?.title, primary.title, english?.title);
  const synopsis = selectField(requested?.synopsis, primary.synopsis, english?.synopsis);
  const shortDescription = selectField(
    requested?.shortDescription,
    primary.shortDescription,
    english?.shortDescription,
  );

  return {
    locale,
    title: title.value,
    synopsis: synopsis.value,
    shortDescription: shortDescription.value,
    availableLocales: [...new Set(localizations.map((item) => normalizeCatalogLocale(item.locale)))].sort(),
    source: {
      title: title.source,
      synopsis: synopsis.source,
      shortDescription: shortDescription.source,
    },
  };
}

export function compactDescription(value?: string | null, maxLength = 280) {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}
