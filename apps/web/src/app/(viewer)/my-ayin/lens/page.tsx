import type { Metadata } from "next";

import { ActionLink, PageHeader } from "@/components/ui/design-system";
import { getRequestLocale } from "@/lib/i18n/server";
import { localizeInternalHref } from "@/lib/i18n/routing";
import { translateMyAyin } from "@/lib/i18n/my-ayin";
import { metadataRobots } from "@/lib/seo";

import { AyinLensClient } from "./lens-client";
import styles from "./lens.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: translateMyAyin(locale, "lens.metaTitle"),
    robots: metadataRobots(false),
  };
}

export default async function AyinLensPage() {
  const locale = await getRequestLocale();
  const t = (key: Parameters<typeof translateMyAyin>[1]) => translateMyAyin(locale, key);

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow={t("lens.eyebrow")}
        title={t("lens.title")}
        description={t("lens.description")}
        actions={
          <ActionLink tone="quiet" href={localizeInternalHref("/my-ayin", locale)}>
            {t("lens.back")}
          </ActionLink>
        }
      />
      <AyinLensClient />
    </main>
  );
}
