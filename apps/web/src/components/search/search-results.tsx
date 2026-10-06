"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { MediaCard } from "@/components/viewer/media-card";
import { useViewerProduct } from "@/components/viewer/viewer-product-context";
import { EmptyState } from "@/components/viewer/view-states";
import { mediaAssetUrl } from "@/lib/channel";
import { translatePublicDiscovery } from "@/lib/i18n/public-discovery";
import type { SearchResponse } from "@/lib/search";
import { readSearch, SearchReadError } from "@/lib/search-request";

import { SearchAnalytics, SearchResultLinkAnalytics } from "./search-analytics";
import styles from "@/app/(viewer)/search/search-page.module.css";

export function SearchResults({ query, cursor }: { query: string; cursor?: string }) {
  const { locale, t } = useI18n();
  const { identity, identityRevision, audienceStatus, isAudienceCurrent, retryNavigation } =
    useViewerProduct();
  const key = JSON.stringify([identityRevision, locale, query, cursor]);
  const [read, setRead] = useState<{
    key: string;
    results: SearchResponse | null;
    error: boolean;
  } | null>(null);

  useEffect(() => {
    if (query.length < 2 || audienceStatus !== "ready" || !isAudienceCurrent()) return;
    const controller = new AbortController();
    let disposed = false;
    const deadline = window.setTimeout(() => controller.abort(), 15000);
    void readSearch(
      "results",
      { query, locale, ...(cursor ? { cursor } : {}) },
      { identity, isCurrent: isAudienceCurrent },
      controller.signal,
    )
      .then((results) => {
        if (!disposed && !controller.signal.aborted && isAudienceCurrent())
          setRead({ key, results, error: false });
      })
      .catch((error: unknown) => {
        if (disposed || !isAudienceCurrent()) return;
        setRead({ key, results: null, error: true });
        if (
          error instanceof SearchReadError &&
          (error.status === 409 || (error.status === 401 && identity !== null))
        )
          retryNavigation();
      })
      .finally(() => window.clearTimeout(deadline));
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(deadline);
    };
  }, [audienceStatus, cursor, identity, isAudienceCurrent, key, locale, query, retryNavigation]);

  if (query.length < 2)
    return (
      <EmptyState description={t("search.discoverDescription")} title={t("search.discoverTitle")} />
    );
  const current = read?.key === key && isAudienceCurrent() ? read : null;
  if (audienceStatus === "error" || current?.error)
    return (
      <EmptyState
        description={t("search.unavailableDescription")}
        title={t("search.unavailable")}
      />
    );
  if (!current?.results) return <p role="status">{t("common.loading")}</p>;
  // The shared coordinator conceals this node synchronously before invalidating
  // an account/profile lease, including blur and BFCache restoration.
  return (
    <div data-private-viewer-state key={key}>
      <SearchResultContent query={query} results={current.results} />
    </div>
  );
}

export function SearchResultContent({
  query,
  results,
}: {
  query: string;
  results: SearchResponse;
}) {
  const { href, locale, t } = useI18n();
  return (
    <>
      <SearchAnalytics queryLength={query.length} resultCount={results.items.length} />
      {results.items.length === 0 ? (
        <EmptyState
          description={
            locale === "ar"
              ? t("search.tryAnother")
              : (results.emptyMessage ?? t("search.tryAnother"))
          }
          title={t("search.noResults")}
        />
      ) : (
        <section aria-label={t("search.resultsAria", { query: results.query })}>
          <h2 dir="auto">{t("search.resultsFor", { query: results.query })}</h2>
          <div className={styles.grid}>
            {results.items.map((item, index) => {
              const artworkUrl = mediaAssetUrl(item.artworkObjectKey);
              return (
                <SearchResultLinkAnalytics key={`${item.type}-${item.id}`}>
                  <MediaCard
                    href={href(item.href)}
                    {...(artworkUrl ? { artworkUrl } : {})}
                    kicker={translatePublicDiscovery(locale, `type.${item.type}`)}
                    {...(item.meta ? { meta: item.meta } : {})}
                    title={item.title}
                    tone={((index % 5) + 1) as 1 | 2 | 3 | 4 | 5}
                    variant="landscape"
                  />
                </SearchResultLinkAnalytics>
              );
            })}
          </div>
          {results.nextCursor ? (
            <Link
              className={styles.more}
              data-tv-focusable="true"
              href={href(
                `/search?q=${encodeURIComponent(results.query)}&cursor=${encodeURIComponent(results.nextCursor)}`,
              )}
            >
              {t("search.moreResults")}
            </Link>
          ) : null}
        </section>
      )}
    </>
  );
}
