import { describe, expect, it } from "vitest";

import { normalizeTvRemoteEvent } from "./tv-platform-runtime";

describe("TV platform runtime", () => {
  it("normalizes Samsung remote key codes", () => {
    expect(normalizeTvRemoteEvent({ key: "", keyCode: 10009 })).toBe("BACK");
    expect(normalizeTvRemoteEvent({ key: "", keyCode: 10252 })).toBe("PLAY_PAUSE");
  });

  it("normalizes webOS and browser keyboard names", () => {
    expect(normalizeTvRemoteEvent({ key: "ArrowLeft", keyCode: 0 })).toBe("LEFT");
    expect(normalizeTvRemoteEvent({ key: "Enter", keyCode: 0 })).toBe("SELECT");
    expect(normalizeTvRemoteEvent({ key: "Unknown", keyCode: 0 })).toBeNull();
  });
});
