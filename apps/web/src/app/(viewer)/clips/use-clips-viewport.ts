"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/** Measure the real route start, rather than subtracting an assumed header. */
export function useClipsViewport(root: RefObject<HTMLDivElement | null>) {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const viewport = window.visualViewport;
        if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
        let bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
        for (const element of document.querySelectorAll<HTMLElement>(
          "[data-ayin-bottom-navigation], [data-ayin-feedback-dock]",
        )) {
          const bounds = element.getBoundingClientRect();
          if (bounds.height > 0 && getComputedStyle(element).position === "fixed")
            bottom = Math.min(bottom, bounds.top);
        }
        // Document scroll must not make the stage taller. A negative screen
        // top is ordinary scrolling, not newly available viewport space.
        const top = node.getBoundingClientRect().top + window.scrollY;
        // At extreme text zoom/short landscape keep the stage operable through
        // ordinary document scrolling; never squash the controls to zero.
        const landscape = window.matchMedia("(min-width: 600px) and (max-height: 500px)").matches;
        const fontSize = Number.parseFloat(getComputedStyle(node).fontSize) || 16;
        const minimum = (landscape ? 12.5 : 17.5) * Math.max(16, fontSize);
        const active = node.querySelector("[data-clip-active='true']");
        const controls =
          active?.querySelector("[data-clip-controls]")?.getBoundingClientRect().height ?? 0;
        const metadata = landscape
          ? 0
          : (active?.querySelector("[data-clip-metadata]")?.getBoundingClientRect().height ?? 0);
        // Controls may wrap or show caption/error feedback at enlarged text.
        // Keep real media space rather than clipping an auto-sized controls row.
        const required = Math.ceil(controls + metadata + 122);
        const next = Math.ceil(Math.max(minimum, required, Math.floor(bottom - top - 8)));
        node.style.setProperty("--clip-stage-height", `${next}px`);
        setHeight(next);
      });
    };
    const observer = new ResizeObserver(measure);
    for (const element of document.querySelectorAll(
      "[data-ayin-shell-header], [data-ayin-bottom-navigation], [data-ayin-feedback-dock], #ayin-content > :first-child",
    ))
      observer.observe(element);
    observer.observe(node);
    const content = new Set<Element>();
    const observeContent = () => {
      for (const element of content) observer.unobserve(element);
      content.clear();
      for (const element of node.querySelectorAll(
        "[data-clip-active='true'] [data-clip-controls], [data-clip-active='true'] [data-clip-metadata]",
      )) {
        content.add(element);
        observer.observe(element);
      }
      measure();
    };
    // Replace observations as the virtual window moves; never retain old rows.
    const mutations = new MutationObserver(observeContent);
    mutations.observe(node, { childList: true, subtree: true });
    observeContent();
    if (node.previousElementSibling) observer.observe(node.previousElementSibling);
    if (node.parentElement) observer.observe(node.parentElement);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      content.clear();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [root]);
  return height;
}

/** All native dialogs, including the shared account menu, suspend Clips. */
export function useClipsModalOpen() {
  const [opened, setOpened] = useState(false);
  useLayoutEffect(() => {
    const update = () => setOpened(Boolean(document.querySelector("dialog[open]")));
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    update();
    return () => observer.disconnect();
  }, []);
  return opened;
}
