import { describe, expect, it } from "vitest";

import { pageAdSlotCatalog } from "./ad-slot-catalog.js";
import { slotUpdateSchema, videoUpdateSchema } from "./ad-manager.service.js";
import { renderPageAdFrame } from "./page-ad-frame.js";
import { pageAdPlacementConfigSchema } from "./page-ad.service.js";
import {
  expandVastTagMacros,
  videoMidRollCuePoints,
  withGamBreakPosition,
} from "./video-ad.service.js";

describe("simple ad manager", () => {
  it("only offers unique slots with valid placement configuration", () => {
    const keys = pageAdSlotCatalog.map((slot) => slot.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const slot of pageAdSlotCatalog) {
      expect(slot.name.ar.trim()).not.toBe("");
      expect(slot.where.ar.trim()).not.toBe("");
      expect(
        pageAdPlacementConfigSchema.safeParse({
          routePatterns: slot.routePatterns,
          sizes: slot.sizes,
          responsive: slot.responsive,
          devices: slot.devices,
          audience: "ANY",
          categories: [],
          demand: { source: "CODE", adUnitPath: null, code: "<div></div>", height: null },
          fallback: "COLLAPSE",
        }).success,
      ).toBe(true);
    }
  });

  it("requires content before a slot can be turned on", () => {
    const base = { code: null, adUnitPath: null, height: null, devices: ["MOBILE"] };
    expect(slotUpdateSchema.safeParse({ ...base, enabled: true, source: "CODE" }).success).toBe(
      false,
    );
    expect(slotUpdateSchema.safeParse({ ...base, enabled: true, source: "NONE" }).success).toBe(
      false,
    );
    expect(
      slotUpdateSchema.safeParse({
        ...base,
        enabled: true,
        source: "GAM_UNIT",
        adUnitPath: "AYIN/home_top",
      }).success,
    ).toBe(false);
    expect(
      slotUpdateSchema.safeParse({
        ...base,
        enabled: true,
        source: "GAM_UNIT",
        adUnitPath: "/23374456398/AYIN/home_top",
      }).success,
    ).toBe(true);
    expect(slotUpdateSchema.safeParse({ ...base, enabled: false, source: "CODE" }).success).toBe(
      true,
    );
  });

  it("requires an https VAST tag for every enabled break", () => {
    const off = { enabled: false, vastTagUrl: null };
    const valid = {
      masterEnabled: true,
      preRoll: { enabled: true, vastTagUrl: "https://pubads.g.doubleclick.net/gampad/ads?iu=/1/v" },
      midRoll: { ...off, mode: "INTERVAL", everySec: 600, cuePointsSec: [], maxBreaks: 6 },
      postRoll: off,
      frequencyCapPerSession: 3,
    };
    expect(videoUpdateSchema.safeParse(valid).success).toBe(true);
    expect(
      videoUpdateSchema.safeParse({ ...valid, preRoll: { enabled: true, vastTagUrl: null } })
        .success,
    ).toBe(false);
    expect(
      videoUpdateSchema.safeParse({
        ...valid,
        preRoll: { enabled: true, vastTagUrl: "http://insecure.example/vast" },
      }).success,
    ).toBe(false);
  });

  it("fills the placeholders Ad Manager leaves in copied VAST tags", () => {
    const tag =
      "https://pubads.g.doubleclick.net/gampad/ads?iu=/1/AYIN/video&description_url=[placeholder]&correlator=[timestamp]&env=vp";
    const expanded = new URL(expandVastTagMacros(tag, "https://ayin.stream/watch/a b"));
    expect(expanded.searchParams.get("description_url")).toBe("https://ayin.stream/watch/a b");
    // The cache buster is filled by the player for each request, never once per page.
    expect(expanded.searchParams.get("correlator")).toBe("[timestamp]");
    const empty = new URL(
      expandVastTagMacros(
        "https://pubads.g.doubleclick.net/gampad/ads?iu=/1/v&description_url=",
        "https://ayin.stream/watch/x",
      ),
    );
    expect(empty.searchParams.get("description_url")).toBe("https://ayin.stream/watch/x");
  });

  it("wraps pasted code in a self-sizing frame document", () => {
    const html = renderPageAdFrame('<div id="network-ad"></div>');
    expect(html).toContain('<div id="ayin-ad-root"><div id="network-ad"></div></div>');
    expect(html).toContain('<base target="_blank">');
    expect(html).toContain("ayin-ad-frame-size");
    expect(renderPageAdFrame(null)).toContain('<div id="ayin-ad-root"></div>');
  });

  it("repeats interval mid-rolls through the video and stops before its end", () => {
    const base = { cuePointsSec: [], maxBreaks: 6 } as const;
    expect(
      videoMidRollCuePoints({ ...base, mode: "INTERVAL", everySec: 600, durationSec: 5400 }),
    ).toEqual([600, 1200, 1800, 2400, 3000, 3600]);
    expect(
      videoMidRollCuePoints({
        ...base,
        mode: "INTERVAL",
        everySec: 600,
        maxBreaks: 50,
        durationSec: 1810,
      }),
    ).toEqual([600, 1200]);
    expect(
      videoMidRollCuePoints({ ...base, mode: "INTERVAL", everySec: 600, durationSec: null }),
    ).toEqual([]);
    expect(
      videoMidRollCuePoints({ ...base, mode: "INTERVAL", everySec: 600, durationSec: 300 }),
    ).toEqual([]);
  });

  it("uses fixed cue points in order, inside the video, capped", () => {
    expect(
      videoMidRollCuePoints({
        mode: "CUE_POINTS",
        everySec: 600,
        cuePointsSec: [2700, 300, 300, 1200, 7000],
        maxBreaks: 6,
        durationSec: 3000,
      }),
    ).toEqual([300, 1200, 2700]);
    expect(
      videoMidRollCuePoints({
        mode: "CUE_POINTS",
        everySec: 600,
        cuePointsSec: [300, 600, 900],
        maxBreaks: 2,
        durationSec: 3000,
      }),
    ).toEqual([300, 600]);
  });

  it("asks Ad Manager for a single VAST break at the right position", () => {
    const tag = new URL(
      withGamBreakPosition(
        "https://pubads.g.doubleclick.net/gampad/ads?iu=/1/v&ad_rule=1&env=vp",
        "MID_ROLL",
      ),
    );
    expect(tag.searchParams.get("ad_rule")).toBe("0");
    expect(tag.searchParams.get("vpos")).toBe("midroll");
    const other = "https://ads.example.com/vast.xml?x=1";
    expect(withGamBreakPosition(other, "PRE_ROLL")).toBe(other);
  });
});
