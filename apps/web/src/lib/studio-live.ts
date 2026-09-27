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
async function request<T>(path: string, signal: AbortSignal, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/studio/live${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message ?? payload?.message;
    throw new StudioLiveRequestError(
      typeof message === "string" ? message : "Live request could not be completed.",
      response.status,
    );
  }
  if (payload === null)
    throw new Error(
      "The response could not be verified. Refresh the session list before trying again.",
    );
  return payload as T;
}
export function getStudioLive(signal: AbortSignal) {
  return request<StudioLiveSnapshot>("", signal);
}
export function liveSessionInput(title: string, localStart: string) {
  const trimmed = title.trim();
  if (!trimmed || trimmed.length > 200)
    throw new Error("Enter a title between 1 and 200 characters.");
  if (!localStart) return { title: trimmed };
  const date = new Date(localStart);
  if (!Number.isFinite(date.getTime())) throw new Error("Choose a valid start date and time.");
  return { title: trimmed, scheduledStartAt: date.toISOString() };
}
export function createStudioLive(title: string, start: string, signal: AbortSignal) {
  return request<StudioLiveStream>("", signal, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(liveSessionInput(title, start)),
  });
}
export async function getEncoderCredentials(id: string, rotate: boolean, signal: AbortSignal) {
  const result = await request<{ encoder?: EncoderConfiguration }>(
    `/${encodeURIComponent(id)}/${rotate ? "rotate-key" : "provision"}`,
    signal,
    { method: "POST" },
  );
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
  return result.encoder;
}
export function syncStudioLive(id: string, signal: AbortSignal) {
  return request<{ evidence?: { state?: string; playable?: boolean } }>(
    `/${encodeURIComponent(id)}/sync`,
    signal,
    { method: "POST" },
  );
}
export async function setStudioLiveChat(id: string, enabled: boolean, signal: AbortSignal) {
  const result = await request<{ streamId: string; chatEnabled: boolean }>(
    `/${encodeURIComponent(id)}/chat`,
    signal,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
  );
  if (result.streamId !== id || typeof result.chatEnabled !== "boolean")
    throw new Error(
      "Chat changes could not be verified. Refresh the session list before trying again.",
    );
  return result;
}
