import { describe, expect, it } from "vitest";

import {
  parseChannelSocialState,
  parseSavedMutation,
  parseReactionMutation,
  parseSubscriptionMutation,
  parseVideoSocialState,
} from "./social-action-contracts";

describe("social action response contracts", () => {
  it("acknowledges only the exact reaction or subscription requested", () => {
    const state = {
      videoId: "video",
      reaction: "LIKE",
      likeCount: 1,
      watchLater: false,
      myList: false,
    };
    expect(parseReactionMutation(state, "LIKE", "video")).toMatchObject({
      reaction: "LIKE",
      likeCount: 1,
    });
    expect(() => parseReactionMutation(state, "LIKE", "another-video")).toThrow(
      "INVALID_SOCIAL_RESPONSE",
    );
    expect(() =>
      parseChannelSocialState(
        { channelId: "wrong", subscribed: true, subscriberCount: 1 },
        "channel",
      ),
    ).toThrow("INVALID_SOCIAL_RESPONSE");
    expect(() => parseReactionMutation(state, null, "video")).toThrow("INVALID_SOCIAL_RESPONSE");
    expect(() => parseReactionMutation(state, "DISLIKE", "video")).toThrow(
      "INVALID_SOCIAL_RESPONSE",
    );
    expect(
      parseSubscriptionMutation(
        { channelId: "channel", subscribed: false, subscriberCount: 0 },
        false,
        "channel",
      ),
    ).toEqual({
      subscribed: false,
      subscriberCount: 0,
    });
    expect(() =>
      parseSubscriptionMutation(
        { channelId: "channel", subscribed: false, subscriberCount: 0 },
        true,
        "channel",
      ),
    ).toThrow("INVALID_SOCIAL_RESPONSE");
  });
  it("accepts bounded channel state and rejects misleading counts", () => {
    expect(
      parseChannelSocialState({ subscribed: true, subscriberCount: 12, notificationLevel: "ALL" }),
    ).toEqual({ subscribed: true, subscriberCount: 12 });
    for (const value of [
      null,
      {},
      { subscribed: "yes", subscriberCount: 1 },
      { subscribed: false, subscriberCount: -1 },
      { subscribed: false, subscriberCount: 1.5 },
    ]) {
      expect(() => parseChannelSocialState(value)).toThrow("INVALID_SOCIAL_RESPONSE");
    }
  });

  it("validates complete video state before replacing visible action state", () => {
    expect(
      parseVideoSocialState({
        videoId: "ignored",
        reaction: "LIKE",
        likeCount: 4,
        watchLater: true,
        myList: false,
      }),
    ).toEqual({ reaction: "LIKE", likeCount: 4, watchLater: true, myList: false });
    for (const value of [
      {},
      { reaction: "LOVE", likeCount: 1, watchLater: false, myList: false },
      { reaction: null, likeCount: -1, watchLater: false, myList: false },
      { reaction: null, likeCount: 0, watchLater: "yes", myList: false },
    ]) {
      expect(() => parseVideoSocialState(value)).toThrow("INVALID_SOCIAL_RESPONSE");
    }
  });

  it("requires saved-list acknowledgements to match the requested mutation", () => {
    expect(parseSavedMutation({ list: "watch-later", saved: true }, "watch-later", true)).toEqual({
      saved: true,
    });
    expect(() => parseSavedMutation({ list: "my-list", saved: true }, "watch-later", true)).toThrow(
      "INVALID_SOCIAL_RESPONSE",
    );
    expect(() =>
      parseSavedMutation({ list: "watch-later", saved: false }, "watch-later", true),
    ).toThrow("INVALID_SOCIAL_RESPONSE");
  });
});
