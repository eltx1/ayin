import { describe, expect, it } from "vitest";

import { site } from "./site";

describe("site metadata", () => {
  it("uses the global AYIN identity", () => {
    expect(site).toEqual({
      description: "A global streaming and creator platform built for every screen.",
      name: "AYIN",
    });
  });
});
