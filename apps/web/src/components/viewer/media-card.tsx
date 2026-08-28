import Link from "next/link";

import styles from "./media-card.module.css";

export type MediaCardVariant = "poster" | "landscape";
export type MediaCardTone = 1 | 2 | 3 | 4 | 5;

interface MediaCardProperties {
  badge?: string;
  href: string;
  kicker?: string;
  meta?: string;
  title: string;
  tone?: MediaCardTone;
  variant?: MediaCardVariant;
}

function mediaFocusId(variant: MediaCardVariant, href: string, title: string) {
  return `media-${variant}-${href}-${title}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

export function MediaCard({
  badge,
  href,
  kicker,
  meta,
  title,
  tone = 1,
  variant = "poster",
}: MediaCardProperties) {
  return (
    <Link
      aria-label={title}
      className={`${styles.card} ${styles[variant]}`}
      data-tv-focus-id={mediaFocusId(variant, href, title)}
      data-tv-focusable="true"
      href={href}
    >
      <div className={styles.art} data-tone={tone}>
        <span aria-hidden="true" className={styles.signal} />
        {badge ? <span className={styles.badge}>{badge}</span> : null}
      </div>
      <div className={styles.copy}>
        {kicker ? <span className={styles.kicker}>{kicker}</span> : null}
        <strong>{title}</strong>
        {meta ? <span className={styles.meta}>{meta}</span> : null}
      </div>
    </Link>
  );
}

export function MediaCardSkeleton({ variant = "poster" }: { variant?: MediaCardVariant }) {
  return (
    <article aria-hidden="true" className={`${styles.card} ${styles[variant]} ${styles.skeleton}`}>
      <div className={styles.art} />
      <div className={styles.copy}>
        <span className={styles.skeletonLine} />
        <span className={styles.skeletonLineShort} />
      </div>
    </article>
  );
}
