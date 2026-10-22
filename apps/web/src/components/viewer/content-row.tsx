"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";

import styles from "./content-row.module.css";

interface ContentRowProperties {
  anchorId?: string;
  children: ReactNode;
  eyebrow?: string;
  rowId: string;
  title: string;
  variant?: "poster" | "landscape";
}

export function ContentRow({
  anchorId,
  children,
  eyebrow,
  rowId,
  title,
  variant = "poster",
}: ContentRowProperties) {
  const headingId = useId();
  const scrollerReference = useRef<HTMLDivElement>(null);
  const { direction, t } = useI18n();
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const scroller = scrollerReference.current;
    if (!scroller) return;
    const measure = () => setOverflowing(scroller.scrollWidth > scroller.clientWidth + 1);
    const frame = window.requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [children]);

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
        <div
          aria-label={t("carousel.controls", { title })}
          className={styles.controls}
          hidden={!overflowing}
        >
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
        className={`${styles.scroller} ${variant === "landscape" ? styles.landscape : ""}`}
        dir={direction}
        onKeyDown={onScrollerKeyDown}
        ref={scrollerReference}
        role="region"
        tabIndex={overflowing ? 0 : undefined}
      >
        {children}
      </div>
    </section>
  );
}
