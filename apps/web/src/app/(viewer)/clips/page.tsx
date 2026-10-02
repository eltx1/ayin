import type { Metadata } from "next";

import { ActionLink, PageHeader } from "@/components/ui/design-system";
import { EmptyState, ErrorState } from "@/components/viewer/view-states";
import { fetchClipsPage } from "@/lib/clips-server";
import { getRequestLocale } from "@/lib/i18n/server";
import { localizePath } from "@/lib/i18n/routing";
import { translateClips } from "@/lib/i18n/clips";
import { absoluteUrl, metadataRobots } from "@/lib/seo";

import { ClipsFeed } from "./clips-feed";
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
  const path = localizePath("/clips", locale);
  let page: Awaited<ReturnType<typeof fetchClipsPage>> | null = null;
  try {
    page = await fetchClipsPage();
  } catch {
    /* Recovery UI distinguishes transport/invalid data from a real empty Clips feed. */
  }

  return (
    <main className={styles.page}>
      <PageHeader
        className={styles.header ?? ""}
        eyebrow={t("clips.eyebrow")}
        title={t("clips.title")}
        description={t("clips.description")}
      />
      {!page ? (
        <ErrorState
          title={t("clips.loadErrorTitle")}
          description={t("clips.loadErrorDescription")}
          action={
            <ActionLink href={path} prefetch={false}>
              {t("clips.retry")}
            </ActionLink>
          }
        />
      ) : !page.enabled ? (
        <EmptyState title={t("clips.disabledTitle")} description={t("clips.disabledDescription")} />
      ) : page.items.length === 0 ? (
        <EmptyState title={t("clips.emptyTitle")} description={t("clips.emptyDescription")} />
      ) : (
        <ClipsFeed initialPage={page} />
      )}
    </main>
  );
}
