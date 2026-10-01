import { describe, expect, it } from "vitest";

import {
  communityPostTypeKey,
  parseCommunityChannel,
  parseCommunityFeed,
  parseCommunityReaction,
} from "./community-viewer";

const item = {
  id: "post-one",
  type: "POLL",
  body: "Pick one",
  publishedAt: "2026-10-01T10:00:00.000Z",
  scheduledPublishAt: null,
  createdAt: "2026-10-01T09:00:00.000Z",
  channel: { handle: "creator", name: "Creator" },
  imageAsset: null,
  sharedVideo: null,
  pollOptions: [{ id: "option-one", label: "Sea", _count: { votes: 0 } }],
  _count: { reactions: 1, comments: 2 },
};

describe("Community Viewer contracts", () => {
  it("accepts bounded feed and channel responses", () => {
    expect(parseCommunityFeed({ items: [item] })).toEqual([item]);
    expect(parseCommunityChannel({ channel: item.channel, items: [item] })).toEqual({
      channel: item.channel,
      items: [item],
    });
  });

  it("rejects malformed posts instead of turning them into empty content", () => {
    for (const value of [
      null,
      {},
      { items: "invalid" },
      { items: [{ ...item, createdAt: "not-a-date" }] },
      { items: [{ ...item, _count: { reactions: -1, comments: 0 } }] },
    ]) {
      expect(() => parseCommunityFeed(value)).toThrow("INVALID_COMMUNITY_FEED");
    }
  });

  it("validates reaction acknowledgements and type labels", () => {
    expect(parseCommunityReaction({ postId: "post-one", liked: true, likeCount: 2 })).toEqual({
      postId: "post-one",
      liked: true,
      likeCount: 2,
    });
    expect(() =>
      parseCommunityReaction({ postId: "post-one", liked: true, likeCount: -1 }),
    ).toThrow("INVALID_COMMUNITY_REACTION");
    expect(communityPostTypeKey("VIDEO_SHARE")).toBe("community.typeVideo");
  });
});
