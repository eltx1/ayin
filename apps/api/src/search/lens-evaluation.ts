import { rankLensHybrid, type SemanticSearchHit } from "./lens-hybrid-ranker.js";
import type { SearchResult } from "./search.service.js";

export interface LensEvaluationMetrics {
  precisionAtK: number;
  recallAtK: number;
  reciprocalRank: number;
}

export function evaluateLensRanking(
  items: readonly SearchResult[],
  relevantIds: ReadonlySet<string>,
  k: number,
): LensEvaluationMetrics {
  const boundedK = Math.max(1, Math.min(k, items.length || 1));
  const top = items.slice(0, boundedK);
  const relevantInTop = top.filter((item) => relevantIds.has(item.id)).length;
  const firstRelevant = items.findIndex((item) => relevantIds.has(item.id));
  return {
    precisionAtK: relevantInTop / boundedK,
    recallAtK: relevantIds.size ? relevantInTop / relevantIds.size : 0,
    reciprocalRank: firstRelevant >= 0 ? 1 / (firstRelevant + 1) : 0,
  };
}

export function compareLexicalWithHybrid(
  lexical: readonly SearchResult[],
  semantic: readonly SemanticSearchHit[],
  relevantIds: ReadonlySet<string>,
  k: number,
) {
  const hybrid = rankLensHybrid(lexical, semantic, Math.max(k, lexical.length)).map(
    (entry) => entry.item,
  );
  return {
    lexical: evaluateLensRanking(lexical, relevantIds, k),
    hybrid: evaluateLensRanking(hybrid, relevantIds, k),
    hybridItems: hybrid,
  };
}
