"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import styles from "./app-nav-link.module.css";

function isCurrentRoute(pathname: string, href: string): boolean {
  if (href === "/studio" || href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
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
