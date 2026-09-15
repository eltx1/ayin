import type { ReactNode } from "react";

import { AnalyticsBootstrap } from "@/components/analytics/analytics-bootstrap";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { ViewerShell } from "@/components/viewer/viewer-shell";

export default function ViewerLayout({ children }: { children: ReactNode }) {
  return (
    <ViewerShell>
      <AnalyticsBootstrap />
      <LocaleSwitcher />
      {children}
    </ViewerShell>
  );
}
