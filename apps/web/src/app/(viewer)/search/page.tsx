import type { Metadata } from "next";
import Link from "next/link";

import { SearchAnalytics, SearchResultLinkAnalytics } from "@/components/search/search-analytics";
import { SearchBox } from "@/components/search/search-box";
import { MediaCard } from "@/components/viewer/media-card";
import { EmptyState } from "@/components/viewer/view-states";
import { apiBaseUrl } from "@/lib/api";
import { getRequestLocale } from "@/lib/i18n/server";
import { localizePath } from "@/lib/i18n/routing";
import { translate } from "@/lib/i18n/translator";
import { normalizeSearchTerm, type SearchResponse } from "@/lib/search";
import { metadataRobots } from "@/lib/seo";

import styles from "./search-page.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: translate(locale, "search.metaTitle"),
    description: translate(locale, "search.metaDescription"),
    robots: metadataRobots(false),
  };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const [params, locale] = await Promise.all([searchParams, getRequestLocale()]);
  const t = (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) =>
    translate(locale, key, values);
  const query = normalizeSearchTerm(params.q ?? "");
  let results: SearchResponse | null = null;
  let error: string | null = null;
  if (query.length >= 2) {
    const endpoint = new URL(`${apiBaseUrl}/public/search`);
    endpoint.searchParams.set("q", query);
    if (params.cursor) endpoint.searchParams.set("cursor", params.cursor);
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: { "x-ayin-locale": locale },
    });
    if (response.ok) results = (await response.json()) as SearchResponse;
    else error = t("search.unavailableDescription");
  }

  return (
    <main className={styles.page}>
      <SearchAnalytics queryLength={query.length} resultCount={results?.items.length ?? 0} />
      <header>
        <p>{t("search.eyebrow")}</p>
        <h1>{t("search.title")}</h1>
        <SearchBox initialQuery={query} />
      </header>
      {error ? <EmptyState description={error} title={t("search.unavailable")} /> : null}
      {results?.items.length === 0 ? (
        <EmptyState
          description={
            locale === "ar"
              ? t("search.tryAnother")
              : (results.emptyMessage ?? t("search.tryAnother"))
          }
          title={t("search.noResults")}
        />
      ) : null}
      {results && results.items.length > 0 ? (
        <section aria-label={t("search.resultsAria", { query: results.query })}>
          <h2 dir="auto">{t("search.resultsFor", { query: results.query })}</h2>
          <div className={styles.grid}>
            {results.items.map((item, index) => (
              <SearchResultLinkAnalytics key={`${item.type}-${item.id}`}>
                <MediaCard
                  href={localizePath(item.href, locale)}
                  kicker={item.kicker}
                  {...(item.meta ? { meta: item.meta } : {})}
                  title={item.title}
                  tone={((index % 5) + 1) as 1 | 2 | 3 | 4 | 5}
                  variant="landscape"
                />
              </SearchResultLinkAnalytics>
            ))}
          </div>
          {results.nextCursor ? (
            <Link
              className={styles.more}
              data-tv-focusable="true"
              href={localizePath(
                `/search?q=${encodeURIComponent(results.query)}&cursor=${encodeURIComponent(results.nextCursor)}`,
                locale,
              )}
            >
              {t("search.moreResults")}
            </Link>
          ) : null}
        </section>
      ) : null}
      {!results && !error ? (
        <EmptyState
          description={t("search.discoverDescription")}
          title={t("search.discoverTitle")}
        />
      ) : null}
    </main>
  );
}
