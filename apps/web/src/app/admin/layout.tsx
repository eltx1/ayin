import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./admin.module.css";

const links = [
  ["Dashboard", "/admin"],
  ["Users", "/admin/users"],
  ["Channels", "/admin/channels"],
  ["Videos", "/admin/videos"],
  ["Creator TV", "/admin/tv"],
  ["Moderation", "/admin/moderation"],
  ["Product Controls", "/admin/product-controls"],
  ["Feature Flags", "/admin/feature-flags"],
  ["Advertising", "/admin/advertising"],
  ["Video Ads", "/admin/video-ads"],
  ["Settings", "/admin/settings"],
] as const;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <div className={styles.frame}>
        <aside className={styles.sidebar}>
          <Link className={styles.brand} href="/admin">
            AYIN ADMIN
          </Link>
          <nav aria-label="AYIN administration" className={styles.nav}>
            {links.map(([label, href]) => (
              <Link href={href} key={href}>
                {label}
              </Link>
            ))}
          </nav>
          <Link className={styles.back} href="/">
            ← Back to AYIN
          </Link>
        </aside>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
