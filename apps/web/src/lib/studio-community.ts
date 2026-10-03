import { apiBaseUrl } from "./api";
export type StudioPostType = "TEXT" | "IMAGE" | "POLL" | "VIDEO_SHARE";
export type StudioCommunityPost = {
  id: string;
  type: StudioPostType;
  status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "HIDDEN";
  body: string | null;
  scheduledPublishAt: string | null;
  publishedAt: string | null;
  imageAsset: { status: string } | null;
  sharedVideo: { id: string; title: string } | null;
  pollOptions: Array<{ id: string; label: string }>;
};
export class StudioCommunityRequestError extends Error {
  constructor(readonly status: number) {
    super("Community request rejected");
  }
}
export async function studioCommunityRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  if (!response.ok) throw new StudioCommunityRequestError(response.status);
  return response.json();
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid community response");
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum)
    throw new Error("Invalid community response");
  return value;
}
function id(value: unknown): string {
  const result = text(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result))
    throw new Error("Invalid community response");
  return result;
}
function date(value: unknown): string | null {
  if (value === null) return null;
  const result = text(value, 64);
  if (!Number.isFinite(Date.parse(result))) throw new Error("Invalid community response");
  return result;
}
export function parseStudioCommunityPost(value: unknown): StudioCommunityPost {
  const row = object(value);
  if (
    !["TEXT", "IMAGE", "POLL", "VIDEO_SHARE"].includes(String(row.type)) ||
    !["DRAFT", "SCHEDULED", "PUBLISHED", "HIDDEN"].includes(String(row.status)) ||
    !Array.isArray(row.pollOptions) ||
    row.pollOptions.length > 6
  )
    throw new Error("Invalid community response");
  const options = row.pollOptions.map((value) => {
    const option = object(value);
    return { id: id(option.id), label: text(option.label, 160) };
  });
  if (new Set(options.map((option) => option.id)).size !== options.length)
    throw new Error("Invalid community response");
  const image = row.imageAsset === null ? null : object(row.imageAsset);
  const video = row.sharedVideo === null ? null : object(row.sharedVideo);
  return {
    id: id(row.id),
    type: row.type as StudioPostType,
    status: row.status as StudioCommunityPost["status"],
    body: row.body === null ? null : text(row.body, 5000),
    scheduledPublishAt: date(row.scheduledPublishAt),
    publishedAt: date(row.publishedAt),
    imageAsset: image ? { status: text(image.status, 32) } : null,
    sharedVideo: video ? { id: id(video.id), title: text(video.title, 500) } : null,
    pollOptions: options,
  };
}
export function parseStudioCommunityPage(value: unknown, cursor?: string) {
  const page = object(value);
  if (!Array.isArray(page.items) || page.items.length > 50)
    throw new Error("Invalid community response");
  const items = page.items.map(parseStudioCommunityPost);
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new Error("Invalid community response");
  const nextCursor = page.nextCursor === null ? null : id(page.nextCursor);
  if (
    nextCursor !== null &&
    (nextCursor === cursor || !items.length || nextCursor !== items.at(-1)?.id)
  )
    throw new Error("Invalid community response");
  return { items, nextCursor };
}
export async function readStudioCommunity(cursor?: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ take: "30" });
  if (cursor) params.set("cursor", cursor);
  return parseStudioCommunityPage(
    await studioCommunityRequest(
      `/creator/community/posts/page?${params}`,
      signal ? { signal } : undefined,
    ),
    cursor,
  );
}
export async function inspectStudioCommunityImage(file: File) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size < 1 ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error("IMAGE_INVALID");
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    if (
      dimensions.width < 1 ||
      dimensions.height < 1 ||
      dimensions.width > 16384 ||
      dimensions.height > 16384
    )
      throw new Error("IMAGE_INVALID");
    return dimensions;
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        if (
          image.naturalWidth < 1 ||
          image.naturalHeight < 1 ||
          image.naturalWidth > 16384 ||
          image.naturalHeight > 16384
        )
          reject(new Error("IMAGE_INVALID"));
        else resolve({ width: image.naturalWidth, height: image.naturalHeight });
      };
      image.onerror = () => reject(new Error("IMAGE_INVALID"));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function uploadStudioCommunityImage(
  postId: string,
  file: File,
  dimensions: { width: number; height: number },
  signal: AbortSignal,
) {
  const authorization = object(
    await studioCommunityRequest(`/creator/community/posts/${postId}/image/authorize`, {
      method: "POST",
      body: JSON.stringify({ mimeType: file.type, sizeBytes: file.size }),
      signal,
    }),
  );
  const assetId = id(authorization.assetId);
  const upload = object(authorization.upload);
  const url = new URL(text(upload.url, 8192));
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.origin === new URL(apiBaseUrl).origin
      )) ||
    upload.method !== "PUT" ||
    url.username ||
    url.password
  )
    throw new Error("Invalid upload authorization");
  const headers = object(upload.headers);
  if (Object.values(headers).some((value) => typeof value !== "string"))
    throw new Error("Invalid upload authorization");
  const response = await fetch(url, {
    method: "PUT",
    headers: headers as Record<string, string>,
    body: file,
    signal,
    credentials: "omit",
  });
  if (!response.ok) throw new Error("Image upload uncertain");
  const completed = object(
    await studioCommunityRequest(`/creator/community/posts/${postId}/image/complete`, {
      method: "POST",
      body: JSON.stringify({ assetId, ...dimensions }),
      signal,
    }),
  );
  if (completed.assetId !== assetId || completed.status !== "VALIDATED")
    throw new Error("Invalid image acknowledgment");
}
