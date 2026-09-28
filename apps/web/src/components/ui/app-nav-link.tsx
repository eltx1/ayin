"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { isNavigationCurrent, navigationPath } from "@/lib/workspace-navigation";

import styles from "./app-nav-link.module.css";

export function AppNavLink({ children, href }: { children: ReactNode; href: string }) {
  const pathname = usePathname();
  const current = isNavigationCurrent(pathname, href);

  return (
    <Link
      aria-current={current ? "page" : undefined}
      className={current ? styles.active : undefined}
      data-tv-focusable="true"
      data-tv-focus-id={`workspace-${navigationPath(href)}`}
      href={href}
    >
      {children}
    </Link>
  );
}
