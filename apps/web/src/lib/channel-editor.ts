import { apiBaseUrl } from "./api";
import type { ChannelAppearance, EditableChannelResponse } from "./channel";

export class ChannelEditorRequestError extends Error {
  constructor(readonly status: number) {
    super("Channel request could not be verified");
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = () => new ChannelEditorRequestError(0);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) throw invalid();
  return value;
}
function id(value: unknown): string {
  const result = text(value, 36);
  if (!uuid.test(result)) throw invalid();
  return result;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalid();
  return value;
}
export function parseChannelAppearance(value: unknown, channelId: string): ChannelAppearance {
  const root = record(value);
  const asset = (value: unknown, kind: "avatar" | "banner") => {
    if (value === null) return null;
    const row = record(value),
      assetId = id(row.assetId),
      mimeType = text(row.mimeType, 32),
      objectKey = text(row.objectKey, 512);
    const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[mimeType];
    if (
      !extension ||
      objectKey !== `channels/${channelId}/channel-assets/${assetId}/${kind}.${extension}`
    )
      throw invalid();
    return { assetId, mimeType, objectKey };
  };
  const accentColor = root.accentColor === null ? null : text(root.accentColor, 7);
  if (accentColor !== null && !/^#[0-9a-f]{6}$/i.test(accentColor)) throw invalid();
  return {
    accentColor,
    avatar: asset(root.avatar, "avatar"),
    banner: asset(root.banner, "banner"),
  };
}
export function parseEditableChannel(value: unknown, expectedId: string): EditableChannelResponse {
  const root = record(value),
    channel = record(root.channel),
    channelId = id(channel.id),
    status = text(channel.status, 16);
  if (channelId !== expectedId || !["ACTIVE", "HIDDEN", "SUSPENDED", "REMOVED"].includes(status))
    throw invalid();
  let settings: EditableChannelResponse["settings"] = null;
  if (root.settings !== null) {
    const row = record(root.settings),
      visibility = text(row.defaultVideoVisibility, 16);
    if (!["PUBLIC", "UNLISTED", "PRIVATE"].includes(visibility)) throw invalid();
    settings = {
      defaultCommentsEnabled: boolean(row.defaultCommentsEnabled),
      defaultVideoVisibility: visibility as "PUBLIC" | "UNLISTED" | "PRIVATE",
      autoAddPublishedToTv: boolean(row.autoAddPublishedToTv),
      tvAutoScheduleEnabled: boolean(row.tvAutoScheduleEnabled),
    };
  }
  return {
    channel: {
      id: channelId,
      name: text(channel.name, 120),
      handle: text(channel.handle, 80),
      description: channel.description === null ? null : text(channel.description, 5000, true),
      status: status as EditableChannelResponse["channel"]["status"],
    },
    appearance: parseChannelAppearance(root.appearance, channelId),
    settings,
    ...(root.previousHandle === undefined
      ? {}
      : { previousHandle: root.previousHandle === null ? null : text(root.previousHandle, 80) }),
  };
}
async function request(path: string, signal: AbortSignal, init: RequestInit = {}) {
  const controller = new AbortController(),
    abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, init.method ? 30_000 : 15_000);
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new ChannelEditorRequestError(response.status);
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
export async function getChannelEditorSnapshot(signal: AbortSignal) {
  const identity = record(await request("/auth/me", signal)),
    channelId = id(record(identity.channel).id);
  return parseEditableChannel(await request(`/creator/channels/${channelId}`, signal), channelId);
}
export function channelEditorInput(
  name: string,
  handle: string,
  description: string,
  accentColor: string,
) {
  const normalized = {
    name: name.trim().replace(/\s+/g, " "),
    handle: handle.normalize("NFKC").trim().toLowerCase(),
    description: description.trim() || null,
    accentColor: accentColor.toUpperCase(),
  };
  if (
    !normalized.name ||
    normalized.name.length > 120 ||
    normalized.handle.length > 80 ||
    !/^[\p{L}\p{N}](?:[\p{L}\p{N}._-]{0,78}[\p{L}\p{N}])?$/u.test(normalized.handle) ||
    (normalized.description?.length ?? 0) > 5000 ||
    !/^#[0-9A-F]{6}$/.test(normalized.accentColor)
  )
    throw invalid();
  return normalized;
}
export async function saveChannelEditor(
  channelId: string,
  input: ReturnType<typeof channelEditorInput>,
  signal: AbortSignal,
) {
  return parseEditableChannel(
    await request(`/creator/channels/${id(channelId)}`, signal, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
    channelId,
  );
}
export function validateChannelImage(kind: "avatar" | "banner", file: File) {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size <= 0 ||
    file.size > (kind === "avatar" ? 5 : 10) * 1024 * 1024
  )
    throw invalid();
}
export async function changeChannelImage(
  channelId: string,
  kind: "avatar" | "banner",
  file: File,
  signal: AbortSignal,
  onAuthorized: (assetId: string) => void,
) {
  validateChannelImage(kind, file);
  const root = record(
    await request(`/creator/channels/${id(channelId)}/assets/authorize`, signal, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, mimeType: file.type, sizeBytes: file.size }),
    }),
  );
  const assetId = id(root.assetId),
    upload = record(root.upload),
    headers = record(upload.headers),
    url = new URL(text(upload.url, 16000));
  if (
    root.kind !== kind ||
    upload.method !== "PUT" ||
    headers["content-type"] !== file.type ||
    Object.keys(headers).length !== 1 ||
    url.username ||
    url.password ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
    )
  )
    throw invalid();
  onAuthorized(assetId);
  await putChannelImage(url.href, file, signal);
  const completion = record(
    await request(`/creator/channels/${channelId}/assets/complete`, signal, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId }),
    }),
  );
  const appearance = parseChannelAppearance(completion.appearance, channelId);
  if (appearance[kind]?.assetId !== assetId) throw invalid();
  return appearance;
}
function putChannelImage(url: string, file: File, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(invalid());
      return;
    }
    const xhr = new XMLHttpRequest(),
      abort = () => xhr.abort();
    const finish = (error?: Error) => {
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    xhr.open("PUT", url);
    xhr.timeout = 120_000;
    xhr.withCredentials = false;
    xhr.setRequestHeader("content-type", file.type);
    xhr.onload = () =>
      finish(
        xhr.status >= 200 && xhr.status < 300
          ? undefined
          : new ChannelEditorRequestError(xhr.status),
      );
    xhr.onerror = xhr.ontimeout = xhr.onabort = () => finish(invalid());
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(file);
  });
}
