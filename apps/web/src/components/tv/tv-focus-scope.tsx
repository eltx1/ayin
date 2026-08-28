"use client";

import { directionFromKey, findNextFocusTarget, type FocusTarget } from "@ayin/ui";
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useRef } from "react";

interface TvFocusScopeProperties {
  children: ReactNode;
  className?: string;
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

function visibleFocusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-tv-focusable="true"]')].filter((element) => {
    if (element.getAttribute("aria-disabled") === "true" || element.hasAttribute("disabled")) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

function focusId(element: HTMLElement, index: number): string {
  return element.dataset.tvFocusId ?? `auto-${index}`;
}

export function TvFocusScope({ children, className }: TvFocusScopeProperties) {
  const rootReference = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootReference.current;
    if (!root) {
      return;
    }

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.dataset.tvFocusId) {
        return;
      }
      try {
        window.sessionStorage.setItem("ayin:last-tv-focus", target.dataset.tvFocusId);
      } catch {
        // Focus persistence is a convenience only; navigation must work without storage access.
      }
    };

    root.addEventListener("focusin", onFocusIn);

    const frame = window.requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) {
        return;
      }
      let saved: string | null = null;
      try {
        saved = window.sessionStorage.getItem("ayin:last-tv-focus");
      } catch {
        return;
      }
      if (!saved) {
        return;
      }
      const match = visibleFocusableElements(root).find(
        (element) => element.dataset.tvFocusId === saved,
      );
      match?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      root.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (isTextEditingTarget(event.target)) {
      return;
    }

    const direction = directionFromKey(event.key);
    if (!direction) {
      return;
    }

    const root = rootReference.current;
    if (!root) {
      return;
    }
    const elements = visibleFocusableElements(root);
    if (elements.length === 0) {
      return;
    }

    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const currentIndex = active ? elements.indexOf(active) : -1;
    if (currentIndex < 0) {
      event.preventDefault();
      elements[0]?.focus({ preventScroll: true });
      return;
    }

    const targets: FocusTarget[] = elements.map((element, index) => {
      const rect = element.getBoundingClientRect();
      return {
        id: focusId(element, index),
        rect: {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        },
      };
    });
    const currentId = focusId(elements[currentIndex]!, currentIndex);
    const next = findNextFocusTarget(targets, currentId, direction);
    if (!next) {
      return;
    }

    const nextIndex = targets.findIndex((target) => target.id === next.id);
    const nextElement = elements[nextIndex];
    if (!nextElement) {
      return;
    }

    event.preventDefault();
    nextElement.focus({ preventScroll: true });
    nextElement.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  return (
    <div className={className} data-tv-layout="ready" onKeyDown={onKeyDown} ref={rootReference}>
      {children}
    </div>
  );
}
