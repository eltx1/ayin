"use client";

import { useMemo } from "react";

import styles from "@/app/admin/admin.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import { WorkspaceBreadcrumbs } from "@/components/ui/workspace-breadcrumbs";
import { WorkspaceSidebar } from "@/components/ui/workspace-sidebar";
import { visibleAdminNavigation } from "@/lib/workspace-navigation";

import { useAdminAccess } from "./admin-access";
import { AdminReauthentication } from "./admin-reauthentication";

export function AdminBreadcrumbs() {
  const { session } = useAdminAccess();
  const groups = useMemo(() => visibleAdminNavigation(session?.roles ?? []), [session]);
  return <WorkspaceBreadcrumbs kind="admin" groups={groups} />;
}

export function AdminSidebar() {
  const { t } = useI18n();
  const { session, error, loading, refresh } = useAdminAccess();
  const groups = useMemo(() => visibleAdminNavigation(session?.roles ?? []), [session]);

  return (
    <WorkspaceSidebar kind="admin" groups={groups}>
      {loading ? <span role="status">{t("navigation.loadingAccess")}</span> : null}
      {error ? (
        <>
          <span role="alert" className={styles.muted}>
            {t("navigation.accessUnavailable")}
          </span>
          <button className={styles.button} type="button" onClick={refresh}>
            {t("navigation.retryAccess")}
          </button>
        </>
      ) : null}
      {session ? <AdminReauthentication /> : null}
      {session ? (
        <div className={styles.muted} aria-label={t("navigation.currentRoles")}>
          {session.roles.join(" · ")}
        </div>
      ) : null}
    </WorkspaceSidebar>
  );
}
