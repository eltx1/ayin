"use client";

import { useEffect, type RefObject } from "react";

/** One mounted owner per property. Measure chrome, never guess translated heights. */
export function useViewportBlockSize(
  element: RefObject<HTMLElement | null>,
  property: "--ayin-shell-top" | "--ayin-shell-bottom" | "--ayin-feedback-height",
) {
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const root = document.documentElement;
    const measure = () => {
      const height = node.getBoundingClientRect().height;
      root.style.setProperty(property, `${height}px`);
      if (property === "--ayin-feedback-height") {
        root.style.setProperty("--ayin-feedback-space", `${height > 0 ? height + 32 : 0}px`);
      }
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      root.style.removeProperty(property);
      if (property === "--ayin-feedback-height") root.style.removeProperty("--ayin-feedback-space");
    };
  }, [element, property]);
}
