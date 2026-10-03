export interface ViewerComment {
  id: string;
  body: string;
  createdAt: string;
  authorProfile: { name: string; slug: string };
  likeCount: number;
  creatorHearted: boolean;
  pinned: boolean;
  edited: boolean;
  replies: ViewerComment[];
}
export interface ViewerCommentPage {
  enabled: boolean;
  items: ViewerComment[];
  nextCursor: number | null;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_COMMENTS");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number) {
  if (typeof value !== "string" || !value.length || value.length > max)
    throw new Error("INVALID_COMMENTS");
  return value;
}
function identity(value: unknown) {
  const id = text(value, 36);
  if (!uuid.test(id)) throw new Error("INVALID_COMMENTS");
  return id;
}
function date(value: unknown) {
  const result = text(value, 64);
  if (!Number.isFinite(Date.parse(result))) throw new Error("INVALID_COMMENTS");
  return result;
}
function flag(value: unknown) {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error("INVALID_COMMENTS");
  return value;
}
function comment(value: unknown, depth = 0): ViewerComment {
  const item = record(value);
  const author = record(item.authorProfile);
  if (!Number.isSafeInteger(item.likeCount) || (item.likeCount as number) < 0)
    throw new Error("INVALID_COMMENTS");
  const replies = item.replies ?? [];
  if (!Array.isArray(replies) || replies.length > 20 || (depth > 0 && replies.length))
    throw new Error("INVALID_COMMENTS");
  return {
    id: identity(item.id),
    body: text(item.body, 3000),
    createdAt: date(item.createdAt),
    authorProfile: { name: text(author.name, 120), slug: text(author.slug, 120) },
    likeCount: item.likeCount as number,
    creatorHearted: flag(item.creatorHearted),
    pinned: flag(item.pinned),
    edited: flag(item.edited),
    replies: replies.map((reply) => comment(reply, depth + 1)),
  };
}
export function parseViewerCommentPage(value: unknown, cursor = 0): ViewerCommentPage {
  const page = record(value);
  if (
    typeof page.enabled !== "boolean" ||
    !Array.isArray(page.items) ||
    page.items.length > 50 ||
    (page.nextCursor !== null &&
      (!Number.isSafeInteger(page.nextCursor) || (page.nextCursor as number) <= cursor)) ||
    (!page.enabled && (page.items.length || page.nextCursor !== null))
  )
    throw new Error("INVALID_COMMENTS");
  const items = page.items.map((item) => comment(item));
  const ids = items.flatMap((item) => [item.id, ...item.replies.map((reply) => reply.id)]);
  if (new Set(ids).size !== ids.length) throw new Error("INVALID_COMMENTS");
  return { enabled: page.enabled, items, nextCursor: page.nextCursor as number | null };
}
export function parseViewerCommentAck(value: unknown) {
  const ack = record(value);
  if (ack.parentId !== null) throw new Error("INVALID_COMMENT_ACK");
  return { id: identity(ack.id), body: text(ack.body, 3000), createdAt: date(ack.createdAt) };
}
