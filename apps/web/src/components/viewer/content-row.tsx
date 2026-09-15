"use client";

import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";

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
  const { direction, t } = useI18n();

  function scroll(logicalDirection: -1 | 1) {
    const scroller = scrollerReference.current;
    if (!scroller) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const physicalDirection = direction === "rtl" ? -logicalDirection : logicalDirection;
    scroller.scrollBy({
      behavior: reduceMotion ? "auto" : "smooth",
      left: scroller.clientWidth * 0.82 * physicalDirection,
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
          {eyebrow ? <p dir="auto">{eyebrow}</p> : null}
          <h2 dir="auto" id={headingId}>
            {title}
          </h2>
        </div>
        <div aria-label={t("carousel.controls", { title })} className={styles.controls}>
          <button
            aria-label={t("carousel.previous", { title })}
            data-tv-focus-id={`${rowId}-previous`}
            data-tv-focusable="true"
            onClick={() => scroll(-1)}
            type="button"
          >
            <span aria-hidden="true">{direction === "rtl" ? "→" : "←"}</span>
          </button>
          <button
            aria-label={t("carousel.next", { title })}
            data-tv-focus-id={`${rowId}-next`}
            data-tv-focusable="true"
            onClick={() => scroll(1)}
            type="button"
          >
            <span aria-hidden="true">{direction === "rtl" ? "←" : "→"}</span>
          </button>
        </div>
      </div>
      <div
        aria-label={t("carousel.content", { title })}
        className={styles.scroller}
        dir={direction}
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
