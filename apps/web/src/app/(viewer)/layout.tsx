import type { ReactNode } from "react";

import { WebAnalytics } from "@/components/analytics/web-analytics";
import { AnalyticsBootstrap } from "@/components/analytics/analytics-bootstrap";
import { PageAdLayoutProvider } from "@/components/ads/page-ad-layout-context";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { ViewerShell } from "@/components/viewer/viewer-shell";
import { fetchPageAdLayout } from "@/lib/page-ad-layout";

export default async function ViewerLayout({ children }: { children: ReactNode }) {
  // Serving slots reserve their space in the server-rendered HTML, so ads never push content.
  const adSlots = await fetchPageAdLayout();
  return (
    <PageAdLayoutProvider slots={adSlots}>
      <ViewerShell>
        <AnalyticsBootstrap />
        <WebAnalytics />
        <LocaleSwitcher />
        {children}
      </ViewerShell>
    </PageAdLayoutProvider>
  );
}
