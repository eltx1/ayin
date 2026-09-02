import type { ReactNode } from "react";

import { AdminSidebar } from "@/components/admin/admin-sidebar";

import styles from "./admin.module.css";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <div className={styles.frame}>
        <AdminSidebar />
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
