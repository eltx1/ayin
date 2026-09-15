"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { stripLocalePrefix } from "@/lib/i18n/routing";

import styles from "./app-nav-link.module.css";

function normalizeRoute(pathname: string): string {
  const normalized = stripLocalePrefix(pathname);
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

function isCurrentRoute(pathname: string, href: string): boolean {
  const currentPath = normalizeRoute(pathname);
  const targetPath = normalizeRoute(href);
  if (targetPath === "/studio" || targetPath === "/admin") return currentPath === targetPath;
  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);
}

export function AppNavLink({ children, href }: { children: ReactNode; href: string }) {
  const pathname = usePathname();
  const current = isCurrentRoute(pathname, href);

  return (
    <Link
      aria-current={current ? "page" : undefined}
      className={current ? styles.active : undefined}
      href={href}
    >
      {children}
    </Link>
  );
}
