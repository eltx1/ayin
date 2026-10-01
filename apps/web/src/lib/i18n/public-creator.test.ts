import { describe, expect, it } from "vitest";

import { publicCreatorAr, publicCreatorEn } from "./resources/public-creator";
import { translatePublicCreator } from "./public-creator";

describe("public creator Viewer copy", () => {
  it("keeps English and Arabic route dictionaries in parity", () => {
    expect(Object.keys(publicCreatorAr).sort()).toEqual(Object.keys(publicCreatorEn).sort());
    for (const value of Object.values(publicCreatorAr)) expect(value.trim()).not.toBe("");
  });

  it("interpolates consumer-facing playlist and TV copy", () => {
    expect(translatePublicCreator("en", "playlist.videoCount", { count: "12" })).toBe("12 videos");
    expect(
      translatePublicCreator("ar", "tv.offAirNoEligibleDescription", { channel: "Studio" }),
    ).toContain("Studio");
  });

  it("does not expose implementation-specific playback wording", () => {
    const copy = Object.values(publicCreatorEn).join(" ");
    expect(copy).not.toMatch(/server-side ad insertion|media configuration|MP4/i);
  });
});
