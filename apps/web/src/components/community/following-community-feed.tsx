"use client";

import { CommunityFeed } from "./community-feed";

export function FollowingCommunityFeed() {
  return <CommunityFeed source={{ kind: "following" }} />;
}
