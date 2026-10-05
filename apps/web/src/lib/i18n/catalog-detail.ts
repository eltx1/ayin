import type { Locale } from "./config";
import { catalogDetailAr, catalogDetailEn } from "./resources/catalog-detail";
import type { TranslationValues } from "./translator";

export type CatalogDetailTranslationKey = keyof typeof catalogDetailEn;

export function translateCatalogDetail(
  locale: Locale,
  key: CatalogDetailTranslationKey,
  values: TranslationValues = {},
): string {
  const template = (locale === "ar" ? catalogDetailAr : catalogDetailEn)[key];
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token: string) => {
    const value = values[token];
    return value === undefined ? match : String(value);
  });
}
