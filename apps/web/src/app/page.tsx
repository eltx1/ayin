import { site } from "@/lib/site";

import styles from "./page.module.css";
import { SessionPanel } from "./session-panel";

interface HomeProps {
  searchParams: Promise<{ welcome?: string }>;
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;

  return (
    <main className={styles.main}>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>Web-first global entertainment</p>
        <h1 className={styles.title}>{site.name}</h1>
        <p className={styles.description}>{site.description}</p>
        <p className={styles.creatorPromise}>
          Watch freely. Create instantly. Every AYIN account comes with a public channel and Creator
          TV.
        </p>
        <SessionPanel showWelcome={params.welcome === "1"} />
      </section>
    </main>
  );
}
