"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { MediaCard, MediaCardSkeleton, type MediaCardTone } from "@/components/viewer/media-card";
import {
  fetchSearch,
  fetchSearchSuggestions,
  type SearchResult,
  type SearchResultType,
} from "@/lib/search";

import styles from "./search.module.css";

const filters: Array<{ label: string; value: "ALL" | SearchResultType }> = [
  { label: "All", value: "ALL" },
  { label: "Videos", value: "VIDEO" },
  { label: "Channels", value: "CHANNEL" },
  { label: "Playlists", value: "PLAYLIST" },
  { label: "Creator TV", value: "CREATOR_TV" },
];

export function SearchExperience({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<"ALL" | SearchResultType>("ALL");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(initialQuery.trim().length >= 2);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggestionsVisible = query.trim().length >= 2 && query.trim() !== submittedQuery.trim();

  useEffect(() => {
    if (initialQuery.trim().length < 2) return;
    const controller = new AbortController();
    void fetchSearch(initialQuery, { signal: controller.signal })
      .then((response) => {
        setResults(response.results);
        setCursor(response.nextCursor);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if ((loadError as { name?: string }).name !== "AbortError") {
          setError(
            loadError instanceof Error ? loadError.message : "Search is unavailable right now.",
          );
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [initialQuery]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || trimmed === submittedQuery.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchSearchSuggestions(trimmed, controller.signal)
        .then((response) => setSuggestions(response.suggestions))
        .catch((loadError: unknown) => {
          if ((loadError as { name?: string }).name !== "AbortError") setSuggestions([]);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, submittedQuery]);

  async function runSearch(
    requestedQuery: string,
    requestedFilter: "ALL" | SearchResultType,
    nextCursor?: string,
  ) {
    const trimmed = requestedQuery.trim();
    if (trimmed.length < 2) {
      setError("Enter at least 2 characters to search AYIN.");
      setResults([]);
      setCursor(null);
      return;
    }
    const append = Boolean(nextCursor);
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetchSearch(trimmed, {
        ...(requestedFilter === "ALL" ? {} : { types: [requestedFilter] }),
        ...(nextCursor ? { cursor: nextCursor } : {}),
      });
      setSubmittedQuery(response.query);
      setQuery(response.query);
      setSuggestions([]);
      setResults((current) =>
        append ? mergeResults(current, response.results) : response.results,
      );
      setCursor(response.nextCursor);
      router.replace(`/search?q=${encodeURIComponent(response.query)}`, { scroll: false });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Search is unavailable right now.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(query, filter);
  }

  function selectFilter(value: "ALL" | SearchResultType) {
    setFilter(value);
    if (submittedQuery.trim().length >= 2) void runSearch(submittedQuery, value);
  }

  return (
    <main className={styles.page}>
      <header className={styles.heading}>
        <p>Find it on AYIN</p>
        <h1>Search</h1>
        <span>Videos, creators, playlists and Creator TV in one place.</span>
      </header>

      <div className={styles.searchArea}>
        <form className={styles.form} onSubmit={submit} role="search">
          <label className={styles.inputWrap}>
            <span className={styles.srOnly}>Search AYIN</span>
            <input
              autoComplete="off"
              data-tv-focus-id="search-input"
              data-tv-focusable="true"
              maxLength={120}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search videos, channels, playlists or TV"
              type="search"
              value={query}
            />
          </label>
          <button data-tv-focus-id="search-submit" data-tv-focusable="true" type="submit">
            Search
          </button>
        </form>

        {suggestionsVisible && suggestions.length > 0 ? (
          <div className={styles.suggestions} aria-label="Search suggestions">
            {suggestions.map((suggestion) => (
              <Link href={suggestion.href} key={`${suggestion.type}:${suggestion.id}`}>
                <strong>{suggestion.title}</strong>
                <span>
                  {suggestion.kicker}
                  {suggestion.meta ? ` · ${suggestion.meta}` : ""}
                </span>
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles.filters} aria-label="Search result type">
        {filters.map((item) => (
          <button
            aria-pressed={filter === item.value}
            data-tv-focus-id={`search-filter-${item.value.toLowerCase()}`}
            data-tv-focusable="true"
            key={item.value}
            onClick={() => selectFilter(item.value)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className={styles.results} aria-label="Loading search results">
          {Array.from({ length: 8 }, (_, index) => (
            <MediaCardSkeleton key={index} />
          ))}
        </div>
      ) : submittedQuery.trim().length < 2 ? (
        <section className={styles.empty}>
          <strong>Search all of AYIN</strong>
          <span>Start with a title, creator, playlist or TV channel name.</span>
        </section>
      ) : results.length === 0 && !error ? (
        <section className={styles.empty}>
          <strong>No results for “{submittedQuery}”</strong>
          <span>Try a different title, creator name or fewer words.</span>
        </section>
      ) : (
        <>
          <section className={styles.results} aria-label={`Search results for ${submittedQuery}`}>
            {results.map((result) => (
              <div className={styles.resultCard} key={`${result.type}:${result.id}`}>
                <MediaCard
                  href={result.href}
                  kicker={result.kicker}
                  {...(result.meta ? { meta: result.meta } : {})}
                  title={result.title}
                  tone={toneFor(result.id)}
                  variant={
                    result.type === "CHANNEL" || result.type === "CREATOR_TV"
                      ? "landscape"
                      : "poster"
                  }
                />
              </div>
            ))}
          </section>
          {cursor ? (
            <button
              className={styles.loadMore}
              data-tv-focus-id="search-load-more"
              data-tv-focusable="true"
              disabled={loadingMore}
              onClick={() => void runSearch(submittedQuery, filter, cursor)}
              type="button"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          ) : null}
        </>
      )}
    </main>
  );
}

function mergeResults(current: SearchResult[], incoming: SearchResult[]): SearchResult[] {
  const seen = new Set(current.map((item) => `${item.type}:${item.id}`));
  const uniqueIncoming = incoming.filter((item) => {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...current, ...uniqueIncoming];
}

function toneFor(value: string): MediaCardTone {
  const score = [...value].reduce((sum, character) => sum + (character.codePointAt(0) ?? 0), 0);
  return ((score % 5) + 1) as MediaCardTone;
}
