import type { Metadata } from "next";

import { SearchBox } from "@/components/search/search-box";
import { SearchResults } from "@/components/search/search-results";
import { PageHeader } from "@/components/ui/design-system";
import { getRequestLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translator";
import { normalizeSearchTerm } from "@/lib/search";
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
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const query = normalizeSearchTerm(params.q ?? "");

  // The API session cookie belongs to the API origin. SSR must stay neutral;
  // the existing viewer coordinator verifies audience before browser reads.
  return (
    <main className={styles.page}>
      <PageHeader title={t("search.title")} eyebrow={t("search.eyebrow")} density="compact">
        <SearchBox key={`${query}:${params.cursor ?? ""}`} initialQuery={query} />
      </PageHeader>
      <SearchResults query={query} {...(params.cursor ? { cursor: params.cursor } : {})} />
    </main>
  );
}
