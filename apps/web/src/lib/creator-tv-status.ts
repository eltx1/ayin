import { apiBaseUrl } from "@/lib/api";

const statuses = ["UNCONFIGURED", "PROVISIONING", "READY", "STOPPED", "ERROR"] as const;
export interface CreatorTvStatus {
  tvChannelId: string;
  checkedAt: string;
  output: {
    configured: boolean;
    status: (typeof statuses)[number];
    available: boolean;
    lastPlanGeneratedAt: string | null;
    lastManifestAt: string | null;
  };
  schedule: { generatedAt: string; programCount: number };
  fallback: { strategy: "PROGRESSIVE_MP4"; enabled: boolean };
}
export class CreatorTvStatusError extends Error {
  constructor(readonly status: number) {
    super("Creator TV status could not be loaded.");
  }
}
export function parseCreatorTvStatus(value: unknown, tvChannelId: string): CreatorTvStatus {
  const data = value as CreatorTvStatus | null;
  const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
  const optionalDate = (value: unknown) => value === null || date(value);
  if (
    !data ||
    data.tvChannelId !== tvChannelId ||
    !date(data.checkedAt) ||
    !data.output ||
    !statuses.includes(data.output.status) ||
    typeof data.output.configured !== "boolean" ||
    typeof data.output.available !== "boolean" ||
    (data.output.available && (!data.output.configured || data.output.status !== "READY")) ||
    !optionalDate(data.output.lastPlanGeneratedAt) ||
    !optionalDate(data.output.lastManifestAt) ||
    !data.schedule ||
    !date(data.schedule.generatedAt) ||
    !Number.isSafeInteger(data.schedule.programCount) ||
    data.schedule.programCount < 0 ||
    data.fallback?.strategy !== "PROGRESSIVE_MP4" ||
    typeof data.fallback.enabled !== "boolean"
  )
    throw new CreatorTvStatusError(502);
  return data;
}
export async function getCreatorTvStatus(tvChannelId: string, signal: AbortSignal) {
  const response = await fetch(
    `${apiBaseUrl}/creator/tv/${encodeURIComponent(tvChannelId)}/linear/summary`,
    {
      credentials: "include",
      cache: "no-store",
      signal,
    },
  );
  if (!response.ok) throw new CreatorTvStatusError(response.status);
  return parseCreatorTvStatus(await response.json(), tvChannelId);
}
