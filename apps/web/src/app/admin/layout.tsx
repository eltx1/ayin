import type { ReactNode } from "react";

import { AdminAccessProvider } from "@/components/admin/admin-access";
import { AdminBreadcrumbs, AdminSidebar } from "@/components/admin/admin-sidebar";
import workspaceStyles from "@/components/ui/workspace-navigation.module.css";

import styles from "./admin.module.css";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminAccessProvider>
      <div className={styles.shell}>
        <div className={workspaceStyles.frame}>
          <AdminSidebar />
          <div className={styles.content}>
            <AdminBreadcrumbs />
            {children}
          </div>
        </div>
      </div>
    </AdminAccessProvider>
  );
}
