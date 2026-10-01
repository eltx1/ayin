import type { Metadata } from "next";

import { CommunityFeed } from "@/components/community/community-feed";
import { PageHeader } from "@/components/ui/design-system";
import { ErrorState } from "@/components/viewer/view-states";
import { apiBaseUrl } from "@/lib/api";
import { parseCommunityChannel } from "@/lib/community-viewer";
import { translateCommunityViewer } from "@/lib/i18n/community-viewer";
import { getRequestLocale } from "@/lib/i18n/server";
import { absoluteUrl, metadataRobots } from "@/lib/seo";

import styles from "@/app/(viewer)/community/community.module.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const [{ handle }, locale] = await Promise.all([params, getRequestLocale()]);
  return {
    title: translateCommunityViewer(locale, "community.metaTitle"),
    description: translateCommunityViewer(locale, "community.metaDescription"),
    alternates: { canonical: absoluteUrl(`/c/${handle}/community`) },
    robots: metadataRobots(true),
  };
}

export default async function ChannelCommunityPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const [{ handle }, locale] = await Promise.all([params, getRequestLocale()]);
  const t = (key: Parameters<typeof translateCommunityViewer>[1], values = {}) =>
    translateCommunityViewer(locale, key, values);

  let data: ReturnType<typeof parseCommunityChannel> | null = null;
  try {
    const response = await fetch(
      `${apiBaseUrl}/public/community/channels/${encodeURIComponent(handle)}`,
      { cache: "no-store" },
    );
    if (response.ok) data = parseCommunityChannel(await response.json());
  } catch {
    data = null;
  }

  if (!data) {
    return (
      <main className={styles.page}>
        <PageHeader eyebrow={t("community.eyebrow")} title={t("community.metaTitle")} />
        <ErrorState
          title={t("community.unavailableTitle")}
          description={t("community.unavailableDescription")}
        />
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <PageHeader
          eyebrow={`@${data.channel.handle}`}
          title={t("community.channelTitle", { name: data.channel.name })}
          description={t("community.channelDescription", { name: data.channel.name })}
        />
      </section>
      <section aria-label={t("community.feedAria")} className={styles.feed}>
        <CommunityFeed
          initialItems={data.items}
          source={{ kind: "channel", handle: data.channel.handle }}
        />
      </section>
    </main>
  );
}
