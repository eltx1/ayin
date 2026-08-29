import { describe, expect, it } from "vitest";

import { normalizeSearchTerm } from "./search";

describe("normalizeSearchTerm", () => {
  it("normalizes unicode and whitespace and caps untrusted input", () => {
    expect(normalizeSearchTerm("  Creator   TV ")).toBe("Creator TV");
    expect(normalizeSearchTerm("x".repeat(150))).toHaveLength(100);
  });
});
