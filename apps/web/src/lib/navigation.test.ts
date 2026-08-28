import { describe, expect, it } from "vitest";

import { navigationItems, parseNavigationFlags, visibleNavigationItems } from "./navigation";

describe("viewer navigation architecture", () => {
  it("contains the required AYIN navigation architecture", () => {
    expect(navigationItems.map((item) => item.label)).toEqual([
      "Home",
      "Movies",
      "Series",
      "TV",
      "Creators",
      "Shorts / Clips",
      "Kids",
      "My AYIN",
      "Search",
    ]);
  });

  it("hides unfinished flagged surfaces by default", () => {
    expect(visibleNavigationItems({}).map((item) => item.label)).toEqual(["Home", "Search"]);
  });

  it("only exposes allowlisted flags that resolve to booleans", () => {
    const flags = parseNavigationFlags({
      flags: {
        "navigation.tv": true,
        "navigation.movies": "yes",
        "provider.secret": true,
      },
    });

    expect(visibleNavigationItems(flags).map((item) => item.label)).toEqual([
      "Home",
      "TV",
      "Search",
    ]);
    expect(flags).not.toHaveProperty("provider.secret");
  });
});
