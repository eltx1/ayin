export type FocusDirection = "left" | "right" | "up" | "down";
export type FocusAction = FocusDirection | "select" | "back";

export interface FocusRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface FocusTarget {
  id: string;
  rect: FocusRect;
}

interface CandidateRank {
  alignedRank: number;
  crossDistance: number;
  id: string;
  primaryDistance: number;
  target: FocusTarget;
}

function center(rect: FocusRect) {
  return {
    x: (rect.left + rect.right) / 2,
    y: (rect.top + rect.bottom) / 2,
  };
}

function intervalOverlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.min(aEnd, bEnd) > Math.max(aStart, bStart);
}

function rankCandidate(
  current: FocusTarget,
  candidate: FocusTarget,
  direction: FocusDirection,
): CandidateRank | null {
  const currentCenter = center(current.rect);
  const candidateCenter = center(candidate.rect);
  const horizontal = direction === "left" || direction === "right";
  const directionDelta = horizontal
    ? candidateCenter.x - currentCenter.x
    : candidateCenter.y - currentCenter.y;

  if (
    (direction === "left" && directionDelta >= 0) ||
    (direction === "right" && directionDelta <= 0) ||
    (direction === "up" && directionDelta >= 0) ||
    (direction === "down" && directionDelta <= 0)
  ) {
    return null;
  }

  const aligned = horizontal
    ? intervalOverlaps(
        current.rect.top,
        current.rect.bottom,
        candidate.rect.top,
        candidate.rect.bottom,
      )
    : intervalOverlaps(
        current.rect.left,
        current.rect.right,
        candidate.rect.left,
        candidate.rect.right,
      );

  return {
    alignedRank: aligned ? 0 : 1,
    crossDistance: horizontal
      ? Math.abs(candidateCenter.y - currentCenter.y)
      : Math.abs(candidateCenter.x - currentCenter.x),
    id: candidate.id,
    primaryDistance: Math.abs(directionDelta),
    target: candidate,
  };
}

export function findNextFocusTarget(
  targets: readonly FocusTarget[],
  currentId: string,
  direction: FocusDirection,
): FocusTarget | null {
  const current = targets.find((target) => target.id === currentId);
  if (!current) {
    return null;
  }

  const ranked = targets
    .filter((target) => target.id !== current.id)
    .map((target) => rankCandidate(current, target, direction))
    .filter((candidate): candidate is CandidateRank => candidate !== null)
    .sort((a, b) => {
      if (a.alignedRank !== b.alignedRank) {
        return a.alignedRank - b.alignedRank;
      }
      if (a.primaryDistance !== b.primaryDistance) {
        return a.primaryDistance - b.primaryDistance;
      }
      if (a.crossDistance !== b.crossDistance) {
        return a.crossDistance - b.crossDistance;
      }
      return a.id.localeCompare(b.id);
    });

  return ranked[0]?.target ?? null;
}

export function focusActionFromKey(key: string): FocusAction | null {
  if (key === " ") {
    return "select";
  }

  switch (key) {
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "Enter":
    case "NumpadEnter":
      return "select";
    case "Escape":
    case "Backspace":
    case "BrowserBack":
      return "back";
    default:
      break;
  }

  switch (key.trim().toUpperCase()) {
    case "LEFT":
    case "VK_LEFT":
    case "REMOTE_LEFT":
      return "left";
    case "RIGHT":
    case "VK_RIGHT":
    case "REMOTE_RIGHT":
      return "right";
    case "UP":
    case "VK_UP":
    case "REMOTE_UP":
      return "up";
    case "DOWN":
    case "VK_DOWN":
    case "REMOTE_DOWN":
      return "down";
    case "OK":
    case "SELECT":
    case "REMOTE_OK":
      return "select";
    case "BACK":
    case "RETURN":
    case "REMOTE_BACK":
      return "back";
    default:
      return null;
  }
}

export function directionFromKey(key: string): FocusDirection | null {
  const action = focusActionFromKey(key);
  return action === "left" || action === "right" || action === "up" || action === "down"
    ? action
    : null;
}
