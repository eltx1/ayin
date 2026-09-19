import { describe, expect, it } from "vitest";

import {
  LIVE_PROVIDER_CANDIDATES,
  LIVE_PROVIDER_CRITERIA,
  LIVE_PROVIDER_DECISION,
  weightedLiveProviderScore,
} from "./live-provider-decision.js";

describe("Task 72 live provider decision", () => {
  it("keeps the weighted matrix normalized to 100", () => {
    expect(LIVE_PROVIDER_CRITERIA.reduce((sum, item) => sum + item.weight, 0)).toBe(100);
  });

  it("selects the highest weighted candidate without claiming a production connection", () => {
    const ranked = [...LIVE_PROVIDER_CANDIDATES]
      .map((candidate) => ({
        key: candidate.key,
        score: weightedLiveProviderScore(candidate),
      }))
      .sort((left, right) => right.score - left.score);

    expect(ranked).toEqual([
      { key: "mux", score: 93.8 },
      { key: "aws-ivs", score: 81.8 },
      { key: "bitmovin", score: 81.7 },
      { key: "cloudflare-stream", score: 79.2 },
    ]);
    expect(LIVE_PROVIDER_DECISION.selectedProvider).toBe("mux");
    expect(LIVE_PROVIDER_DECISION.fallbackProvider).toBe("aws-ivs");
    expect(LIVE_PROVIDER_DECISION.productionConnected).toBe(false);
    expect(LIVE_PROVIDER_DECISION.productionBehaviorChanged).toBe(false);
  });
});
