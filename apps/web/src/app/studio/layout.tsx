import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./studio.module.css";

const navigation = [
  ["Dashboard", "/studio"],
  ["Content", "/studio/content"],
  ["Playlists", "/studio/playlists"],
  ["TV", "/studio/tv"],
  ["Analytics", "/studio/analytics"],
  ["Comments", "/studio/comments"],
  ["Community", "/studio/community"],
  ["Live", "/studio/live"],
  ["Monetization", "/studio/monetization"],
  ["Trust & safety", "/studio/trust"],
  ["Channel settings", "/studio/channel"],
] as const;

export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <div className={styles.frame}>
        <aside className={styles.sidebar}>
          <Link className={styles.brand} href="/studio">
            AYIN STUDIO
          </Link>
          <nav aria-label="Creator Studio" className={styles.nav}>
            {navigation.map(([label, href]) => (
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
