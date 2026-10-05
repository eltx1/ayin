import type { FocusEventHandler, ReactNode } from "react";
import Link from "next/link";

import styles from "./hero.module.css";

interface HeroAction {
  href: string;
  label: string;
}

interface HeroProperties {
  children?: ReactNode;
  onFocusCapture?: FocusEventHandler<HTMLElement>;
  description: string;
  eyebrow?: string;
  primaryAction?: HeroAction;
  secondaryAction?: HeroAction;
  title: string;
}

export function Hero({
  children,
  onFocusCapture,
  description,
  eyebrow,
  primaryAction,
  secondaryAction,
  title,
}: HeroProperties) {
  return (
    <section
      aria-labelledby="ayin-hero-title"
      className={styles.hero}
      onFocusCapture={onFocusCapture}
    >
      <div aria-hidden="true" className={styles.visual}>
        <div className={styles.orbit} />
        <div className={styles.core} />
        <div className={styles.horizon} />
      </div>
      <div className={styles.copy}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1
          data-long-title={title.length > 60 ? "true" : undefined}
          dir="auto"
          id="ayin-hero-title"
        >
          {title}
        </h1>
        <p className={styles.description} dir="auto">
          {description}
        </p>
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
        {children ? <div className={styles.status}>{children}</div> : null}
      </div>
    </section>
  );
}
