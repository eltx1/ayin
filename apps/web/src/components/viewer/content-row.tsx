"use client";

import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";

import styles from "./content-row.module.css";

interface ContentRowProperties {
  anchorId?: string;
  children: ReactNode;
  eyebrow?: string;
  rowId: string;
  title: string;
}

export function ContentRow({ anchorId, children, eyebrow, rowId, title }: ContentRowProperties) {
  const headingId = useId();
  const scrollerReference = useRef<HTMLDivElement>(null);

  function scroll(direction: -1 | 1) {
    const scroller = scrollerReference.current;
    if (!scroller) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollBy({
      behavior: reduceMotion ? "auto" : "smooth",
      left: scroller.clientWidth * 0.82 * direction,
    });
  }

  function onScrollerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "PageUp") {
      event.preventDefault();
      scroll(-1);
    } else if (event.key === "PageDown") {
      event.preventDefault();
      scroll(1);
    }
  }

  return (
    <section aria-labelledby={headingId} className={styles.section} id={anchorId}>
      <div className={styles.heading}>
        <div>
          {eyebrow ? <p>{eyebrow}</p> : null}
          <h2 id={headingId}>{title}</h2>
        </div>
        <div aria-label={`${title} carousel controls`} className={styles.controls}>
          <button
            aria-label={`Scroll ${title} left`}
            data-tv-focus-id={`${rowId}-previous`}
            data-tv-focusable="true"
            onClick={() => scroll(-1)}
            type="button"
          >
            ←
          </button>
          <button
            aria-label={`Scroll ${title} right`}
            data-tv-focus-id={`${rowId}-next`}
            data-tv-focusable="true"
            onClick={() => scroll(1)}
            type="button"
          >
            →
          </button>
        </div>
      </div>
      <div
        aria-label={`${title} content`}
        className={styles.scroller}
        onKeyDown={onScrollerKeyDown}
        ref={scrollerReference}
        role="region"
        tabIndex={0}
      >
        {children}
      </div>
    </section>
  );
}
