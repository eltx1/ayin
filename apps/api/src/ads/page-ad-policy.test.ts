import { describe, expect, it } from "vitest";

import { isPageAdEligible, type PageAdPlacementConfig } from "./page-ad-policy.js";

const config: PageAdPlacementConfig = {
  routePatterns: ["/watch/*"],
  sizes: [[300, 250]],
  responsive: [],
  devices: ["MOBILE", "DESKTOP"],
  audience: "ANY",
  categories: [],
  demand: { source: "GOOGLE_GPT", adUnitPath: null },
  fallback: "COLLAPSE",
};

describe("page ad placement policy", () => {
  it("matches route and supported device", () => {
    expect(
      isPageAdEligible(config, {
        route: "/watch/example",
        device: "DESKTOP",
        signedIn: false,
        category: null,
      }),
    ).toBe(true);
  });

  it("enforces audience and category targeting", () => {
    const targeted: PageAdPlacementConfig = {
      ...config,
      audience: "SIGNED_IN",
      categories: ["sports"],
    };
    expect(
      isPageAdEligible(targeted, {
        route: "/watch/example",
        device: "DESKTOP",
        signedIn: false,
        category: "sports",
      }),
    ).toBe(false);
    expect(
      isPageAdEligible(targeted, {
        route: "/watch/example",
        device: "DESKTOP",
        signedIn: true,
        category: "news",
      }),
    ).toBe(false);
    expect(
      isPageAdEligible(targeted, {
        route: "/watch/example",
        device: "DESKTOP",
        signedIn: true,
        category: "sports",
      }),
    ).toBe(true);
  });

  it("rejects TV when placement is not TV-targeted", () => {
    expect(
      isPageAdEligible(config, {
        route: "/watch/example",
        device: "TV",
        signedIn: false,
        category: null,
      }),
    ).toBe(false);
  });
});
