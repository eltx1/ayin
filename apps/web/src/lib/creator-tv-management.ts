import { apiBaseUrl } from "./api";
import {
  CreatorTvStatusError,
  getCreatorTvStatus,
  type CreatorTvStatus,
} from "./creator-tv-status";

export class TvManagementError extends Error {
  constructor(
    readonly status: number,
    readonly writeStarted = false,
  ) {
    super("Creator TV request could not be verified");
  }
}
const invalid = () => new TvManagementError(0);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(value: unknown): Record<string, unknown> {
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
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw invalid();
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalid();
  return value;
}
function date(value: unknown): string {
  const result = text(value, 40);
  if (
    !/^\d{4}-\d\d-\d\dT/.test(result) ||
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString() !== result
  )
    throw invalid();
  return result;
}
export type TvPreference = { included: boolean; priority: number; sortOrder: number | null };
export type ManagedTvVideo = TvPreference & {
  id: string;
  title: string;
  description: string | null;
  publishedAt: string | null;
  durationMs: number | null;
  effectiveDurationMs: number;
};
export type TvManagement = {
  channel: { id: string; name: string; handle: string };
  tv: { id: string; name: string; status: "ACTIVE" | "OFF_AIR" | "DISABLED" };
  automation: {
    platformEnabled: boolean;
    channelAutoAddEnabled: boolean;
    channelScheduleEnabled: boolean;
    rotationMode: "PRIORITY_ORDER_OLDEST" | "PRIORITY_ORDER_NEWEST";
    fallbackDurationMs: number;
    guideWindowMinutes: number;
  };
  videos: ManagedTvVideo[];
};
function preference(value: unknown): TvPreference {
  const row = object(value);
  return {
    included: boolean(row.included),
    priority: integer(row.priority, -100000, 100000),
    sortOrder: row.sortOrder === null ? null : integer(row.sortOrder, 0, 1000000),
  };
}
export function tvPreferenceInput(
  included: boolean,
  priority: string,
  sortOrder: string,
): TvPreference {
  if (!/^-?\d+$/.test(priority.trim()) || (sortOrder.trim() && !/^\d+$/.test(sortOrder.trim())))
    throw invalid();
  return preference({
    included,
    priority: Number(priority.trim()),
    sortOrder: sortOrder.trim() === "" ? null : Number(sortOrder.trim()),
  });
}
export function parseTvManagement(value: unknown, channelId: string): TvManagement {
  const root = object(value),
    channel = object(root.channel),
    tv = object(root.tv),
    automation = object(root.automation),
    status = text(tv.status, 16),
    mode = text(automation.rotationMode, 32);
  if (
    id(channel.id) !== channelId ||
    !["ACTIVE", "OFF_AIR", "DISABLED"].includes(status) ||
    !["PRIORITY_ORDER_OLDEST", "PRIORITY_ORDER_NEWEST"].includes(mode) ||
    !Array.isArray(root.videos) ||
    root.videos.length > 10000
  )
    throw invalid();
  const videos = root.videos.map((value): ManagedTvVideo => {
    const row = object(value);
    return {
      id: id(row.id),
      title: text(row.title, 1000),
      description: row.description === null ? null : text(row.description, 100000, true),
      publishedAt: row.publishedAt === null ? null : date(row.publishedAt),
      durationMs:
        row.durationMs === null ? null : integer(row.durationMs, 0, Number.MAX_SAFE_INTEGER),
      effectiveDurationMs: integer(row.effectiveDurationMs, 0, Number.MAX_SAFE_INTEGER),
      ...preference(row),
    };
  });
  if (new Set(videos.map((row) => row.id)).size !== videos.length) throw invalid();
  return {
    channel: { id: channelId, name: text(channel.name, 120), handle: text(channel.handle, 80) },
    tv: { id: id(tv.id), name: text(tv.name, 200), status: status as TvManagement["tv"]["status"] },
    automation: {
      platformEnabled: boolean(automation.platformEnabled),
      channelAutoAddEnabled: boolean(automation.channelAutoAddEnabled),
      channelScheduleEnabled: boolean(automation.channelScheduleEnabled),
      rotationMode: mode as TvManagement["automation"]["rotationMode"],
      fallbackDurationMs: integer(automation.fallbackDurationMs, 1, Number.MAX_SAFE_INTEGER),
      guideWindowMinutes: integer(automation.guideWindowMinutes, 1, Number.MAX_SAFE_INTEGER),
    },
    videos,
  };
}
export function parseTvPreferenceAck(value: unknown, videoId: string, input: TvPreference) {
  const row = object(object(value).preference),
    saved = preference(row);
  if (
    id(row.videoId) !== videoId ||
    saved.included !== input.included ||
    saved.priority !== input.priority ||
    saved.sortOrder !== input.sortOrder
  )
    throw invalid();
  return { ...saved, videoId, updatedAt: date(row.updatedAt) };
}
export type TvSnapshot = TvManagement & { accountId: string; output: CreatorTvStatus };
async function request(path: string, signal: AbortSignal, init: RequestInit = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    signal,
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new TvManagementError(response.status, Boolean(init.method));
  return (await response.json()) as unknown;
}
async function identity(signal: AbortSignal) {
  const root = object(await request("/auth/me", signal));
  return { accountId: id(object(root.account).id), channelId: id(object(root.channel).id) };
}
async function bounded<T>(
  signal: AbortSignal,
  milliseconds: number,
  operation: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController(),
    abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, milliseconds);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
export async function getTvManagement(
  signal: AbortSignal,
  expected?: Pick<TvSnapshot, "accountId" | "channel">,
) {
  return bounded(signal, 15000, async (signal) => {
    const actor = await identity(signal);
    if (
      expected &&
      (actor.accountId !== expected.accountId || actor.channelId !== expected.channel.id)
    )
      throw new TvManagementError(403);
    const data = parseTvManagement(
        await request(`/creator/channels/${actor.channelId}/tv`, signal),
        actor.channelId,
      ),
      output = await getCreatorTvStatus(data.tv.id, signal).catch((error) => {
        if (error instanceof CreatorTvStatusError) throw new TvManagementError(error.status);
        throw error;
      }),
      after = await identity(signal);
    if (after.accountId !== actor.accountId || after.channelId !== actor.channelId)
      throw new TvManagementError(403);
    return { ...data, accountId: actor.accountId, output };
  });
}
export async function saveTvPreference(
  snapshot: TvSnapshot,
  videoId: string,
  input: TvPreference,
  signal: AbortSignal,
) {
  id(videoId);
  preference(input);
  if (!snapshot.videos.some((row) => row.id === videoId)) throw invalid();
  return bounded(signal, 30000, async (signal) => {
    const actor = await identity(signal);
    if (actor.accountId !== snapshot.accountId || actor.channelId !== snapshot.channel.id)
      throw new TvManagementError(403);
    return parseTvPreferenceAck(
      await request(`/creator/tv/${id(snapshot.tv.id)}/videos/${videoId}`, signal, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
      videoId,
      input,
    );
  });
}
