import { AyinLensClient } from "./lens-client";
import styles from "./lens.module.css";

export default function AyinLensPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Discovery controls</p>
        <h1>AYIN Lens</h1>
        <p>
          See why AYIN is recommending each item, dismiss suggestions, and reset the signals used by
          the V1 explainable ranking system.
        </p>
      </header>
      <AyinLensClient />
    </main>
  );
}
