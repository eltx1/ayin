import { describe, expect, it } from "vitest";
import { containsBlockedTerm } from "./trust-policy.js";
describe("moderation trust policy", () => {
  it("matches blocked terms case-insensitively", () =>
    expect(containsBlockedTerm("Bad TERM here", ["term"])).toBe(true));
  it("ignores empty terms", () => expect(containsBlockedTerm("safe", [" "])).toBe(false));
});
