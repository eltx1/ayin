import { describe, expect, it } from "vitest";

import { recommendationEvaluationFixture } from "./recommendation-evaluation.fixture.js";
import {
  assessRecommendationRelease,
  compareRecommendationVersions,
  evaluateRecommendationVersion,
} from "./recommendation-evaluator.js";
import {
  allocateRecommendationVariant,
  recommendationVersionId,
} from "./recommendation-version.js";

describe("recommendation evaluation", () => {
  it("is deterministic for fixed fixtures", () => {
    const first = evaluateRecommendationVersion(recommendationEvaluationFixture, "balanced", 4);
    const second = evaluateRecommendationVersion(recommendationEvaluationFixture, "balanced", 4);
    expect(second).toEqual(first);
  });

  it("compares ranking versions across relevance, engagement and diversity metrics", () => {
    const baseline = evaluateRecommendationVersion(recommendationEvaluationFixture, "baseline", 4);
    const candidate = evaluateRecommendationVersion(recommendationEvaluationFixture, "balanced", 4);
    const delta = compareRecommendationVersions(baseline, candidate);

    expect(candidate.creatorDiversity).toBeGreaterThan(baseline.creatorDiversity);
    expect(candidate.catalogDiversity).toBeGreaterThanOrEqual(baseline.catalogDiversity);
    expect(candidate.novelty).toBeGreaterThan(baseline.novelty);
    expect(delta.repeatedItemRate).toBeLessThanOrEqual(0);
  });

  it("blocks a watch-time-only ranking when creator and catalog diversity collapse", () => {
    const baseline = evaluateRecommendationVersion(recommendationEvaluationFixture, "baseline", 4);
    const watchOnly = evaluateRecommendationVersion(
      recommendationEvaluationFixture,
      "watch-only",
      4,
    );
    const assessment = assessRecommendationRelease(baseline, watchOnly);

    expect(watchOnly.watchTimeRelevance).toBeGreaterThan(baseline.watchTimeRelevance);
    expect(assessment.pass).toBe(false);
    expect(assessment.blockers).toContain("creatorDiversity");
    expect(assessment.blockers).toContain("catalogDiversity");
    expect(assessment.blockers).toContain("repeatedItemRate");
  });

  it("derives stable version ids from the algorithm and effective config", () => {
    const first = recommendationVersionId("algo-v1", { history: 30, recency: 10 });
    const same = recommendationVersionId("algo-v1", { recency: 10, history: 30 });
    const changed = recommendationVersionId("algo-v1", { history: 31, recency: 10 });
    expect(first).toBe(same);
    expect(changed).not.toBe(first);
  });

  it("keeps future experiment allocation deterministic without enabling experiments", () => {
    const plan = [
      { key: "control", weightBps: 5000 },
      { key: "candidate", weightBps: 5000 },
    ];
    const first = allocateRecommendationVariant("anonymous-stable-key", "task66-boundary", plan);
    const second = allocateRecommendationVariant("anonymous-stable-key", "task66-boundary", plan);
    expect(first).toBe(second);
    expect(["control", "candidate"]).toContain(first);
  });
});
