export interface ChannelSocialState {
  subscribed: boolean;
  subscriberCount: number;
}

export interface VideoSocialState {
  reaction: "LIKE" | "DISLIKE" | null;
  likeCount: number;
  watchLater: boolean;
  myList: boolean;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_SOCIAL_RESPONSE");
  }
  return value as Record<string, unknown>;
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("INVALID_SOCIAL_RESPONSE");
  }
  return value;
}

export function parseChannelSocialState(value: unknown): ChannelSocialState {
  const data = record(value);
  if (typeof data.subscribed !== "boolean") throw new Error("INVALID_SOCIAL_RESPONSE");
  return {
    subscribed: data.subscribed,
    subscriberCount: count(data.subscriberCount),
  };
}

export function parseVideoSocialState(value: unknown): VideoSocialState {
  const data = record(value);
  const reaction = data.reaction;
  if (reaction !== null && reaction !== "LIKE" && reaction !== "DISLIKE") {
    throw new Error("INVALID_SOCIAL_RESPONSE");
  }
  if (typeof data.watchLater !== "boolean" || typeof data.myList !== "boolean") {
    throw new Error("INVALID_SOCIAL_RESPONSE");
  }
  return {
    reaction,
    likeCount: count(data.likeCount),
    watchLater: data.watchLater,
    myList: data.myList,
  };
}

export function parseSavedMutation(
  value: unknown,
  expectedList: "watch-later" | "my-list",
  expectedSaved: boolean,
): { saved: boolean } {
  const data = record(value);
  if (data.list !== expectedList || data.saved !== expectedSaved) {
    throw new Error("INVALID_SOCIAL_RESPONSE");
  }
  return { saved: expectedSaved };
}
