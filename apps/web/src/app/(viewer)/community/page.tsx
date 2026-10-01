import type { Metadata } from "next";

import { FollowingCommunityFeed } from "@/components/community/following-community-feed";
import { PageHeader } from "@/components/ui/design-system";
import { getRequestLocale } from "@/lib/i18n/server";
import { translateCommunityViewer } from "@/lib/i18n/community-viewer";
import { metadataRobots } from "@/lib/seo";

import styles from "./community.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: translateCommunityViewer(locale, "community.metaTitle"),
    description: translateCommunityViewer(locale, "community.metaDescription"),
    robots: metadataRobots(false),
  };
}

export default async function CommunityPage() {
  const locale = await getRequestLocale();
  const t = (key: Parameters<typeof translateCommunityViewer>[1]) =>
    translateCommunityViewer(locale, key);

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <PageHeader
          eyebrow={t("community.eyebrow")}
          title={t("community.title")}
          description={t("community.description")}
        />
      </section>
      <section aria-label={t("community.feedAria")} className={styles.feed}>
        <FollowingCommunityFeed />
      </section>
    </main>
  );
}
