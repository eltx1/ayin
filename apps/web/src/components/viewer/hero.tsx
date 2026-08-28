import Link from "next/link";

import styles from "./hero.module.css";

interface HeroAction {
  href: string;
  label: string;
}

interface HeroProperties {
  description: string;
  eyebrow?: string;
  primaryAction?: HeroAction;
  secondaryAction?: HeroAction;
  title: string;
}

export function Hero({
  description,
  eyebrow,
  primaryAction,
  secondaryAction,
  title,
}: HeroProperties) {
  return (
    <section aria-labelledby="ayin-hero-title" className={styles.hero}>
      <div aria-hidden="true" className={styles.visual}>
        <div className={styles.orbit} />
        <div className={styles.core} />
        <div className={styles.horizon} />
      </div>
      <div className={styles.copy}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1 id="ayin-hero-title">{title}</h1>
        <p className={styles.description}>{description}</p>
        {primaryAction || secondaryAction ? (
          <div className={styles.actions}>
            {primaryAction ? (
              <Link
                className={styles.primary}
                data-tv-focus-id="hero-primary"
                data-tv-focusable="true"
                href={primaryAction.href}
              >
                {primaryAction.label}
              </Link>
            ) : null}
            {secondaryAction ? (
              <Link
                className={styles.secondary}
                data-tv-focus-id="hero-secondary"
                data-tv-focusable="true"
                href={secondaryAction.href}
              >
                {secondaryAction.label}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
