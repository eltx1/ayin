import { describe, expect, it } from "vitest";

import {
  KIDS_SURFACE_POLICY,
  isKidsDiscoverySourceAllowed,
  isKidsSearchResultTypeAllowed,
  kidsSafeHref,
} from "./kids-policy.js";

describe("Kids surface boundaries", () => {
  it("restricts discovery to direct video-backed catalog sources", () => {
    expect(isKidsDiscoverySourceAllowed("NEW_ON_AYIN")).toBe(true);
    expect(isKidsDiscoverySourceAllowed("MOVIES")).toBe(true);
    expect(isKidsDiscoverySourceAllowed("RECENTLY_ADDED")).toBe(true);

    for (const source of [
      "CREATOR_TV",
      "SERIES",
      "TRENDING_WORLDWIDE",
      "POPULAR_NOW",
      "BECAUSE_YOU_WATCHED",
      "CREATORS_YOU_FOLLOW",
      "EDITOR_PICKS",
      "CONTINUE_WATCHING",
    ]) {
      expect(isKidsDiscoverySourceAllowed(source)).toBe(false);
    }
  });

  it("prevents non-video entities, including Creator TV rows, from leaking through Kids search", () => {
    expect(isKidsSearchResultTypeAllowed("VIDEO")).toBe(true);
    for (const type of ["CREATOR_TV", "CHANNEL", "PLAYLIST", "SERIES"]) {
      expect(isKidsSearchResultTypeAllowed(type)).toBe(false);
    }
  });

  it("keeps playback navigation inside the Kids policy context", () => {
    expect(kidsSafeHref("/watch/example")).toBe("/watch/example?kids=1");
    expect(kidsSafeHref("/watch/example?foo=1")).toBe("/watch/example?foo=1&kids=1");
  });

  it("defines stricter ad targeting and disabled community without claiming legal compliance", () => {
    expect(KIDS_SURFACE_POLICY.advertising).toEqual({
      inventoryClass: "KIDS",
      personalizedTargetingAllowed: false,
    });
    expect(KIDS_SURFACE_POLICY.socialCommunity.enabled).toBe(false);
    expect(KIDS_SURFACE_POLICY.legalReview.required).toBe(true);
    expect(KIDS_SURFACE_POLICY.legalReview.complianceClaimed).toBe(false);
  });
});
