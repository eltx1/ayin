"use client";

import { useI18n } from "@/components/i18n/i18n-provider";
import { contentEditorAr, contentEditorEn } from "./resources/content-editor";
import type { TranslationKey, TranslationValues } from "./translator";

export type ContentTranslationKey = TranslationKey | keyof typeof contentEditorEn;

// Route-scoped vocabulary uses the same locale/context and interpolation contract,
// without shipping the entire editor dictionary to Home, Watch or Admin entrypoints.
export function useContentI18n() {
  const context = useI18n();
  const messages = context.locale === "ar" ? contentEditorAr : contentEditorEn;
  return {
    ...context,
    t: (key: ContentTranslationKey, values: TranslationValues = {}) => {
      if (!Object.hasOwn(messages, key)) return context.t(key as TranslationKey, values);
      return messages[key as keyof typeof messages].replace(
        /\{([a-zA-Z0-9_]+)\}/g,
        (match, token: string) => {
          const value = values[token];
          return value === undefined ? match : String(value);
        },
      );
    },
  };
}
