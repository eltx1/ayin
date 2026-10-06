"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { useViewerProduct } from "@/components/viewer/viewer-product-context";
import { normalizeSearchTerm, type SearchSuggestion } from "@/lib/search";
import { readSearch, SearchReadError } from "@/lib/search-request";

import styles from "./search.module.css";

export function SearchBox({ initialQuery = "" }: { initialQuery?: string }) {
  const { href, locale, t } = useI18n();
  const { identity, identityRevision, audienceStatus, isAudienceCurrent, retryNavigation } =
    useViewerProduct();
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<{
    key: string;
    items: SearchSuggestion[];
  } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const requestEpoch = useRef(0);
  const restoringFocus = useRef(false);
  const normalized = normalizeSearchTerm(query);
  const key = `${identityRevision}:${locale}:${normalized}`;
  const dismiss = useCallback(() => {
    requestEpoch.current++;
    request.current?.abort();
    setOpen(false);
    setSuggestions(null);
  }, []);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !box.current?.contains(event.target)) dismiss();
    };
    const suspend = () => dismiss();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("blur", suspend);
    window.addEventListener("pagehide", suspend);
    document.addEventListener("visibilitychange", suspend);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("blur", suspend);
      window.removeEventListener("pagehide", suspend);
      document.removeEventListener("visibilitychange", suspend);
    };
  }, [dismiss]);

  useEffect(() => {
    if (!open || normalized.length < 2 || audienceStatus !== "ready" || !isAudienceCurrent())
      return;
    const controller = new AbortController();
    request.current = controller;
    const epoch = ++requestEpoch.current;
    const deadline = window.setTimeout(() => controller.abort(), 15000);
    const timer = window.setTimeout(async () => {
      try {
        const body = await readSearch(
          "suggestions",
          { query: normalized, locale },
          { identity, isCurrent: isAudienceCurrent },
          controller.signal,
        );
        if (!controller.signal.aborted && epoch === requestEpoch.current && isAudienceCurrent())
          setSuggestions({ key, items: body.suggestions.slice(0, 8) });
      } catch (error) {
        if (controller.signal.aborted || epoch !== requestEpoch.current) return;
        setSuggestions(null);
        if (
          error instanceof SearchReadError &&
          (error.status === 409 || (error.status === 401 && identity !== null))
        ) {
          dismiss();
          retryNavigation();
        }
      } finally {
        window.clearTimeout(deadline);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(deadline);
      controller.abort();
    };
  }, [
    audienceStatus,
    dismiss,
    identity,
    isAudienceCurrent,
    key,
    locale,
    normalized,
    open,
    retryNavigation,
  ]);
  const visibleSuggestions =
    open && normalized.length >= 2 && suggestions?.key === key && isAudienceCurrent()
      ? suggestions.items
      : [];

  return (
    <div
      className={styles.searchBox}
      ref={box}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) dismiss();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          dismiss();
          restoringFocus.current = true;
          input.current?.focus();
          restoringFocus.current = false;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const links = Array.from(box.current?.querySelectorAll<HTMLAnchorElement>("ul a") ?? []);
        if (!links.length) return;
        const current = links.indexOf(document.activeElement as HTMLAnchorElement);
        event.preventDefault();
        if (event.key === "ArrowUp" && current === 0) input.current?.focus();
        else if (current < 0) links[event.key === "ArrowDown" ? 0 : links.length - 1]?.focus();
        else
          links[
            (current + (event.key === "ArrowDown" ? 1 : -1) + links.length) % links.length
          ]?.focus();
      }}
    >
      <form action={href("/search")} role="search" onSubmit={dismiss}>
        <label htmlFor="ayin-search">{t("search.label")}</label>
        <div className={styles.searchControls}>
          <input
            autoComplete="off"
            aria-controls={visibleSuggestions.length ? "ayin-search-suggestions" : undefined}
            dir="auto"
            id="ayin-search"
            maxLength={100}
            minLength={2}
            name="q"
            onChange={(event) => {
              if (normalizeSearchTerm(event.target.value) !== normalized) {
                requestEpoch.current++;
                request.current?.abort();
                setSuggestions(null);
              }
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              if (!restoringFocus.current) setOpen(true);
            }}
            placeholder={t("search.placeholder")}
            required
            ref={input}
            type="search"
            value={query}
          />
          <button data-tv-focusable="true" type="submit">
            {t("search.button")}
          </button>
        </div>
      </form>
      {visibleSuggestions.length > 0 ? (
        <ul
          aria-label={t("search.suggestions")}
          className={styles.suggestions}
          data-private-viewer-state
          id="ayin-search-suggestions"
          key={key}
        >
          {visibleSuggestions.map((suggestion) => (
            <li key={`${suggestion.type}-${suggestion.id}`}>
              <Link data-tv-focusable="true" href={href(suggestion.href)} onClick={dismiss}>
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
    MOVIE: "فيلم",
  };
  return labels[type] ?? type.replace("_", " ");
}
