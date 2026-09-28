"use client";

import { usePathname } from "next/navigation";
import { useId, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { isNavigationCurrent, type WorkspaceNavigationGroup } from "@/lib/workspace-navigation";

import { AppNavLink } from "./app-nav-link";
import styles from "./workspace-navigation.module.css";

function NavigationGroup({
  group,
  pathname,
}: {
  group: WorkspaceNavigationGroup;
  pathname: string | null;
}) {
  const { t, href } = useI18n();
  const id = useId();
  const active = group.items.some((item) => isNavigationCurrent(pathname, item.href));
  const [expanded, setExpanded] = useState(active);
  const single = group.items.length === 1;

  return (
    <div className={styles.group}>
      {!single ? (
        <button
          aria-expanded={expanded}
          aria-controls={id}
          className={styles.groupToggle}
          data-active={active || undefined}
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          <span>{t(group.label)}</span>
          <span aria-hidden="true" className={styles.chevron}>
            {expanded ? "−" : "+"}
          </span>
        </button>
      ) : null}
      <ul className={styles.groupLinks} hidden={!single && !expanded} id={id}>
        {group.items.map((item) => (
          <li key={item.href}>
            <AppNavLink href={href(item.href)}>{t(item.label)}</AppNavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GroupedNavigation({
  groups,
  label,
}: {
  groups: readonly WorkspaceNavigationGroup[];
  label: string;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className={styles.navigation}>
      {groups.map((group) => (
        <NavigationGroup group={group} pathname={pathname} key={`${group.id}:${pathname}`} />
      ))}
    </nav>
  );
}
