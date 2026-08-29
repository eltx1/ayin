import { MyAyinLibrary } from "@/components/discovery/my-ayin-library";

import styles from "@/components/discovery/discovery.module.css";

export default function MyAyinPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p>YOUR LIBRARY</p>
        <h1>My AYIN</h1>
        <p>
          Pick up where you left off, revisit your history, and keep your real saved AYIN activity
          in one place.
        </p>
      </header>
      <MyAyinLibrary />
    </main>
  );
}
