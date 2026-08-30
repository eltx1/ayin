import { describe, expect, it } from "vitest";
import { mapRemoteKey } from "./remote-keys";
describe("TV remote key mapping", () => {
  it("maps standard directional/select keys", () => {
    expect(mapRemoteKey("ArrowLeft")).toBe("left");
    expect(mapRemoteKey("Enter")).toBe("select");
  });
  it("maps common TV back codes", () => {
    expect(mapRemoteKey("Unidentified", 10009)).toBe("back");
    expect(mapRemoteKey("Unidentified", 461)).toBe("back");
  });
  it("returns unknown safely", () => expect(mapRemoteKey("F13")).toBe("unknown"));
});
