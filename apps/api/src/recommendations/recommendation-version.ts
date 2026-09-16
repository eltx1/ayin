import { createHash } from "node:crypto";

export const RECOMMENDATION_VIDEO_ALGORITHM_ID = "explainable-weighted-scoring-v1";
export const RECOMMENDATION_TV_ALGORITHM_ID = "creator-tv-heuristic-v1";

export interface RecommendationExperimentVariant {
  key: string;
  weightBps: number;
}

export function recommendationVersionId<T extends object>(algorithmId: string, config: T): string {
  const normalized = Object.fromEntries(
    Object.entries(config).sort(([left], [right]) => left.localeCompare(right)),
  );
  const digest = createHash("sha256")
    .update(JSON.stringify({ algorithmId, config: normalized }))
    .digest("hex")
    .slice(0, 12);
  return `${algorithmId}-${digest}`;
}

/**
 * Future A/B boundary only. Production recommendation serving does not call
 * this function in Task 66. A later experiment system can supply a stable,
 * non-PII allocation key and an explicit variant plan. Assignment persistence,
 * consent and statistical rollout policy remain responsibilities of that future layer.
 */
export function allocateRecommendationVariant(
  allocationKey: string,
  experimentKey: string,
  variants: RecommendationExperimentVariant[],
): string | null {
  if (!allocationKey.trim() || !experimentKey.trim() || variants.length === 0) return null;
  const total = variants.reduce((sum, variant) => sum + variant.weightBps, 0);
  if (
    total !== 10_000 ||
    variants.some(
      (variant) =>
        !variant.key.trim() ||
        !Number.isInteger(variant.weightBps) ||
        variant.weightBps <= 0 ||
        variant.weightBps > 10_000,
    )
  ) {
    throw new Error(
      "Recommendation experiment weights must be positive integers totaling 10000 bps.",
    );
  }

  const digest = createHash("sha256").update(`${experimentKey}\u0000${allocationKey}`).digest();
  const bucket = digest.readUInt32BE(0) % 10_000;
  let cursor = 0;
  for (const variant of variants) {
    cursor += variant.weightBps;
    if (bucket < cursor) return variant.key;
  }
  return variants.at(-1)?.key ?? null;
}
