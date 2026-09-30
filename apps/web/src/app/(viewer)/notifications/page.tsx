import type { Metadata } from "next";

import { NotificationFeed } from "@/components/social/notification-feed";
import { PageHeader } from "@/components/ui/design-system";
import { getRequestLocale } from "@/lib/i18n/server";
import { translateNotification } from "@/lib/i18n/notifications";
import { metadataRobots } from "@/lib/seo";

import styles from "./notifications.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: translateNotification(locale, "notifications.title"),
    robots: metadataRobots(false),
  };
}

export default async function NotificationsPage() {
  const locale = await getRequestLocale();
  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow={translateNotification(locale, "notifications.eyebrow")}
        title={translateNotification(locale, "notifications.title")}
        description={translateNotification(locale, "notifications.description")}
      />
      <NotificationFeed />
    </main>
  );
}
