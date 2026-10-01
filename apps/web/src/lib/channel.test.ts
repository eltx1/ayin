import { describe, expect, it } from "vitest";

import { channelTabs, resolveChannelTab } from "./channel";

describe("channel navigation", () => {
  it("keeps placeholder-only Shorts and Posts out of query-tab navigation", () => {
    expect(channelTabs({ shorts: false, posts: false }).map((tab) => tab.id)).toEqual([
      "home",
      "videos",
      "tv",
      "playlists",
      "about",
    ]);
    expect(channelTabs({ shorts: true, posts: true }).map((tab) => tab.id)).toEqual([
      "home",
      "videos",
      "tv",
      "playlists",
      "about",
    ]);
  });

  it("accepts only a real in-page tab", () => {
    expect(resolveChannelTab("shorts", { shorts: true, posts: false })).toBe("home");
    expect(resolveChannelTab("posts", { shorts: false, posts: true })).toBe("home");
    expect(resolveChannelTab(["tv"], { shorts: false, posts: false })).toBe("tv");
    expect(resolveChannelTab("about", { shorts: false, posts: false })).toBe("about");
  });
});
