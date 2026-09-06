import type { Metadata } from "next";

import { NotificationFeed } from "@/components/social/notification-feed";
import { metadataRobots } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Notifications",
  robots: metadataRobots(false),
};

export default function NotificationsPage() {
  return (
    <main style={{ maxWidth: "900px", margin: "0 auto", padding: "clamp(1rem, 4vw, 3rem)" }}>
      <h1>Notifications</h1>
      <NotificationFeed />
    </main>
  );
}
