"use client";

import { useCallback } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";

import {
  lensReasonKey,
  localizeMyAyinSection,
  translateMyAyin,
  type MyAyinTranslationKey,
} from "./my-ayin-copy";
import type { TranslationValues } from "./translator";

export { lensReasonKey, localizeMyAyinSection };

export function useMyAyinI18n() {
  const context = useI18n();
  const t = useCallback(
    (key: MyAyinTranslationKey, values: TranslationValues = {}) =>
      translateMyAyin(context.locale, key, values),
    [context.locale],
  );
  return { ...context, t };
}
