import type { Metadata } from "next";

import { getRequestLocale } from "@/lib/i18n/server";
import { translateClips } from "@/lib/i18n/clips";
import { absoluteUrl, metadataRobots } from "@/lib/seo";

import { ClipsClient } from "./clips-client";
import styles from "./clips.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const title = translateClips(locale, "clips.metaTitle");
  const description = translateClips(locale, "clips.metaDescription");
  return {
    title,
    description,
    alternates: { canonical: absoluteUrl("/clips") },
    robots: metadataRobots(true),
    openGraph: {
      type: "website",
      siteName: "AYIN",
      title,
      description,
      url: absoluteUrl("/clips"),
    },
  };
}

export default async function ClipsPage() {
  const locale = await getRequestLocale();
  const t = (key: Parameters<typeof translateClips>[1]) => translateClips(locale, key);

  return (
    <main className={styles.page}>
      <h1 className={styles.routeHeading}>{t("clips.title")}</h1>
      <ClipsClient />
    </main>
  );
}
