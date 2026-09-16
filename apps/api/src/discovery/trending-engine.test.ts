import { describe, expect, it } from "vitest";

import {
  scoreTrendingCandidates,
  selectTrendingScope,
  type TrendingRawMetrics,
} from "./trending-engine.js";
import {
  defaultTrendingConfig,
  trendingConfigSchema,
} from "../platform-config/trending-settings.js";

const metric = (
  videoId: string,
  overrides: Partial<TrendingRawMetrics> = {},
): TrendingRawMetrics => ({
  videoId,
  qualifiedViews: 100,
  recentQualifiedViews: 40,
  priorQualifiedViews: 60,
  watchTimeMs: 12_000_000,
  completions: 70,
  uniqueSessions: 110,
  recencyScore: 0.7,
  negativeSessions: 2,
  ...overrides,
});

describe("Task 63 trending engine offline fixtures", () => {
  it("lets recent growth beat stale large content when engagement and velocity are stronger", () => {
    const staleLarge = metric("stale-large", {
      qualifiedViews: 500,
      recentQualifiedViews: 2,
      priorQualifiedViews: 498,
      watchTimeMs: 60_000_000,
      completions: 350,
      uniqueSessions: 550,
      recencyScore: 0.1,
      negativeSessions: 10,
    });
    const recentGrowth = metric("recent-growth", {
      qualifiedViews: 120,
      recentQualifiedViews: 90,
      priorQualifiedViews: 30,
      watchTimeMs: 21_600_000,
      completions: 100,
      uniqueSessions: 130,
      recencyScore: 0.9,
      negativeSessions: 3,
    });

    const ranked = scoreTrendingCandidates(
      [staleLarge, recentGrowth],
      defaultTrendingConfig,
      defaultTrendingConfig.minAudienceGlobal,
    );

    expect(ranked.map((candidate) => candidate.videoId)).toEqual(["recent-growth", "stale-large"]);
    expect(ranked[0]?.components.velocity).toBeGreaterThan(ranked[1]?.components.velocity ?? 0);
  });

  it("does not let a tiny repeated-session spam loop dominate", () => {
    const spamLoop = metric("spam-loop", {
      qualifiedViews: 2,
      recentQualifiedViews: 2,
      priorQualifiedViews: 0,
      watchTimeMs: 3_600_000_000,
      completions: 2,
      uniqueSessions: 2,
      recencyScore: 1,
      negativeSessions: 0,
    });
    const organic = metric("organic", {
      qualifiedViews: 20,
      recentQualifiedViews: 12,
      priorQualifiedViews: 8,
      uniqueSessions: 24,
    });

    const ranked = scoreTrendingCandidates(
      [spamLoop, organic],
      defaultTrendingConfig,
      defaultTrendingConfig.minAudienceGlobal,
    );

    expect(ranked.map((candidate) => candidate.videoId)).toEqual(["organic"]);
  });

  it("falls back to worldwide ranking when regional audience is below the safe sample", () => {
    const global = [metric("global-a"), metric("global-b", { recencyScore: 0.5 })];
    const tooSmallRegion = [
      metric("regional-small", {
        qualifiedViews: defaultTrendingConfig.minAudienceRegional - 1,
        uniqueSessions: defaultTrendingConfig.minAudienceRegional - 1,
      }),
    ];

    const selection = selectTrendingScope(global, tooSmallRegion, defaultTrendingConfig);

    expect(selection.scope).toBe("GLOBAL");
    expect(selection.regionalApplied).toBe(false);
    expect(selection.candidates.length).toBeGreaterThan(0);
    expect(selection.candidates.some((candidate) => candidate.videoId === "regional-small")).toBe(
      false,
    );
  });

  it("uses regional ranking only after the regional audience threshold is met", () => {
    const regional = [
      metric("regional-safe", {
        qualifiedViews: defaultTrendingConfig.minAudienceRegional,
        uniqueSessions: defaultTrendingConfig.minAudienceRegional + 5,
      }),
    ];
    const selection = selectTrendingScope([metric("global-a")], regional, defaultTrendingConfig);

    expect(selection.scope).toBe("REGIONAL");
    expect(selection.regionalApplied).toBe(true);
    expect(selection.candidates[0]?.videoId).toBe("regional-safe");
  });

  it("rejects unsafe Admin weight and cohort configurations", () => {
    expect(
      trendingConfigSchema.safeParse({
        ...defaultTrendingConfig,
        minAudienceRegional: 2,
      }).success,
    ).toBe(false);
    expect(
      trendingConfigSchema.safeParse({
        ...defaultTrendingConfig,
        weights: { ...defaultTrendingConfig.weights, velocity: 99 },
      }).success,
    ).toBe(false);
    expect(
      trendingConfigSchema.safeParse({
        ...defaultTrendingConfig,
        weights: {
          ...defaultTrendingConfig.weights,
          qualifiedViews: 0,
          watchTime: 0,
          completion: 0,
          velocity: 0,
          uniqueSessions: 0,
          recency: 0,
        },
      }).success,
    ).toBe(false);
  });
});
