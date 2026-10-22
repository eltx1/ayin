import type { FocusEvent } from "react";

export function revealCoveredFocus(event: FocusEvent<HTMLElement>) {
  const target = event.target;
  // Let native focus scrolling settle; never move a newer focus. Fixed mobile
  // tabs can cover a target that the browser considers inside the viewport.
  window.requestAnimationFrame(() => {
    if (target.isConnected && document.activeElement === target) {
      const bounds = target.getBoundingClientRect();
      const centerX = bounds.x + bounds.width / 2;
      const covered =
        !target.contains(document.elementFromPoint(centerX, bounds.top + 3)) ||
        !target.contains(document.elementFromPoint(centerX, bounds.bottom - 3));
      if (covered)
        target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    }
  });
}
