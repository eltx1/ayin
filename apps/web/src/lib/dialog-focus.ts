import type { KeyboardEvent } from "react";

// Only wrap at a modal's edges. The browser handles ordinary Tab movement.
export function dialogWrapIndex(current: number, count: number, reverse: boolean): number | null {
  if (count < 1) return null;
  if (current < 0) return reverse ? count - 1 : 0;
  if (reverse && current === 0) return count - 1;
  if (!reverse && current === count - 1) return 0;
  return null;
}

export function trapDialogTab(event: KeyboardEvent<HTMLDialogElement>) {
  if (
    event.defaultPrevented ||
    event.key !== "Tab" ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return;
  const elements = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      "a[href], button, input, select, textarea, [tabindex]",
    ),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(":disabled") &&
      !element.closest("[inert]") &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== "hidden",
  );
  const index = elements.indexOf(document.activeElement as HTMLElement);
  const next = dialogWrapIndex(index, elements.length, event.shiftKey);
  if (next !== null) {
    event.preventDefault();
    elements[next]?.focus();
  } else if (!elements.length) {
    event.preventDefault();
  }
}

// An underlying navigation modal must not consume Back for a confirmation above it.
export function ownsDialogFocus(element: HTMLDialogElement): boolean {
  return (
    document.activeElement instanceof Element &&
    document.activeElement.closest("dialog[open]") === element
  );
}
