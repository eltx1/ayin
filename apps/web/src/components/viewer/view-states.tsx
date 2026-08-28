import type { ReactNode } from "react";

import { MediaCardSkeleton } from "./media-card";
import styles from "./view-states.module.css";

interface StateProperties {
  action?: ReactNode;
  description: string;
  title: string;
}

export function EmptyState({ action, description, title }: StateProperties) {
  return (
    <section className={styles.state}>
      <span aria-hidden="true" className={styles.stateMark} />
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div className={styles.action}>{action}</div> : null}
    </section>
  );
}

export function ErrorState({ action, description, title }: StateProperties) {
  return (
    <section aria-live="polite" className={`${styles.state} ${styles.error}`}>
      <span aria-hidden="true" className={styles.errorMark}>
        !
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div className={styles.action}>{action}</div> : null}
    </section>
  );
}

export function LoadingState({ title = "Loading AYIN" }: { title?: string }) {
  return (
    <section aria-busy="true" aria-label={title} className={styles.loading}>
      <div className={styles.loadingHeader} />
      <div className={styles.loadingGrid}>
        {Array.from({ length: 6 }, (_, index) => (
          <MediaCardSkeleton key={index} />
        ))}
      </div>
    </section>
  );
}
