"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { AppNavLink } from "@/components/ui/app-nav-link";
import { getAdminSession, type AdminRole, type AdminSession } from "@/lib/admin-control";

interface AdminNavigationItem {
  label: string;
  href: string;
  roles: AdminRole[] | "ALL";
}

const navigation: AdminNavigationItem[] = [
  { label: "Dashboard", href: "/admin", roles: "ALL" },
  { label: "Operations", href: "/admin/operations", roles: ["OPERATIONS"] },
  { label: "Users", href: "/admin/users", roles: ["OPERATIONS"] },
  { label: "Channels", href: "/admin/channels", roles: ["OPERATIONS", "CONTENT_MODERATOR"] },
  { label: "Content Library", href: "/admin/content", roles: ["OPERATIONS", "CONTENT_MODERATOR"] },
  { label: "Videos", href: "/admin/videos", roles: ["OPERATIONS", "CONTENT_MODERATOR"] },
  { label: "Creator TV", href: "/admin/tv", roles: ["OPERATIONS"] },
  { label: "Moderation", href: "/admin/moderation", roles: ["CONTENT_MODERATOR"] },
  { label: "Trust & Safety", href: "/admin/trust", roles: ["OPERATIONS", "CONTENT_MODERATOR"] },
  { label: "Product Controls", href: "/admin/product-controls", roles: ["OPERATIONS"] },
  { label: "Feature Flags", href: "/admin/feature-flags", roles: ["OPERATIONS"] },
  { label: "Advertising", href: "/admin/advertising", roles: ["AD_MANAGER"] },
  { label: "Video Ads", href: "/admin/video-ads", roles: ["AD_MANAGER"] },
  { label: "Revenue", href: "/admin/revenue", roles: ["FINANCE_MANAGER"] },
  { label: "Settings", href: "/admin/settings", roles: ["OPERATIONS"] },
];

function canSee(item: AdminNavigationItem, roles: AdminRole[]): boolean {
  if (roles.includes("SUPERADMIN") || roles.includes("ADMIN")) return true;
  if (item.roles === "ALL") return roles.length > 0;
  return item.roles.some((role) => roles.includes(role));
}

export function AdminSidebar() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void getAdminSession()
      .then((next) => {
        if (active) setSession(next);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const visible = useMemo(
    () => (session ? navigation.filter((item) => canSee(item, session.roles)) : []),
    [session],
  );

  return (
    <aside className={styles.sidebar}>
      <Link aria-label="AYIN Admin" className={styles.brand} href="/admin">
        <span className={styles.brandLogo}>
          <Image alt="" height={72} priority src="/brand/ayin-logo.png" width={72} />
        </span>
        <span>
          <strong>AYIN</strong>
          <small>Admin Control Center</small>
        </span>
      </Link>

      <nav aria-label="AYIN administration" className={styles.nav}>
        {!session && !failed ? <span className={styles.muted}>Loading access…</span> : null}
        {visible.map((item) => (
          <AppNavLink href={item.href} key={item.href}>
            {item.label}
          </AppNavLink>
        ))}
        {failed ? <span className={styles.muted}>Admin access unavailable.</span> : null}
      </nav>

      {session ? (
        <div className={styles.muted} aria-label="Current admin roles">
          {session.roles.join(" · ")}
        </div>
      ) : null}
      <Link className={styles.back} href="/">
        ← Back to AYIN
      </Link>
    </aside>
  );
}
