import { Button } from "@ayin/ui";

import { site } from "@/lib/site";

import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <section className={styles.panel}>
        <p className={styles.eyebrow}>Web-first global entertainment</p>
        <h1 className={styles.title}>{site.name}</h1>
        <p className={styles.description}>{site.description}</p>
        <Button className={styles.status} disabled type="button">
          Foundation ready
        </Button>
      </section>
    </main>
  );
}
