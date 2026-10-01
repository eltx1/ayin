import type { Metadata } from "next";

import { CommunityFollowingFeed } from "@/components/community/community-feed";
import { PageHeader } from "@/components/ui/design-system";
import { getRequestLocale } from "@/lib/i18n/server";
import { translateCommunity } from "@/lib/i18n/community";
import { metadataRobots } from "@/lib/seo";

import styles from "./community.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: translateCommunity(locale, "community.metaTitle"),
    description: translateCommunity(locale, "community.metaDescription"),
    robots: metadataRobots(false),
  };
}

export default async function CommunityPage() {
  const locale = await getRequestLocale();
  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow={translateCommunity(locale, "community.eyebrow")}
        title={translateCommunity(locale, "community.title")}
        description={translateCommunity(locale, "community.description")}
      />
      <CommunityFollowingFeed />
    </main>
  );
}
