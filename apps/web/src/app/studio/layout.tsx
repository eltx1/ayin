import type { ReactNode } from "react";

import { WorkspaceBreadcrumbs } from "@/components/ui/workspace-breadcrumbs";
import { WorkspaceSidebar } from "@/components/ui/workspace-sidebar";
import workspaceStyles from "@/components/ui/workspace-navigation.module.css";
import { studioNavigation } from "@/lib/workspace-navigation";

import styles from "./studio.module.css";

export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <div className={workspaceStyles.frame}>
        <WorkspaceSidebar kind="studio" groups={studioNavigation} />
        <div className={styles.content}>
          <WorkspaceBreadcrumbs kind="studio" groups={studioNavigation} />
          {children}
        </div>
      </div>
    </div>
  );
}
