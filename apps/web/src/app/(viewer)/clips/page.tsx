import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/design-system";
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
      <PageHeader
        className={styles.header ?? ""}
        eyebrow={t("clips.eyebrow")}
        title={t("clips.title")}
        description={t("clips.description")}
      />
      <ClipsClient />
    </main>
  );
}
