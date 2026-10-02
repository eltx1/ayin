import type { AyinCaptionTrack } from "./ayin-player";

export type LiveViewerStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "READY"
  | "LIVE"
  | "ENDED"
  | "CANCELLED"
  | "FAILED";

export interface LiveViewerStream {
  id: string;
  title: string;
  description: string | null;
  status: LiveViewerStatus;
  playbackUrl: string | null;
  scheduledStartAt: string | null;
  chatEnabled: boolean;
  captions: AyinCaptionTrack[];
  dvrWindowSeconds: number | null;
  channel: { id: string; handle: string; name: string };
}

export interface LiveChatMessage {
  id: string;
  body: string;
  createdAt: string;
}

export interface LiveChatPage {
  chatEnabled: boolean;
  messages: LiveChatMessage[];
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = new Set<LiveViewerStatus>([
  "DRAFT",
  "SCHEDULED",
  "READY",
  "LIVE",
  "ENDED",
  "CANCELLED",
  "FAILED",
]);

function record(
  value: unknown,
  code: "INVALID_LIVE_RESPONSE" | "INVALID_LIVE_CHAT_RESPONSE" = "INVALID_LIVE_RESPONSE",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, min: number, max: number): string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new Error("INVALID_LIVE_RESPONSE");
  }
  return value;
}

function nullableDate(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error("INVALID_LIVE_RESPONSE");
  }
  return value;
}

function nullableHttpsUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 4_096) {
    throw new Error("INVALID_LIVE_RESPONSE");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("INVALID_LIVE_RESPONSE");
  }
  if (url.protocol !== "https:") throw new Error("INVALID_LIVE_RESPONSE");
  return value;
}

function parseCaption(value: unknown): AyinCaptionTrack {
  const track = record(value, "INVALID_LIVE_RESPONSE");
  if (
    typeof track.id !== "string" ||
    track.id.length === 0 ||
    typeof track.src !== "string" ||
    track.src.length === 0 ||
    typeof track.label !== "string" ||
    track.label.length === 0 ||
    typeof track.language !== "string" ||
    track.language.length === 0 ||
    (track.kind !== "CAPTIONS" && track.kind !== "SUBTITLES") ||
    (track.default !== undefined && typeof track.default !== "boolean")
  ) {
    throw new Error("INVALID_LIVE_RESPONSE");
  }
  return {
    id: track.id,
    src: track.src,
    label: track.label,
    language: track.language,
    kind: track.kind,
    ...(typeof track.default === "boolean" ? { default: track.default } : {}),
  };
}

export function parseLiveViewerStream(value: unknown): LiveViewerStream {
  const stream = record(value);
  const channel = record(stream.channel);
  if (
    typeof stream.id !== "string" ||
    !uuidPattern.test(stream.id) ||
    typeof channel.id !== "string" ||
    !uuidPattern.test(channel.id) ||
    typeof stream.status !== "string" ||
    !statuses.has(stream.status as LiveViewerStatus) ||
    typeof stream.chatEnabled !== "boolean" ||
    (stream.description !== null && typeof stream.description !== "string") ||
    (stream.description !== null && stream.description.length > 5_000) ||
    (stream.captions !== undefined &&
      (!Array.isArray(stream.captions) || stream.captions.length > 32))
  ) {
    throw new Error("INVALID_LIVE_RESPONSE");
  }
  if (
    stream.dvrWindowSeconds !== undefined &&
    stream.dvrWindowSeconds !== null &&
    (typeof stream.dvrWindowSeconds !== "number" ||
      !Number.isFinite(stream.dvrWindowSeconds) ||
      stream.dvrWindowSeconds <= 0 ||
      stream.dvrWindowSeconds > 86_400)
  ) {
    throw new Error("INVALID_LIVE_RESPONSE");
  }
  return {
    id: stream.id,
    title: boundedString(stream.title, 1, 200),
    description: stream.description,
    status: stream.status as LiveViewerStatus,
    playbackUrl: nullableHttpsUrl(stream.playbackUrl),
    scheduledStartAt: nullableDate(stream.scheduledStartAt),
    chatEnabled: stream.chatEnabled,
    captions: Array.isArray(stream.captions) ? stream.captions.map(parseCaption) : [],
    dvrWindowSeconds:
      typeof stream.dvrWindowSeconds === "number" ? stream.dvrWindowSeconds : null,
    channel: {
      id: channel.id,
      handle: boundedString(channel.handle, 1, 80),
      name: boundedString(channel.name, 1, 120),
    },
  };
}

export function parseLiveChatMessage(value: unknown): LiveChatMessage {
  const message = record(value, "INVALID_LIVE_CHAT_RESPONSE");
  if (
    typeof message.id !== "string" ||
    !uuidPattern.test(message.id) ||
    typeof message.body !== "string" ||
    message.body.length < 1 ||
    message.body.length > 500 ||
    typeof message.createdAt !== "string" ||
    !Number.isFinite(Date.parse(message.createdAt))
  ) {
    throw new Error("INVALID_LIVE_CHAT_RESPONSE");
  }
  return { id: message.id, body: message.body, createdAt: message.createdAt };
}

export function parseLiveChatPage(value: unknown): LiveChatPage {
  const page = record(value, "INVALID_LIVE_CHAT_RESPONSE");
  if (
    typeof page.chatEnabled !== "boolean" ||
    !Array.isArray(page.messages) ||
    page.messages.length > 200
  ) {
    throw new Error("INVALID_LIVE_CHAT_RESPONSE");
  }
  return {
    chatEnabled: page.chatEnabled,
    messages: page.messages.map(parseLiveChatMessage),
  };
}

export function liveStatusKey(status: LiveViewerStatus) {
  return `live.status${status[0]}${status.slice(1).toLowerCase()}` as
    | "live.statusDraft"
    | "live.statusScheduled"
    | "live.statusReady"
    | "live.statusLive"
    | "live.statusEnded"
    | "live.statusCancelled"
    | "live.statusFailed";
}

export function liveWaitingKey(status: LiveViewerStatus) {
  return `live.wait${status[0]}${status.slice(1).toLowerCase()}` as
    | "live.waitDraft"
    | "live.waitScheduled"
    | "live.waitReady"
    | "live.waitLive"
    | "live.waitEnded"
    | "live.waitCancelled"
    | "live.waitFailed";
}

export function terminalLiveStatus(status: LiveViewerStatus): boolean {
  return status === "ENDED" || status === "CANCELLED" || status === "FAILED";
}
