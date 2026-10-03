import { apiBaseUrl } from "./api";

export interface StudioLiveStream {
  id: string;
  slug: string;
  title: string;
  status: string;
  providerStreamId: string | null;
  scheduledStartAt: string | null;
  chatEnabled: boolean;
}
export interface StudioLiveSnapshot {
  channel: { id: string; name: string; handle: string };
  provider: { configured: boolean; productionEnabled: boolean };
  streams: StudioLiveStream[];
  nextCursor: string | null;
}
export interface EncoderConfiguration {
  rtmps: { serverUrl: string; streamKey: string };
  srt?: { url: string };
}
export class StudioLiveRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
const invalid = () => new Error("The live response could not be verified.");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number) {
  if (typeof value !== "string" || value.length > max) throw invalid();
  return value;
}
function bool(value: unknown) {
  if (typeof value !== "boolean") throw invalid();
  return value;
}
function id(value: unknown) {
  const result = text(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result))
    throw invalid();
  return result;
}
export function parseStudioLiveStream(value: unknown): StudioLiveStream {
  const row = object(value),
    status = text(row.status, 20),
    slug = text(row.slug, 160);
  if (
    !["DRAFT", "SCHEDULED", "READY", "LIVE", "ENDED", "CANCELLED", "FAILED"].includes(status) ||
    !/^[a-z0-9-]+$/.test(slug)
  )
    throw invalid();
  const scheduledStartAt = row.scheduledStartAt === null ? null : text(row.scheduledStartAt, 40);
  if (scheduledStartAt && !Number.isFinite(Date.parse(scheduledStartAt))) throw invalid();
  return {
    id: id(row.id),
    slug,
    title: text(row.title, 200),
    status,
    providerStreamId: row.providerStreamId === null ? null : text(row.providerStreamId, 256),
    scheduledStartAt,
    chatEnabled: bool(row.chatEnabled),
  };
}
export function parseStudioLiveSnapshot(value: unknown, cursor?: string): StudioLiveSnapshot {
  const row = object(value),
    channel = object(row.channel),
    provider = object(row.provider);
  if (!Array.isArray(row.streams) || row.streams.length > 20) throw invalid();
  const streams = row.streams.map(parseStudioLiveStream),
    nextCursor = row.nextCursor === null ? null : id(row.nextCursor);
  if (
    new Set(streams.map((stream) => stream.id)).size !== streams.length ||
    (nextCursor &&
      (nextCursor === cursor || streams.length !== 20 || nextCursor !== streams.at(-1)?.id))
  )
    throw invalid();
  return {
    channel: {
      id: id(channel.id),
      name: text(channel.name, 200),
      handle: text(channel.handle, 100),
    },
    provider: {
      configured: bool(provider.configured),
      productionEnabled: bool(provider.productionEnabled),
    },
    streams,
    nextCursor,
  };
}
async function request(
  path: string,
  signal: AbortSignal,
  init: RequestInit = {},
): Promise<unknown> {
  const controller = new AbortController(),
    abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, init.method ? 30000 : 15000);
  try {
    const response = await fetch(`${apiBaseUrl}/studio/live${path}`, {
      ...init,
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const row =
        payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      const nested =
        row.error && typeof row.error === "object" ? (row.error as Record<string, unknown>) : {};
      const message = nested.message ?? row.message;
      throw new StudioLiveRequestError(
        typeof message === "string"
          ? message.slice(0, 300)
          : "Live request could not be completed.",
        response.status,
      );
    }
    if (payload === null) throw invalid();
    return payload;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
export async function getStudioLive(signal: AbortSignal, cursor?: string) {
  return parseStudioLiveSnapshot(
    await request(cursor ? `?cursor=${encodeURIComponent(cursor)}` : "", signal),
    cursor,
  );
}
export function liveSessionInput(title: string, localStart: string) {
  const trimmed = title.trim();
  if (!trimmed || trimmed.length > 200)
    throw new Error("Enter a title between 1 and 200 characters.");
  if (!localStart) return { title: trimmed };
  const date = new Date(localStart);
  const day = localStart.slice(0, 10),
    calendar = new Date(`${day}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}T/.test(localStart) ||
    !Number.isFinite(date.getTime()) ||
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== day ||
    date.getTime() <= Date.now()
  )
    throw new Error("Choose a valid future start date and time.");
  return { title: trimmed, scheduledStartAt: date.toISOString() };
}
export async function createStudioLive(
  title: string,
  start: string,
  signal: AbortSignal,
  channelId?: string,
) {
  const input = liveSessionInput(title, start);
  const value = await request("", signal, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const stream = parseStudioLiveStream(value);
  if (
    stream.title !== input.title ||
    (stream.scheduledStartAt ?? undefined) !== input.scheduledStartAt ||
    (channelId && object(value).channelId !== channelId)
  )
    throw invalid();
  return stream;
}
export async function getEncoderCredentials(id: string, rotate: boolean, signal: AbortSignal) {
  const payload = await request(
    `/${encodeURIComponent(id)}/${rotate ? "rotate-key" : "provision"}`,
    signal,
    { method: "POST" },
  );
  const row = object(payload),
    encoder = object(row.encoder),
    rtmps = object(encoder.rtmps);
  const stream = parseStudioLiveStream(row.stream);
  if (
    stream.id !== id ||
    typeof rtmps.serverUrl !== "string" ||
    typeof rtmps.streamKey !== "string"
  )
    throw invalid();
  const result = {
    encoder: {
      rtmps: { serverUrl: text(rtmps.serverUrl, 4096), streamKey: text(rtmps.streamKey, 4096) },
      ...(encoder.srt ? { srt: { url: text(object(encoder.srt).url, 4096) } } : {}),
    },
  };
  if (
    !result.encoder?.rtmps?.serverUrl ||
    !result.encoder.rtmps.streamKey ||
    typeof result.encoder.rtmps.serverUrl !== "string" ||
    typeof result.encoder.rtmps.streamKey !== "string" ||
    (result.encoder.srt && typeof result.encoder.srt.url !== "string")
  )
    throw new Error(
      "Encoder credentials could not be verified. Refresh the session list before trying again.",
    );
  const server = new URL(result.encoder.rtmps.serverUrl);
  if (server.protocol !== "rtmps:" || !server.hostname || server.username || server.password)
    throw invalid();
  if (result.encoder.srt && new URL(result.encoder.srt.url).protocol !== "srt:") throw invalid();
  return result.encoder;
}
export async function syncStudioLive(id: string, signal: AbortSignal) {
  const payload = await request(`/${encodeURIComponent(id)}/sync`, signal, { method: "POST" });
  const row = object(payload),
    stream = parseStudioLiveStream(row.stream),
    evidence = object(row.evidence);
  if (stream.id !== id) throw invalid();
  return { evidence: { state: text(evidence.state, 32), playable: bool(evidence.playable) } };
}
export async function setStudioLiveChat(id: string, enabled: boolean, signal: AbortSignal) {
  const payload = await request(`/${encodeURIComponent(id)}/chat`, signal, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  const row = object(payload),
    result = { streamId: text(row.streamId, 36), chatEnabled: bool(row.chatEnabled) };
  if (result.streamId !== id || result.chatEnabled !== enabled)
    throw new Error(
      "Chat changes could not be verified. Refresh the session list before trying again.",
    );
  return result;
}
