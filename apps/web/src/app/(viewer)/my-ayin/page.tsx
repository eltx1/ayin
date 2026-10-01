import type { Metadata } from "next";

import { MyAyinLibrary } from "@/components/discovery/my-ayin-library";
import { ActionLink, PageHeader } from "@/components/ui/design-system";
import { getRequestLocale } from "@/lib/i18n/server";
import { localizeInternalHref } from "@/lib/i18n/routing";
import { translateMyAyin } from "@/lib/i18n/my-ayin-copy";
import { metadataRobots } from "@/lib/seo";

import styles from "./my-ayin.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: translateMyAyin(locale, "myAyin.metaTitle"),
    robots: metadataRobots(false),
  };
}

export default async function MyAyinPage() {
  const locale = await getRequestLocale();
  const t = (key: Parameters<typeof translateMyAyin>[1]) => translateMyAyin(locale, key);

  return (
    <main className={styles.page}>
      <div className={styles.hero}>
        <PageHeader
          eyebrow={t("myAyin.eyebrow")}
          title={t("myAyin.title")}
          description={t("myAyin.description")}
          actions={
            <ActionLink tone="secondary" href={localizeInternalHref("/my-ayin/lens", locale)}>
              {t("myAyin.lens")}
            </ActionLink>
          }
        >
          <p className={styles.lensHint}>{t("myAyin.lensDescription")}</p>
        </PageHeader>
      </div>
      <MyAyinLibrary />
    </main>
  );
}
