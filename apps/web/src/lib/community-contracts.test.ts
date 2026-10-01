import { describe, expect, it } from "vitest";

import {
  parseCommunityChannelFeed,
  parseCommunityFeed,
  parseCommunityPollAck,
  parseCommunityReaction,
  parseCommunityReport,
} from "./community-contracts";

const post = {
  id: "post-one",
  type: "POLL",
  body: "Choose one",
  createdAt: "2026-10-01T12:00:00.000Z",
  publishedAt: "2026-10-01T12:00:00.000Z",
  scheduledPublishAt: null,
  channel: { id: "channel-one", handle: "creator", name: "Creator" },
  imageAsset: null,
  sharedVideo: null,
  pollOptions: [
    { id: "option-one", label: "One", _count: { votes: 2 } },
    { id: "option-two", label: "Two", _count: { votes: 1 } },
  ],
  _count: { reactions: 3, comments: 4, reports: 0 },
};

describe("community client contracts", () => {
  it("parses bounded feed and channel envelopes", () => {
    expect(parseCommunityFeed({ items: [post] })).toEqual([post]);
    expect(
      parseCommunityChannelFeed({
        channel: { id: "channel-one", handle: "creator", name: "Creator" },
        items: [post],
      }).items,
    ).toEqual([post]);
  });

  it("rejects malformed feeds instead of rendering a false empty state", () => {
    for (const invalid of [
      null,
      {},
      { items: "no" },
      { items: [{ ...post, createdAt: "invalid" }] },
      { items: [{ ...post, _count: { reactions: -1, comments: 0, reports: 0 } }] },
      { items: [{ ...post, pollOptions: [{ id: "option", label: "One", _count: {} }] }] },
    ]) {
      expect(() => parseCommunityFeed(invalid)).toThrow();
    }
  });

  it("validates mutation acknowledgements before changing visible state", () => {
    expect(parseCommunityReaction({ postId: "post-one", liked: true, likeCount: 4 }, "post-one")).toEqual({
      liked: true,
      likeCount: 4,
    });
    expect(parseCommunityPollAck({ id: "post-one", pollOptions: [{ id: "option-one" }] }, "post-one", "option-one")).toBe(true);
    expect(parseCommunityReport({ id: "report-one", status: "OPEN" })).toEqual({
      id: "report-one",
      status: "OPEN",
    });
    expect(() => parseCommunityReaction({ liked: true, likeCount: 4 }, "post-one")).toThrow();
    expect(() => parseCommunityPollAck({ id: "post-one", pollOptions: [] }, "post-one", "option-one")).toThrow();
  });
});
