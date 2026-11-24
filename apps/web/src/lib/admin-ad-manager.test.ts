import { describe, expect, it } from "vitest";

import { extractAdUnitPath, extractVastTagUrl } from "./admin-ad-manager";
import { pageAdsSuppressedForLocation } from "./page-ad-suppression";

describe("ad manager paste helpers", () => {
  it("extracts an ad unit path from a path or a pasted GPT tag", () => {
    expect(extractAdUnitPath(" /23374456398/AYIN/home_top ")).toBe("/23374456398/AYIN/home_top");
    expect(
      extractAdUnitPath(
        "googletag.defineSlot('/23374456398/AYIN/home_top', [728, 90], 'div-gpt-ad-1').addService(googletag.pubads());",
      ),
    ).toBe("/23374456398/AYIN/home_top");
  });

  it("extracts a VAST URL from a bare URL or a snippet", () => {
    const url = "https://pubads.g.doubleclick.net/gampad/ads?iu=/1/v&env=vp";
    expect(extractVastTagUrl(url)).toBe(url);
    expect(
      extractVastTagUrl(
        "<VASTAdTagURI><![CDATA[https://pubads.g.doubleclick.net/gampad/ads?iu=/1/v&amp;env=vp]]></VASTAdTagURI>",
      ),
    ).toBe(url);
    expect(extractVastTagUrl("https://x.example/vast?c=[timestamp]")).toBe(
      "https://x.example/vast?c=[timestamp]",
    );
  });
});

describe("page ad suppression", () => {
  it("keeps outside-player ads off kids routes in every locale", () => {
    expect(pageAdsSuppressedForLocation("/kids", "")).toBe(true);
    expect(pageAdsSuppressedForLocation("/ar/kids/shows", "")).toBe(true);
    expect(pageAdsSuppressedForLocation("/c/creator", "?kids=1")).toBe(true);
    expect(pageAdsSuppressedForLocation("/ar/watch/video", "")).toBe(false);
    expect(pageAdsSuppressedForLocation("/kidsfun", "")).toBe(false);
  });
});
