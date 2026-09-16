import type { TrendingConfig } from "../platform-config/trending-settings.js";

export interface TrendingRawMetrics {
  videoId: string;
  qualifiedViews: number;
  recentQualifiedViews: number;
  priorQualifiedViews: number;
  watchTimeMs: number;
  completions: number;
  uniqueSessions: number;
  recencyScore: number;
  negativeSessions: number;
}

export interface TrendingScoreComponents {
  qualifiedViews: number;
  watchTime: number;
  completion: number;
  velocity: number;
  velocityRaw: number;
  uniqueSessions: number;
  recency: number;
  negativeQuality: number;
  qualifiedViewsRaw: number;
  recentQualifiedViews: number;
  priorQualifiedViews: number;
  watchTimeMs: number;
  completions: number;
  uniqueSessionsRaw: number;
  negativeSessions: number;
}

export interface TrendingScoredCandidate {
  videoId: string;
  score: number;
  audienceCount: number;
  components: TrendingScoreComponents;
}

export interface TrendingScopeSelection {
  scope: "GLOBAL" | "REGIONAL";
  regionalApplied: boolean;
  candidates: TrendingScoredCandidate[];
}

// Inputs are audience-qualified aggregates; this layer never ranks by raw view count alone.
export function scoreTrendingCandidates(
  metrics: TrendingRawMetrics[],
  config: TrendingConfig,
  minimumAudience: number,
): TrendingScoredCandidate[] {
  const eligible = metrics.filter(
    (metric) =>
      finiteNonNegative(metric.qualifiedViews) >= minimumAudience &&
      finiteNonNegative(metric.uniqueSessions) >= minimumAudience,
  );
  if (!eligible.length) return [];

  const maxQualifiedLog = maxLog(eligible.map((metric) => metric.qualifiedViews));
  const maxWatchLog = maxLog(eligible.map((metric) => metric.watchTimeMs));
  const maxSessionLog = maxLog(eligible.map((metric) => metric.uniqueSessions));
  const positiveWeight =
    config.weights.qualifiedViews +
    config.weights.watchTime +
    config.weights.completion +
    config.weights.velocity +
    config.weights.uniqueSessions +
    config.weights.recency;
  const penaltyScale =
    positiveWeight + config.weights.negativeQuality > 0
      ? config.weights.negativeQuality / (positiveWeight + config.weights.negativeQuality)
      : 0;

  return eligible
    .map((metric) => {
      const qualifiedViewsRaw = finiteNonNegative(metric.qualifiedViews);
      const uniqueSessionsRaw = finiteNonNegative(metric.uniqueSessions);
      const completionRate = clamp(
        safeDivide(finiteNonNegative(metric.completions), qualifiedViewsRaw),
        0,
        1,
      );
      const recentRate =
        finiteNonNegative(metric.recentQualifiedViews) / Math.max(1, config.recentHours);
      const priorHours = Math.max(1, config.windowHours - config.recentHours);
      const priorRate = finiteNonNegative(metric.priorQualifiedViews) / priorHours;
      const velocityRaw = (recentRate + 0.1) / (priorRate + 0.1);
      const components: TrendingScoreComponents = {
        qualifiedViews: normalizedLog(qualifiedViewsRaw, maxQualifiedLog),
        watchTime: normalizedLog(finiteNonNegative(metric.watchTimeMs), maxWatchLog),
        completion: completionRate,
        velocity:
          clamp(velocityRaw, 0, config.maxVelocityMultiplier) / config.maxVelocityMultiplier,
        velocityRaw,
        uniqueSessions: normalizedLog(uniqueSessionsRaw, maxSessionLog),
        recency: clamp(finiteNonNegative(metric.recencyScore), 0, 1),
        negativeQuality: clamp(
          safeDivide(finiteNonNegative(metric.negativeSessions), uniqueSessionsRaw),
          0,
          1,
        ),
        qualifiedViewsRaw,
        recentQualifiedViews: finiteNonNegative(metric.recentQualifiedViews),
        priorQualifiedViews: finiteNonNegative(metric.priorQualifiedViews),
        watchTimeMs: finiteNonNegative(metric.watchTimeMs),
        completions: finiteNonNegative(metric.completions),
        uniqueSessionsRaw,
        negativeSessions: finiteNonNegative(metric.negativeSessions),
      };

      const positive =
        components.qualifiedViews * config.weights.qualifiedViews +
        components.watchTime * config.weights.watchTime +
        components.completion * config.weights.completion +
        components.velocity * config.weights.velocity +
        components.uniqueSessions * config.weights.uniqueSessions +
        components.recency * config.weights.recency;
      const score =
        (positiveWeight > 0 ? positive / positiveWeight : 0) -
        components.negativeQuality * penaltyScale;

      return {
        videoId: metric.videoId,
        score: Math.max(0, score),
        audienceCount: Math.floor(uniqueSessionsRaw),
        components,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.components.recentQualifiedViews - left.components.recentQualifiedViews ||
        right.components.qualifiedViewsRaw - left.components.qualifiedViewsRaw ||
        left.videoId.localeCompare(right.videoId),
    );
}

export function selectTrendingScope(
  globalMetrics: TrendingRawMetrics[],
  regionalMetrics: TrendingRawMetrics[] | undefined,
  config: TrendingConfig,
): TrendingScopeSelection {
  if (regionalMetrics) {
    const regional = scoreTrendingCandidates(regionalMetrics, config, config.minAudienceRegional);
    if (regional.length > 0) {
      return { scope: "REGIONAL", regionalApplied: true, candidates: regional };
    }
  }
  return {
    scope: "GLOBAL",
    regionalApplied: false,
    candidates: scoreTrendingCandidates(globalMetrics, config, config.minAudienceGlobal),
  };
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function maxLog(values: number[]): number {
  return Math.max(1, ...values.map((value) => Math.log1p(finiteNonNegative(value))));
}

function normalizedLog(value: number, max: number): number {
  return clamp(Math.log1p(finiteNonNegative(value)) / max, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
