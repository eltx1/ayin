import type { DirectDecisionContext } from "./direct-ad.schemas.js";

export interface DirectCampaignCandidate {
  id: string;
  priority: number;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
  startsAt: Date | null;
  endsAt: Date | null;
  impressionGoal: number | null;
  totalImpressions: number;
  frequencyCap: number;
  sessionImpressions: number;
  pacing: "EVEN" | "ASAP";
  targeting: {
    placementKeys: string[];
    countries: string[];
    regions: string[];
    devices: Array<"MOBILE" | "DESKTOP" | "TV">;
    categories: string[];
    channelIds: string[];
    videoIds: string[];
  };
}

function targetMatches(values: string[], value: string | null | undefined) {
  return values.length === 0 || (!!value && values.includes(value));
}

function pacingAllows(candidate: DirectCampaignCandidate, now: Date) {
  if (candidate.impressionGoal !== null && candidate.totalImpressions >= candidate.impressionGoal) {
    return false;
  }
  if (candidate.pacing === "ASAP" || candidate.impressionGoal === null) return true;
  if (!candidate.startsAt || !candidate.endsAt) return true;
  const totalMs = candidate.endsAt.getTime() - candidate.startsAt.getTime();
  if (totalMs <= 0) return false;
  const elapsed = Math.max(
    0,
    Math.min(1, (now.getTime() - candidate.startsAt.getTime()) / totalMs),
  );
  const expected = candidate.impressionGoal * elapsed;
  const allowance = Math.max(1, Math.ceil(candidate.impressionGoal * 0.01));
  return candidate.totalImpressions <= expected + allowance;
}

export function isDirectCampaignEligible(
  candidate: DirectCampaignCandidate,
  context: DirectDecisionContext,
  now: Date,
) {
  if (candidate.status !== "ACTIVE") return false;
  if (candidate.startsAt && now < candidate.startsAt) return false;
  if (candidate.endsAt && now >= candidate.endsAt) return false;
  if (candidate.frequencyCap > 0 && candidate.sessionImpressions >= candidate.frequencyCap)
    return false;
  if (!pacingAllows(candidate, now)) return false;

  const target = candidate.targeting;
  return (
    targetMatches(target.placementKeys, context.placementKey) &&
    targetMatches(target.devices, context.device) &&
    targetMatches(target.countries, context.country) &&
    targetMatches(target.regions, context.region) &&
    targetMatches(target.categories, context.category) &&
    targetMatches(target.channelIds, context.channelId) &&
    targetMatches(target.videoIds, context.videoId)
  );
}

export function chooseDirectCampaign(
  candidates: DirectCampaignCandidate[],
  context: DirectDecisionContext,
  now = new Date(),
) {
  return (
    candidates
      .filter((candidate) => isDirectCampaignEligible(candidate, context, now))
      .sort(
        (left, right) => right.priority - left.priority || left.id.localeCompare(right.id),
      )[0] ?? null
  );
}
