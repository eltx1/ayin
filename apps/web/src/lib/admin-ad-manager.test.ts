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

describe("VAST request macros", () => {
  it("fills raw and encoded cache busters with a fresh value per request", async () => {
    const { fillVastRequestMacros } = await import("./vast-request-macros");
    const raw = fillVastRequestMacros(
      "https://x.example/v?c=[timestamp]&r=%%CACHEBUSTER%%",
      1,
      0.5,
    );
    expect(raw).toBe("https://x.example/v?c=1500000&r=1500000");
    const encoded = fillVastRequestMacros("https://x.example/v?c=%5BCACHEBUSTER%5D", 2, 0.25);
    expect(encoded).toBe("https://x.example/v?c=2250000");
    expect(fillVastRequestMacros("https://x.example/v?c=[timestamp]")).not.toBe(
      fillVastRequestMacros("https://x.example/v?c=[timestamp]"),
    );
  });
});

describe("mid-roll schedule editing", () => {
  it("reads break times in clock or minute form", async () => {
    const { parseCueTimes } = await import("./admin-ad-manager");
    expect(parseCueTimes("20:00, 5:00، 1:05:00")).toEqual([300, 1200, 3900]);
    expect(parseCueTimes("5 20 65")).toEqual([300, 1200, 3900]);
    expect(parseCueTimes("5:00, 5:00")).toEqual([300]);
    expect(parseCueTimes("5:75")).toBeNull();
    expect(parseCueTimes("soon")).toBeNull();
    expect(parseCueTimes("")).toEqual([]);
  });

  it("previews the same breaks the API schedules", async () => {
    const { previewCuePoints } = await import("./admin-ad-manager");
    const interval = { mode: "INTERVAL" as const, everySec: 600, cuePointsSec: [], maxBreaks: 6 };
    expect(previewCuePoints(interval, 90 * 60)).toEqual([600, 1200, 1800, 2400, 3000, 3600]);
    expect(previewCuePoints({ ...interval, maxBreaks: 2 }, 90 * 60)).toEqual([600, 1200]);
    expect(
      previewCuePoints({ ...interval, mode: "CUE_POINTS", cuePointsSec: [300, 2690, 2800] }, 2720),
    ).toEqual([300, 2690]);
  });

  it("classifies what a VAST tag returns", async () => {
    const { checkVastTag } = await import("./admin-ad-manager");
    const answer = (body: string) => (async () => new Response(body)) as unknown as typeof fetch;
    const tag = "https://pubads.g.doubleclick.net/gampad/ads?iu=/1/v&description_url=[placeholder]";
    expect(
      await checkVastTag(tag, "PRE_ROLL", answer('<VAST version="3.0"><Ad id="a"></Ad></VAST>')),
    ).toEqual({ status: "FILLED", ads: 1 });
    expect(await checkVastTag(tag, "PRE_ROLL", answer('<VAST version="4.0"/>'))).toEqual({
      status: "NO_FILL",
      ads: 0,
    });
    expect(
      (await checkVastTag(tag, "MID_ROLL", answer('<vmap:VMAP xmlns:vmap="x"></vmap:VMAP>')))
        .status,
    ).toBe("AD_RULES");
    expect((await checkVastTag(tag, "MID_ROLL", answer("<html></html>"))).status).toBe("NOT_VAST");
    const failing = (async () => {
      throw new TypeError("cors");
    }) as unknown as typeof fetch;
    expect((await checkVastTag(tag, "POST_ROLL", failing)).status).toBe("UNREADABLE");
    let requested = "";
    const capture = (async (url: string) => {
      requested = url;
      return new Response("<VAST/>");
    }) as unknown as typeof fetch;
    await checkVastTag(tag, "MID_ROLL", capture);
    const sent = new URL(requested);
    expect(sent.searchParams.get("vpos")).toBe("midroll");
    expect(sent.searchParams.get("ad_rule")).toBe("0");
  });
});
