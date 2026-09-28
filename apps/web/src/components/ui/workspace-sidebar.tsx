"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import type { WorkspaceNavigationGroup } from "@/lib/workspace-navigation";

import { GroupedNavigation } from "./grouped-navigation";
import { NavigationDialog } from "./navigation-dialog";
import styles from "./workspace-navigation.module.css";

export function WorkspaceSidebar({
  kind,
  groups,
  children,
}: {
  kind: "studio" | "admin";
  groups: readonly WorkspaceNavigationGroup[];
  children?: ReactNode;
}) {
  const { t, href, direction } = useI18n();
  const studio = kind === "studio";
  const label = t(studio ? "studio.aria" : "navigation.adminAria");

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brandRow}>
        <Link
          aria-label={studio ? label : t("navigation.adminHome")}
          className={styles.brand}
          href={href(studio ? "/studio" : "/admin")}
        >
          <span className={styles.brandLogo}>
            <Image alt="" height={72} priority src="/brand/ayin-logo.png" width={72} />
          </span>
          <span>
            <strong>AYIN</strong>
            <small>{t(studio ? "studio.brand" : "navigation.adminBrand")}</small>
          </span>
        </Link>
        <div className={styles.mobileTrigger}>
          <NavigationDialog
            label={t(studio ? "navigation.openStudio" : "navigation.openAdmin")}
            title={label}
            triggerClassName={styles.menuButton}
            trigger={<span aria-hidden="true">☰</span>}
          >
            <GroupedNavigation groups={groups} label={label} />
          </NavigationDialog>
        </div>
      </div>
      {studio ? (
        <Link className={styles.createAction} href={href("/upload")}>
          <span aria-hidden="true">＋</span> {t("shell.createUpload")}
        </Link>
      ) : null}
      <div className={styles.desktopNavigation}>
        <GroupedNavigation groups={groups} label={label} />
      </div>
      <div className={styles.tools}>
        {children}
        <Link className={styles.back} href={href("/")}>
          <span aria-hidden="true">{direction === "rtl" ? "→" : "←"}</span>
          {t("studio.backToAyin")}
        </Link>
      </div>
    </aside>
  );
}
