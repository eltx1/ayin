export type CommunityPostType = "TEXT" | "IMAGE" | "POLL" | "VIDEO_SHARE";

export interface CommunityPost {
  id: string;
  type: CommunityPostType;
  body: string | null;
  publishedAt: string | null;
  scheduledPublishAt: string | null;
  createdAt: string;
  channel: { handle: string; name: string };
  imageAsset: {
    r2ObjectKey: string;
    width: number | null;
    height: number | null;
  } | null;
  sharedVideo: { slug: string; title: string } | null;
  pollOptions: Array<{ id: string; label: string; _count: { votes: number } }>;
  _count: { reactions: number; comments: number };
}

export interface CommunityChannelResponse {
  channel: { handle: string; name: string };
  items: CommunityPost[];
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function date(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function nullableDate(value: unknown): value is string | null {
  return value === null || date(value);
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function channel(value: unknown): value is CommunityPost["channel"] {
  const record = object(value);
  return Boolean(record && text(record.handle) && text(record.name));
}

function imageAsset(value: unknown): value is CommunityPost["imageAsset"] {
  if (value === null) return true;
  const record = object(value);
  return Boolean(
    record &&
    text(record.r2ObjectKey) &&
    (record.width === null || count(record.width)) &&
    (record.height === null || count(record.height)),
  );
}

function sharedVideo(value: unknown): value is CommunityPost["sharedVideo"] {
  if (value === null) return true;
  const record = object(value);
  return Boolean(record && text(record.slug) && text(record.title));
}

function pollOptions(value: unknown): value is CommunityPost["pollOptions"] {
  if (!Array.isArray(value) || value.length > 6) return false;
  return value.every((entry) => {
    const record = object(entry);
    const aggregate = object(record?._count);
    return Boolean(
      record && text(record.id) && text(record.label) && aggregate && count(aggregate.votes),
    );
  });
}

function aggregates(value: unknown): value is CommunityPost["_count"] {
  const record = object(value);
  return Boolean(record && count(record.reactions) && count(record.comments));
}

function post(value: unknown): value is CommunityPost {
  const record = object(value);
  if (!record) return false;
  return (
    text(record.id) &&
    ["TEXT", "IMAGE", "POLL", "VIDEO_SHARE"].includes(String(record.type)) &&
    nullableText(record.body) &&
    nullableDate(record.publishedAt) &&
    nullableDate(record.scheduledPublishAt) &&
    date(record.createdAt) &&
    channel(record.channel) &&
    imageAsset(record.imageAsset) &&
    sharedVideo(record.sharedVideo) &&
    pollOptions(record.pollOptions) &&
    aggregates(record._count)
  );
}

function items(value: unknown): CommunityPost[] {
  if (!Array.isArray(value) || value.length > 100 || !value.every(post)) {
    throw new Error("INVALID_COMMUNITY_FEED");
  }
  return value;
}

export function parseCommunityFeed(value: unknown): CommunityPost[] {
  const record = object(value);
  if (!record) throw new Error("INVALID_COMMUNITY_FEED");
  return items(record.items);
}

export function parseCommunityChannel(value: unknown): CommunityChannelResponse {
  const record = object(value);
  if (!record || !channel(record.channel)) throw new Error("INVALID_COMMUNITY_FEED");
  return { channel: record.channel, items: items(record.items) };
}

export function parseCommunityReaction(value: unknown): {
  postId: string;
  liked: boolean;
  likeCount: number;
} {
  const record = object(value);
  if (
    !record ||
    !text(record.postId) ||
    typeof record.liked !== "boolean" ||
    !count(record.likeCount)
  ) {
    throw new Error("INVALID_COMMUNITY_REACTION");
  }
  return { postId: record.postId, liked: record.liked, likeCount: record.likeCount };
}

export function communityPostTypeKey(type: CommunityPostType) {
  switch (type) {
    case "IMAGE":
      return "community.typeImage" as const;
    case "POLL":
      return "community.typePoll" as const;
    case "VIDEO_SHARE":
      return "community.typeVideo" as const;
    default:
      return "community.typeText" as const;
  }
}

export function communityMediaUrl(key: string): string {
  const base = process.env.NEXT_PUBLIC_MEDIA_BASE_URL?.replace(/\/$/, "") ?? "";
  return base ? `${base}/${key.replace(/^\/+/, "")}` : `/${key.replace(/^\/+/, "")}`;
}
