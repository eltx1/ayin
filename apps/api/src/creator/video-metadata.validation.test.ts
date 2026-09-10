import { describe, expect, it } from "vitest";

import {
  validateMetadataDuration,
  videoMetadataSchema,
  VIDEO_TAG_MAX_COUNT,
} from "./video-metadata.validation.js";

describe("video metadata validation", () => {
  it("keeps an empty advanced payload valid", () => {
    expect(videoMetadataSchema.parse({})).toEqual({});
  });

  it("normalizes and de-duplicates tags case-insensitively", () => {
    expect(videoMetadataSchema.parse({ tags: [" Cairo ", "CAIRO", "Documentary"] }).tags).toEqual([
      "cairo",
      "documentary",
    ]);
  });

  it("enforces tag count and length", () => {
    expect(
      videoMetadataSchema.safeParse({
        tags: Array.from({ length: VIDEO_TAG_MAX_COUNT + 1 }, (_, i) => `t${i}`),
      }).success,
    ).toBe(false);
    expect(videoMetadataSchema.safeParse({ tags: ["x".repeat(41)] }).success).toBe(false);
  });

  it("accepts canonical BCP 47 language codes and rejects invalid ones", () => {
    expect(videoMetadataSchema.parse({ primaryLanguage: "ar-eg" }).primaryLanguage).toBe("ar-EG");
    expect(videoMetadataSchema.safeParse({ primaryLanguage: "not_a_language" }).success).toBe(
      false,
    );
  });

  it("requires ordered chapters and keeps them inside the known duration", () => {
    expect(
      videoMetadataSchema.safeParse({
        chapters: [
          { title: "Second", startSeconds: 20 },
          { title: "First", startSeconds: 10 },
        ],
      }).success,
    ).toBe(false);
    const parsed = videoMetadataSchema.parse({
      chapters: [
        { title: "Intro", startSeconds: 0 },
        { title: "Topic", startSeconds: 20 },
      ],
    });
    expect(() => validateMetadataDuration(parsed, 20_000)).toThrow("CHAPTER_OUTSIDE_VIDEO");
  });

  it("validates geo availability and custom ad-break preferences", () => {
    expect(
      videoMetadataSchema.safeParse({ geoAvailabilityMode: "INCLUDE_ONLY", geoCountries: [] })
        .success,
    ).toBe(false);
    expect(
      videoMetadataSchema.safeParse({ geoAvailabilityMode: "WORLDWIDE", geoCountries: ["EG"] })
        .success,
    ).toBe(false);
    expect(videoMetadataSchema.safeParse({ adBreakPreference: "CUSTOM" }).success).toBe(false);
    const parsed = videoMetadataSchema.parse({
      geoAvailabilityMode: "EXCLUDE",
      geoCountries: ["eg", "US", "EG"],
      adBreakPreference: "CUSTOM",
      adBreakOffsetsSeconds: [90, 30, 90],
    });
    expect(parsed.geoCountries).toEqual(["EG", "US"]);
    expect(parsed.adBreakOffsetsSeconds).toEqual([30, 90]);
    expect(() => validateMetadataDuration(parsed, 90_000)).toThrow("AD_BREAK_OUTSIDE_VIDEO");
  });
});
