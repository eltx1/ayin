"use client";

import { useCallback } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import type { Locale } from "@/lib/i18n/config";
import type { DiscoveryRowData } from "@/lib/discovery";

import { myAyinAr, myAyinEn } from "./resources/my-ayin";
import type { TranslationValues } from "./translator";

export type MyAyinTranslationKey = keyof typeof myAyinEn;

export function translateMyAyin(
  locale: Locale,
  key: MyAyinTranslationKey,
  values: TranslationValues = {},
): string {
  const template = (locale === "ar" ? myAyinAr : myAyinEn)[key];
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token: string) => {
    const value = values[token];
    return value === undefined ? match : String(value);
  });
}

export function useMyAyinI18n() {
  const context = useI18n();
  const t = useCallback(
    (key: MyAyinTranslationKey, values: TranslationValues = {}) =>
      translateMyAyin(context.locale, key, values),
    [context.locale],
  );
  return { ...context, t };
}

const sectionCopy: Record<
  string,
  { title: MyAyinTranslationKey; empty: MyAyinTranslationKey }
> = {
  "continue-watching": {
    title: "myAyin.continueWatching",
    empty: "myAyin.continueWatchingEmpty",
  },
  "my-list": { title: "myAyin.myList", empty: "myAyin.myListEmpty" },
  "watch-later": { title: "myAyin.watchLater", empty: "myAyin.watchLaterEmpty" },
  history: { title: "myAyin.history", empty: "myAyin.historyEmpty" },
  liked: { title: "myAyin.liked", empty: "myAyin.likedEmpty" },
  playlists: { title: "myAyin.playlists", empty: "myAyin.playlistsEmpty" },
};

export function localizeMyAyinSection(locale: Locale, row: DiscoveryRowData): DiscoveryRowData {
  const copy = sectionCopy[row.key];
  return copy
    ? {
        ...row,
        title: translateMyAyin(locale, copy.title),
        emptyMessage: translateMyAyin(locale, copy.empty),
      }
    : row;
}

export function lensReasonKey(code: string): MyAyinTranslationKey {
  switch (code) {
    case "FOLLOWED_CHANNEL":
      return "lens.reasonFollowed";
    case "LIKED_CHANNEL":
      return "lens.reasonLiked";
    case "COMPLETED_CHANNEL":
      return "lens.reasonCompleted";
    case "CHANNEL_AFFINITY":
      return "lens.reasonAffinity";
    case "RELATED_CHANNEL":
      return "lens.reasonRelated";
    case "POPULAR":
      return "lens.reasonPopular";
    case "RECENT":
      return "lens.reasonRecent";
    case "SAFE_FALLBACK":
      return "lens.reasonFallback";
    default:
      return "lens.reasonOther";
  }
}
