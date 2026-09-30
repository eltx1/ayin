"use client";

import { directionFromKey, findNextFocusTarget, type FocusTarget } from "@ayin/ui";
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useRef } from "react";

import { buildTvFocusIdentities, resolvePersistedTvFocusIndex } from "@/lib/tv-focus-identity";

interface TvFocusScopeProperties {
  children: ReactNode;
  className?: string | undefined;
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

function focusEntries(root: HTMLElement) {
  const elements = visibleFocusableElements(root);
  return {
    elements,
    identities: buildTvFocusIdentities(elements.map((element) => element.dataset.tvFocusId)),
  };
}

function focusScope(root: HTMLElement, target: Element | null): HTMLElement {
  const modal = target?.closest<HTMLDialogElement>("dialog[open]");
  return modal && root.contains(modal) ? modal : root;
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
      const scope = focusScope(root, target);
      const { elements, identities } = focusEntries(scope);
      const targetIndex = elements.indexOf(target);
      const persistenceId = targetIndex >= 0 ? identities[targetIndex]?.persistenceId : null;
      if (!persistenceId) return;
      try {
        window.sessionStorage.setItem("ayin:last-tv-focus", persistenceId);
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
      const { elements, identities } = focusEntries(root);
      const savedIndex = resolvePersistedTvFocusIndex(identities, saved);
      elements[savedIndex]?.focus({ preventScroll: true });
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
    // A geometric target behind a modal remains visible but must never receive focus.
    const scope = focusScope(root, event.target instanceof Element ? event.target : null);
    const { elements, identities } = focusEntries(scope);
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
        id: identities[index]!.navigationId,
        rect: {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        },
      };
    });
    const currentId = identities[currentIndex]!.navigationId;
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
