import { describe, expect, it } from "vitest";

import { directionFromKey, findNextFocusTarget, focusActionFromKey } from "./focus-navigation.js";

const targets = [
  { id: "a", rect: { left: 0, right: 100, top: 0, bottom: 100 } },
  { id: "b", rect: { left: 120, right: 220, top: 0, bottom: 100 } },
  { id: "c", rect: { left: 240, right: 340, top: 10, bottom: 110 } },
  { id: "d", rect: { left: 0, right: 100, top: 140, bottom: 240 } },
  { id: "diagonal", rect: { left: 108, right: 208, top: 120, bottom: 220 } },
] as const;

describe("TV focus navigation", () => {
  it("prefers the nearest aligned target for horizontal movement", () => {
    expect(findNextFocusTarget(targets, "a", "right")?.id).toBe("b");
    expect(findNextFocusTarget(targets, "c", "left")?.id).toBe("b");
  });

  it("keeps vertical movement in an overlapping column when possible", () => {
    expect(findNextFocusTarget(targets, "a", "down")?.id).toBe("d");
    expect(findNextFocusTarget(targets, "d", "up")?.id).toBe("a");
  });

  it("returns null when movement is not possible or the current target is unknown", () => {
    expect(findNextFocusTarget(targets, "a", "left")).toBeNull();
    expect(findNextFocusTarget(targets, "missing", "right")).toBeNull();
  });

  it("normalizes keyboard and future remote-style directional inputs", () => {
    expect(directionFromKey("ArrowRight")).toBe("right");
    expect(directionFromKey("REMOTE_LEFT")).toBe("left");
    expect(directionFromKey("VK_DOWN")).toBe("down");
    expect(focusActionFromKey("REMOTE_OK")).toBe("select");
    expect(focusActionFromKey("BrowserBack")).toBe("back");
    expect(directionFromKey("Tab")).toBeNull();
  });
});
