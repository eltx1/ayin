import { describe, expect, it } from "vitest";

import { channelTabs, resolveChannelTab } from "./channel";

describe("channel navigation", () => {
  it("keeps Shorts and Posts hidden until their flags are enabled", () => {
    expect(channelTabs({ shorts: false, posts: false }).map((tab) => tab.id)).toEqual([
      "home",
      "videos",
      "tv",
      "playlists",
      "about",
    ]);
  });

  it("accepts only a visible channel tab", () => {
    expect(resolveChannelTab("shorts", { shorts: false, posts: false })).toBe("home");
    expect(resolveChannelTab("shorts", { shorts: true, posts: false })).toBe("shorts");
    expect(resolveChannelTab("about", { shorts: false, posts: false })).toBe("about");
  });
});
