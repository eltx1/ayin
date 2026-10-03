import { getStudioOverview } from "./studio";
export type StudioOverviewSnapshot = {
  channel: { id: string; name: string };
  counters: {
    videos: number;
    publishedVideos: number;
    subscribers: number;
    comments: number;
    playlists: number;
  };
  recentUploads: Array<{ id: string; title: string; status: string }>;
  monetization: { contractStatus: string; revenueShareBps: number | null };
};
const statuses = ["DRAFT", "UPLOADING", "VALIDATING", "SCHEDULED", "PUBLISHED", "REMOVED"];
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Studio overview");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("Invalid Studio overview");
  return value;
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid Studio overview");
  return value;
}
export function parseStudioOverview(value: unknown): StudioOverviewSnapshot {
  const root = record(value),
    channel = record(root.channel),
    counters = record(root.counters),
    monetization = record(root.monetization);
  if (!Array.isArray(root.recentUploads) || root.recentUploads.length > 6)
    throw new Error("Invalid Studio overview");
  const ids = new Set<string>();
  const recentUploads = root.recentUploads.map((value) => {
    const row = record(value),
      id = text(row.id, 128),
      status = text(row.status, 32);
    if (ids.has(id) || !statuses.includes(status)) throw new Error("Invalid Studio overview");
    ids.add(id);
    return { id, status, title: text(row.title, 500) };
  });
  const contractStatus = text(monetization.contractStatus, 32);
  if (!["PENDING", "ACTIVE", "SUSPENDED", "ENDED"].includes(contractStatus))
    throw new Error("Invalid Studio overview");
  const revenueShareBps =
    monetization.revenueShareBps === null ? null : count(monetization.revenueShareBps);
  if (revenueShareBps !== null && revenueShareBps > 10000)
    throw new Error("Invalid Studio overview");
  return {
    channel: { id: text(channel.id, 128), name: text(channel.name, 200) },
    counters: {
      videos: count(counters.videos),
      publishedVideos: count(counters.publishedVideos),
      subscribers: count(counters.subscribers),
      comments: count(counters.comments),
      playlists: count(counters.playlists),
    },
    recentUploads,
    monetization: { contractStatus, revenueShareBps },
  };
}
export async function getStudioOverviewSnapshot(signal: AbortSignal) {
  return parseStudioOverview(await getStudioOverview(signal));
}
