import { describe, expect, it } from "vitest";

import {
  confirmLensReset,
  confirmNotInterested,
  parseLensResponse,
  parseMyAyinResponse,
} from "./my-ayin-contracts";

const row = {
  key: "history",
  title: "Watch History",
  items: [
    {
      id: "video-one",
      type: "VIDEO",
      title: "A video",
      href: "/watch/a-video",
      kicker: "Video",
      meta: null,
      artworkObjectKey: null,
    },
  ],
  nextCursor: null,
  availability: "AVAILABLE",
  emptyMessage: "Empty",
};

const lens = {
  profileId: "profile-one",
  mode: "HEURISTIC_V1",
  algorithm: "video-v1",
  items: [
    {
      id: "video-two",
      slug: "recommended-video",
      title: "Recommended video",
      channelId: "channel-one",
      channelHandle: "creator",
      channelName: "Creator",
      artworkObjectKey: null,
      score: 42,
      reason: { code: "FOLLOWED_CHANNEL", label: "From a channel you follow" },
    },
  ],
};

describe("My AYIN and Lens client contracts", () => {
  it("rejects malformed My AYIN responses instead of producing a false empty library", () => {
    expect(
      parseMyAyinResponse({ profileId: "profile-one", sections: [row] }).sections,
    ).toHaveLength(1);
    for (const invalid of [
      null,
      {},
      { profileId: "profile-one", sections: "bad" },
      { profileId: "profile-one", sections: [{ ...row, items: "bad" }] },
      { profileId: "profile-one", sections: [row, row] },
    ]) {
      expect(() => parseMyAyinResponse(invalid)).toThrow("INVALID_MY_AYIN");
    }
  });

  it("rejects unsafe item destinations instead of emitting external-looking links", () => {
    for (const href of ["//elsewhere.test/path", "/\\elsewhere.test/path", "/bad\npath"]) {
      const invalid = structuredClone({ profileId: "profile-one", sections: [row] });
      invalid.sections[0]!.items[0]!.href = href;
      expect(() => parseMyAyinResponse(invalid)).toThrow("INVALID_MY_AYIN");
    }
  });

  it("validates Lens reads and mutation acknowledgements", () => {
    expect(parseLensResponse(lens).items[0]?.reason.code).toBe("FOLLOWED_CHANNEL");
    expect(() => parseLensResponse({ ...lens, mode: "UNKNOWN" })).toThrow("INVALID_LENS");
    expect(() =>
      parseLensResponse({ ...lens, items: [{ ...lens.items[0], score: Number.NaN }] }),
    ).toThrow("INVALID_LENS");

    expect(
      confirmNotInterested(
        { profileId: "profile-one", videoId: "video-two", state: "NOT_INTERESTED" },
        "profile-one",
        "video-two",
      ),
    ).toBe(true);
    expect(
      confirmNotInterested(
        { profileId: "profile-one", videoId: "video-two", state: "DISMISSED" },
        "profile-one",
        "video-two",
      ),
    ).toBe(false);

    expect(
      confirmLensReset(
        { profileId: "profile-one", resetAt: "2026-10-01T00:00:00.000Z" },
        "profile-one",
      ),
    ).toBe(true);
    expect(confirmLensReset({ profileId: "other", resetAt: "bad" }, "profile-one")).toBe(false);
  });
});
