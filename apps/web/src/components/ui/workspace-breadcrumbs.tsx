"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useI18n } from "@/components/i18n/i18n-provider";
import { workspaceLocation, type WorkspaceNavigationGroup } from "@/lib/workspace-navigation";

import styles from "./workspace-navigation.module.css";

export function WorkspaceBreadcrumbs({
  kind,
  groups,
}: {
  kind: "studio" | "admin";
  groups: readonly WorkspaceNavigationGroup[];
}) {
  const { t, href } = useI18n();
  const pathname = usePathname();
  const root = kind === "studio" ? "/studio" : "/admin";
  const rootLabel = t(kind === "studio" ? "studio.aria" : "navigation.adminHome");
  const location = workspaceLocation(pathname, groups);
  if (!location) return null;
  const atRoot = location.item.href === root;

  return (
    <nav aria-label={t("navigation.location")} className={styles.breadcrumbs}>
      <ol>
        <li>
          {atRoot ? (
            <span aria-current="page">{rootLabel}</span>
          ) : (
            <Link href={href(root)}>{rootLabel}</Link>
          )}
        </li>
        {!atRoot ? (
          <>
            {location.group.items.length > 1 ? <li>{t(location.group.label)}</li> : null}
            <li>
              {location.detail ? (
                <Link href={href(location.item.href)}>{t(location.item.label)}</Link>
              ) : (
                <span aria-current="page">{t(location.item.label)}</span>
              )}
            </li>
            {location.detail ? (
              <li>
                <span aria-current="page">{t("navigation.details")}</span>
              </li>
            ) : null}
          </>
        ) : null}
      </ol>
    </nav>
  );
}
