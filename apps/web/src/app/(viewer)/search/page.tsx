import Link from "next/link";

import { SearchBox } from "@/components/search/search-box";
import { MediaCard } from "@/components/viewer/media-card";
import { EmptyState } from "@/components/viewer/view-states";
import { apiBaseUrl } from "@/lib/api";
import { normalizeSearchTerm, type SearchResponse } from "@/lib/search";

import styles from "./search-page.module.css";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const query = normalizeSearchTerm(params.q ?? "");
  let results: SearchResponse | null = null;
  let error: string | null = null;
  if (query.length >= 2) {
    const endpoint = new URL(`${apiBaseUrl}/public/search`);
    endpoint.searchParams.set("q", query);
    if (params.cursor) endpoint.searchParams.set("cursor", params.cursor);
    const response = await fetch(endpoint, { cache: "no-store" });
    if (response.ok) results = (await response.json()) as SearchResponse;
    else error = "Search is temporarily unavailable. Please try again.";
  }

  return (
    <main className={styles.page}>
      <header>
        <p>Find something worth watching</p>
        <h1>Search AYIN</h1>
        <SearchBox initialQuery={query} />
      </header>
      {error ? <EmptyState description={error} title="Search unavailable" /> : null}
      {results?.items.length === 0 ? (
        <EmptyState
          description={results.emptyMessage ?? "Try another search."}
          title="No results"
        />
      ) : null}
      {results && results.items.length > 0 ? (
        <section aria-label={`Search results for ${results.query}`}>
          <h2>Results for “{results.query}”</h2>
          <div className={styles.grid}>
            {results.items.map((item, index) => (
              <MediaCard
                key={`${item.type}-${item.id}`}
                href={item.href}
                kicker={item.kicker}
                {...(item.meta ? { meta: item.meta } : {})}
                title={item.title}
                tone={((index % 5) + 1) as 1 | 2 | 3 | 4 | 5}
                variant="landscape"
              />
            ))}
          </div>
          {results.nextCursor ? (
            <Link
              className={styles.more}
              data-tv-focusable="true"
              href={`/search?q=${encodeURIComponent(results.query)}&cursor=${encodeURIComponent(results.nextCursor)}`}
            >
              More results
            </Link>
          ) : null}
        </section>
      ) : null}
      {!results && !error ? (
        <EmptyState
          description="Search videos, creators, public playlists, and Creator TV."
          title="What will you discover?"
        />
      ) : null}
    </main>
  );
}
