export type SearchLanguage = "ar" | "en" | "und";
export type SearchTextConfiguration = "english" | "simple";

export interface SearchLanguageSelection {
  queryLanguage: SearchLanguage;
  uiLanguage: SearchLanguage;
  preferredLanguage: SearchLanguage;
  textSearchConfiguration: SearchTextConfiguration;
  matchQuery: string;
}

const supportedLanguageBases = new Set<SearchLanguage>(["ar", "en"]);
const arabicScript = /\p{Script=Arabic}/u;
const latinScript = /\p{Script=Latin}/u;
const arabicSearchNoise = /(?:ـ|ً|ٌ|ٍ|َ|ُ|ِ|ّ|ْ|ٰ)/gu;
const arabicAlefVariants = /[أإآٱ]/g;

export function resolveSearchLanguage(
  query: string,
  uiLocale?: string | null,
): SearchLanguageSelection {
  const queryLanguage = detectSearchLanguage(query);
  const uiLanguage = languageFromLocale(uiLocale);
  const preferredLanguage = queryLanguage !== "und" ? queryLanguage : uiLanguage;
  return {
    queryLanguage,
    uiLanguage,
    preferredLanguage,
    textSearchConfiguration: preferredLanguage === "en" ? "english" : "simple",
    matchQuery: queryLanguage === "ar" ? normalizeArabicForSearch(query) : query,
  };
}

export function detectSearchLanguage(value: string): SearchLanguage {
  let arabic = 0;
  let latin = 0;
  for (const character of value) {
    if (arabicScript.test(character)) arabic += 1;
    else if (latinScript.test(character)) latin += 1;
  }
  if (arabic > latin) return "ar";
  if (latin > arabic) return "en";
  return "und";
}

export function languageFromLocale(locale?: string | null): SearchLanguage {
  const base = locale?.trim().replaceAll("_", "-").split("-")[0]?.toLocaleLowerCase();
  return base && supportedLanguageBases.has(base as SearchLanguage)
    ? (base as SearchLanguage)
    : "und";
}

/**
 * Conservative matching-only normalization for Arabic. Stored/display text is never changed.
 * We unify common Alef forms and Alef Maqsura, and remove tatweel/common harakat.
 * Ta Marbuta, Hamza-on-Waw/Ya and lexical letters intentionally remain distinct.
 */
export function normalizeArabicForSearch(value: string): string {
  return value
    .normalize("NFKC")
    .replace(arabicAlefVariants, "ا")
    .replaceAll("ى", "ي")
    .replace(arabicSearchNoise, "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ar");
}
