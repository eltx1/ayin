"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiBaseUrl } from "@/lib/api";
import { normalizeSearchTerm, type SearchSuggestion } from "@/lib/search";

import styles from "./search.module.css";

export function SearchBox({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);

  useEffect(() => {
    const normalized = normalizeSearchTerm(query);
    if (normalized.length < 2) {
      return;
    }
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
      <form action="/search" role="search">
        <label htmlFor="ayin-search">Search AYIN</label>
        <div className={styles.searchControls}>
          <input
            autoComplete="off"
            id="ayin-search"
            maxLength={100}
            minLength={2}
            name="q"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Videos, creators, playlists, TV"
            required
            type="search"
            value={query}
          />
          <button data-tv-focusable="true" type="submit">
            Search
          </button>
        </div>
      </form>
      {visibleSuggestions.length > 0 ? (
        <ul aria-label="Search suggestions" className={styles.suggestions}>
          {visibleSuggestions.map((suggestion) => (
            <li key={`${suggestion.type}-${suggestion.id}`}>
              <Link data-tv-focusable="true" href={suggestion.href}>
                <span>{suggestion.label}</span>
                <small>{suggestion.type.replace("_", " ")}</small>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
