import type { Metadata } from "next";

import { BrowseNavigation } from "@/components/viewer/browse-navigation";
import styles from "@/components/viewer/browse-navigation.module.css";
import { getRequestLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translator";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: `${translate(locale, "browse.title")} | AYIN`,
    description: translate(locale, "browse.description"),
  };
}

export default async function BrowsePage() {
  const locale = await getRequestLocale();
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>{translate(locale, "browse.title")}</h1>
        <p>{translate(locale, "browse.description")}</p>
      </header>
      <BrowseNavigation />
    </main>
  );
}
