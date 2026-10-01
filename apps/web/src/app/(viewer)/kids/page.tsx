import type { Metadata } from "next";

import { DiscoveryHome } from "@/components/discovery/discovery-home";
import { PageHeader, StatusNotice } from "@/components/ui/design-system";
import { getRequestLocale } from "@/lib/i18n/server";
import { translateKids } from "@/lib/i18n/kids";
import { absoluteUrl, metadataRobots } from "@/lib/seo";

import styles from "./kids.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: translateKids(locale, "kids.metaTitle"),
    description: translateKids(locale, "kids.metaDescription"),
    alternates: { canonical: absoluteUrl("/kids") },
    robots: metadataRobots(true),
  };
}

export default async function KidsPage() {
  const locale = await getRequestLocale();
  const t = (key: Parameters<typeof translateKids>[1]) => translateKids(locale, key);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <PageHeader
          eyebrow={t("kids.eyebrow")}
          title={t("kids.title")}
          description={t("kids.description")}
        />
        <StatusNotice tone="info" title={t("kids.noteTitle")}>
          {t("kids.noteDescription")}
        </StatusNotice>
      </section>

      <section aria-label={t("kids.catalog")} className={styles.catalog}>
        <DiscoveryHome kidsMode />
      </section>
    </main>
  );
}
