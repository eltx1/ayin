"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { apiBaseUrl } from "@/lib/api";
import { normalizeSearchTerm, type SearchSuggestion } from "@/lib/search";

import styles from "./search.module.css";

export function SearchBox({ initialQuery = "" }: { initialQuery?: string }) {
  const { href, locale, t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);

  useEffect(() => {
    const normalized = normalizeSearchTerm(query);
    if (normalized.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `${apiBaseUrl}/public/search/suggestions?q=${encodeURIComponent(normalized)}`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const body = (await response.json()) as { suggestions: SearchSuggestion[] };
        setSuggestions(body.suggestions);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setSuggestions([]);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  const visibleSuggestions = normalizeSearchTerm(query).length >= 2 ? suggestions : [];

  return (
    <div className={styles.searchBox}>
      <form action={href("/search")} role="search">
        <label htmlFor="ayin-search">{t("search.label")}</label>
        <div className={styles.searchControls}>
          <input
            autoComplete="off"
            dir="auto"
            id="ayin-search"
            maxLength={100}
            minLength={2}
            name="q"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search.placeholder")}
            required
            type="search"
            value={query}
          />
          <button data-tv-focusable="true" type="submit">
            {t("search.button")}
          </button>
        </div>
      </form>
      {visibleSuggestions.length > 0 ? (
        <ul aria-label={t("search.suggestions")} className={styles.suggestions}>
          {visibleSuggestions.map((suggestion) => (
            <li key={`${suggestion.type}-${suggestion.id}`}>
              <Link data-tv-focusable="true" href={href(suggestion.href)}>
                <span dir="auto">{suggestion.label}</span>
                <small>{suggestionTypeLabel(suggestion.type, locale)}</small>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function suggestionTypeLabel(type: string, locale: "en" | "ar") {
  if (locale !== "ar") return type.replace("_", " ");
  const labels: Record<string, string> = {
    VIDEO: "فيديو",
    CHANNEL: "قناة",
    PLAYLIST: "قائمة تشغيل",
    CREATOR_TV: "Creator TV",
    SERIES: "مسلسل",
  };
  return labels[type] ?? type.replace("_", " ");
}
