import { z } from "zod";

export const TRENDING_SETTING_NAMESPACE = "DISCOVERY";
export const TRENDING_SETTING_KEY = "trendingEngine";

export const trendingWeightsSchema = z
  .object({
    qualifiedViews: z.number().min(0).max(3),
    watchTime: z.number().min(0).max(3),
    completion: z.number().min(0).max(3),
    velocity: z.number().min(0).max(3),
    uniqueSessions: z.number().min(0).max(3),
    recency: z.number().min(0).max(3),
    negativeQuality: z.number().min(0).max(3),
  })
  .strict();

export const trendingConfigSchema = z
  .object({
    windowHours: z.number().int().min(24).max(168),
    recentHours: z.number().int().min(1).max(24),
    halfLifeHours: z.number().min(2).max(72),
    minAudienceGlobal: z.number().int().min(3).max(1000),
    minAudienceRegional: z.number().int().min(20).max(2000),
    minQualifiedWatchMs: z.number().int().min(1000).max(60_000),
    perSessionWatchCapMs: z.number().int().min(60_000).max(3_600_000),
    maxVelocityMultiplier: z.number().min(1).max(10),
    maxCandidates: z.number().int().min(20).max(500),
    snapshotLimit: z.number().int().min(10).max(200),
    weights: trendingWeightsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.recentHours >= value.windowHours) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recentHours"],
        message: "recentHours must be smaller than windowHours.",
      });
    }
    if (value.minAudienceRegional < value.minAudienceGlobal) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minAudienceRegional"],
        message: "Regional audience minimum cannot be smaller than the global minimum.",
      });
    }
    const positiveWeight =
      value.weights.qualifiedViews +
      value.weights.watchTime +
      value.weights.completion +
      value.weights.velocity +
      value.weights.uniqueSessions +
      value.weights.recency;
    if (positiveWeight <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["weights"],
        message: "At least one positive ranking weight must be greater than zero.",
      });
    }
  });

export type TrendingConfig = z.infer<typeof trendingConfigSchema>;

// Defaults deliberately require a larger regional cohort than the global surface.
export const defaultTrendingConfig: TrendingConfig = {
  windowHours: 72,
  recentHours: 6,
  halfLifeHours: 12,
  minAudienceGlobal: 5,
  minAudienceRegional: 50,
  minQualifiedWatchMs: 5_000,
  perSessionWatchCapMs: 1_800_000,
  maxVelocityMultiplier: 4,
  maxCandidates: 200,
  snapshotLimit: 50,
  weights: {
    qualifiedViews: 1.1,
    watchTime: 1,
    completion: 0.8,
    velocity: 1.2,
    uniqueSessions: 0.8,
    recency: 1,
    negativeQuality: 0.8,
  },
};

export function parseTrendingConfig(value: unknown): TrendingConfig {
  const parsed = trendingConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultTrendingConfig;
}
