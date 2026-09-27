import type { ReactNode } from "react";

import { AdminAccessProvider } from "@/components/admin/admin-access";
import { AdminSidebar } from "@/components/admin/admin-sidebar";

import styles from "./admin.module.css";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminAccessProvider>
      <div className={styles.shell}>
        <div className={styles.frame}>
          <AdminSidebar />
          <div className={styles.content}>{children}</div>
        </div>
      </div>
    </AdminAccessProvider>
  );
}
