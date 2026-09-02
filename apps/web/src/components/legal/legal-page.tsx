import type { ReactNode } from "react";

import styles from "./legal-page.module.css";

export const legalLastUpdated = "September 2, 2026";

export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>AYIN · Legal & Trust</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.updated}>Last updated: {legalLastUpdated}</p>
        <div className={styles.intro}>{intro}</div>
      </header>
      {children}
    </main>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function LegalNotice({ children }: { children: ReactNode }) {
  return <div className={styles.notice}>{children}</div>;
}
