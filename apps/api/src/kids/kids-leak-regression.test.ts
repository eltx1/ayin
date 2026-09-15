import { describe, expect, it } from "vitest";

import { evaluatePolicy } from "../video-policy/video-policy.service.js";
import { isKidsDiscoverySourceAllowed, isKidsSearchResultTypeAllowed } from "./kids-policy.js";

const maturePolicy = {
  videoId: "11111111-1111-4111-8111-111111111111",
  maturityLevel: "MATURE" as const,
  kidsEligible: false,
  allowedTerritories: [],
  blockedTerritories: [],
  rightsExpiresAt: null,
  ageRestriction: "AGE_18_PLUS" as const,
};

describe("Kids catalog leak regression", () => {
  it("mature and unclassified videos cannot pass the policy used by Kids discovery and search", () => {
    expect(evaluatePolicy(maturePolicy, null, { isKidsProfile: true }).allowed).toBe(false);
    expect(evaluatePolicy(null, null, { isKidsProfile: true }).allowed).toBe(false);
    expect(isKidsSearchResultTypeAllowed("VIDEO")).toBe(true);
  });

  it("Creator TV and other unrestricted entity rows are not Kids discovery/search sources", () => {
    expect(isKidsDiscoverySourceAllowed("CREATOR_TV")).toBe(false);
    expect(isKidsDiscoverySourceAllowed("SERIES")).toBe(false);
    expect(isKidsSearchResultTypeAllowed("CREATOR_TV")).toBe(false);
    expect(isKidsSearchResultTypeAllowed("CHANNEL")).toBe(false);
  });
});
