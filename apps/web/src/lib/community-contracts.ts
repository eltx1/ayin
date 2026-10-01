export type CommunityPostType = "TEXT" | "IMAGE" | "POLL" | "VIDEO_SHARE";

export interface CommunityFeedItem {
  id: string;
  type: CommunityPostType;
  body: string | null;
  createdAt: string;
  publishedAt: string | null;
  scheduledPublishAt: string | null;
  channel: { id: string; handle: string; name: string };
  imageAsset: { r2ObjectKey: string; width: number | null; height: number | null } | null;
  sharedVideo: { slug: string; title: string } | null;
  pollOptions: Array<{ id: string; label: string; _count: { votes: number } }>;
  _count: { reactions: number; comments: number; reports: number };
}

export interface CommunityChannelEnvelope {
  channel: { id: string; handle: string; name: string };
  items: CommunityFeedItem[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): value is string {
  return typeof value === "string";
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function nullableDimension(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value > 0);
}

function isoDate(value: unknown): value is string {
  return string(value) && Number.isFinite(Date.parse(value));
}

function nullableDate(value: unknown): value is string | null {
  return value === null || isoDate(value);
}

function parseChannel(value: unknown) {
  const source = record(value);
  if (
    !source ||
    !string(source.id) ||
    !string(source.handle) ||
    !string(source.name) ||
    !source.handle ||
    !source.name
  ) {
    throw new Error("INVALID_COMMUNITY_CHANNEL");
  }
  return { id: source.id, handle: source.handle, name: source.name };
}

function parsePollOption(value: unknown) {
  const source = record(value);
  const count = record(source?._count);
  if (
    !source ||
    !string(source.id) ||
    !string(source.label) ||
    !count ||
    !nonNegativeInteger(count.votes)
  ) {
    throw new Error("INVALID_COMMUNITY_POLL");
  }
  return { id: source.id, label: source.label, _count: { votes: count.votes } };
}

function parseItem(value: unknown): CommunityFeedItem {
  const source = record(value);
  const counts = record(source?._count);
  if (
    !source ||
    !string(source.id) ||
    !["TEXT", "IMAGE", "POLL", "VIDEO_SHARE"].includes(String(source.type)) ||
    !nullableString(source.body) ||
    !isoDate(source.createdAt) ||
    !nullableDate(source.publishedAt) ||
    !nullableDate(source.scheduledPublishAt) ||
    !counts ||
    !nonNegativeInteger(counts.reactions) ||
    !nonNegativeInteger(counts.comments) ||
    !nonNegativeInteger(counts.reports) ||
    !Array.isArray(source.pollOptions)
  ) {
    throw new Error("INVALID_COMMUNITY_POST");
  }

  const image = source.imageAsset === null ? null : record(source.imageAsset);
  if (
    image &&
    (!string(image.r2ObjectKey) ||
      !nullableDimension(image.width) ||
      !nullableDimension(image.height))
  ) {
    throw new Error("INVALID_COMMUNITY_IMAGE");
  }
  if (source.imageAsset !== null && !image) throw new Error("INVALID_COMMUNITY_IMAGE");

  const video = source.sharedVideo === null ? null : record(source.sharedVideo);
  if (video && (!string(video.slug) || !string(video.title))) {
    throw new Error("INVALID_COMMUNITY_VIDEO");
  }
  if (source.sharedVideo !== null && !video) throw new Error("INVALID_COMMUNITY_VIDEO");

  return {
    id: source.id,
    type: source.type as CommunityPostType,
    body: source.body,
    createdAt: source.createdAt,
    publishedAt: source.publishedAt,
    scheduledPublishAt: source.scheduledPublishAt,
    channel: parseChannel(source.channel),
    imageAsset: image
      ? {
          r2ObjectKey: image.r2ObjectKey as string,
          width: image.width as number | null,
          height: image.height as number | null,
        }
      : null,
    sharedVideo: video
      ? { slug: video.slug as string, title: video.title as string }
      : null,
    pollOptions: source.pollOptions.map(parsePollOption),
    _count: {
      reactions: counts.reactions,
      comments: counts.comments,
      reports: counts.reports,
    },
  };
}

function parseItems(value: unknown): CommunityFeedItem[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("INVALID_COMMUNITY_FEED");
  return value.map(parseItem);
}

export function parseCommunityFeed(value: unknown): CommunityFeedItem[] {
  const source = record(value);
  if (!source) throw new Error("INVALID_COMMUNITY_FEED");
  return parseItems(source.items);
}

export function parseCommunityChannelFeed(value: unknown): CommunityChannelEnvelope {
  const source = record(value);
  if (!source) throw new Error("INVALID_COMMUNITY_FEED");
  return { channel: parseChannel(source.channel), items: parseItems(source.items) };
}

export function parseCommunityReaction(value: unknown, postId: string) {
  const source = record(value);
  if (
    !source ||
    source.postId !== postId ||
    typeof source.liked !== "boolean" ||
    !nonNegativeInteger(source.likeCount)
  ) {
    throw new Error("INVALID_COMMUNITY_REACTION");
  }
  return { liked: source.liked, likeCount: source.likeCount };
}

export function parseCommunityPollAck(value: unknown, postId: string, optionId: string) {
  const source = record(value);
  if (!source || source.id !== postId || !Array.isArray(source.pollOptions)) {
    throw new Error("INVALID_COMMUNITY_VOTE");
  }
  const options = source.pollOptions.map((option) => {
    const current = record(option);
    if (!current || !string(current.id)) throw new Error("INVALID_COMMUNITY_VOTE");
    return current.id;
  });
  if (!options.includes(optionId)) throw new Error("INVALID_COMMUNITY_VOTE");
  return true;
}

export function parseCommunityReport(value: unknown) {
  const source = record(value);
  if (!source || !string(source.id) || !string(source.status)) {
    throw new Error("INVALID_COMMUNITY_REPORT");
  }
  return { id: source.id, status: source.status };
}
