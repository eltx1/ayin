export const LIVE_PROVIDER_CRITERIA = [
  { key: "ingest", label: "RTMPS/SRT ingest + OBS fit", weight: 12 },
  { key: "latency", label: "Playback latency", weight: 12 },
  { key: "scale", label: "Autoscaling + global CDN", weight: 10 },
  { key: "lifecycle", label: "Recording, webhooks, key rotation", weight: 12 },
  { key: "api", label: "API maturity + operability", weight: 10 },
  { key: "ads", label: "Advertising + Google IMA/DAI path", weight: 12 },
  { key: "drm", label: "DRM/content security roadmap", weight: 8 },
  { key: "analytics", label: "Analytics/observability", weight: 7 },
  { key: "cost", label: "Cost model + minimum commitments", weight: 8 },
  { key: "portability", label: "VOD handoff + vendor portability", weight: 9 },
] as const;

export type LiveProviderCriterionKey = (typeof LIVE_PROVIDER_CRITERIA)[number]["key"];

export interface LiveProviderCandidateScore {
  key: "mux" | "aws-ivs" | "cloudflare-stream" | "bitmovin";
  label: string;
  scores: Record<LiveProviderCriterionKey, number>;
}

export const LIVE_PROVIDER_CANDIDATES: readonly LiveProviderCandidateScore[] = [
  {
    key: "mux",
    label: "Mux Video",
    scores: {
      ingest: 5,
      latency: 4.5,
      scale: 5,
      lifecycle: 5,
      api: 5,
      ads: 4,
      drm: 5,
      analytics: 5,
      cost: 4.5,
      portability: 4,
    },
  },
  {
    key: "aws-ivs",
    label: "Amazon IVS",
    scores: {
      ingest: 5,
      latency: 5,
      scale: 5,
      lifecycle: 4.5,
      api: 4.5,
      ads: 4.5,
      drm: 1,
      analytics: 4.5,
      cost: 3,
      portability: 2.5,
    },
  },
  {
    key: "cloudflare-stream",
    label: "Cloudflare Stream",
    scores: {
      ingest: 5,
      latency: 3.5,
      scale: 5,
      lifecycle: 4.5,
      api: 4,
      ads: 2.5,
      drm: 2,
      analytics: 4,
      cost: 5,
      portability: 4,
    },
  },
  {
    key: "bitmovin",
    label: "Bitmovin Live Encoder",
    scores: {
      ingest: 5,
      latency: 4,
      scale: 3,
      lifecycle: 3.5,
      api: 5,
      ads: 5,
      drm: 5,
      analytics: 5,
      cost: 1.5,
      portability: 3.5,
    },
  },
] as const;

export function weightedLiveProviderScore(candidate: LiveProviderCandidateScore): number {
  const total = LIVE_PROVIDER_CRITERIA.reduce((sum, criterion) => {
    const score = candidate.scores[criterion.key];
    if (score < 0 || score > 5) throw new Error("LIVE_PROVIDER_SCORE_OUT_OF_RANGE");
    return sum + (criterion.weight * score) / 5;
  }, 0);
  return Math.round(total * 10) / 10;
}

export const LIVE_PROVIDER_DECISION = Object.freeze({
  selectedProvider: "mux" as const,
  fallbackProvider: "aws-ivs" as const,
  productionConnected: false,
  productionBehaviorChanged: false,
  controlPlaneProof: {
    status: "BLOCKED_NO_CREDENTIALS" as const,
    requiredEnvironment: ["MUX_TOKEN_ID", "MUX_TOKEN_SECRET"] as const,
    optInEnvironment: "MUX_TASK72_PROOF=1",
    freeProviderTestModeAvailable: true,
  },
  task73ContractVersion: 1,
});
