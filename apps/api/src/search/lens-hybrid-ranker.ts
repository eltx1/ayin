import type { SearchResult } from "./search.service.js";

export interface SemanticSearchHit {
  item: SearchResult;
  semanticScore: number;
  productScore: number;
}

export interface LensHybridComponents {
  lexical: number;
  semantic: number;
  product: number;
}

export interface LensHybridRankedItem {
  item: SearchResult;
  score: number;
  components: LensHybridComponents;
}

export const LENS_HYBRID_RANKING_VERSION = "ayin-lens-hybrid-v1";

const lexicalWeight = 0.55;
const semanticWeight = 0.35;
const productWeight = 0.1;

export function rankLensHybrid(
  lexical: readonly SearchResult[],
  semantic: readonly SemanticSearchHit[],
  limit: number,
): LensHybridRankedItem[] {
  const lexicalByKey = new Map(
    lexical.map((item, index) => [resultKey(item), { item, index }] as const),
  );
  const semanticByKey = new Map(semantic.map((hit) => [resultKey(hit.item), hit] as const));
  const keys = new Set([...lexicalByKey.keys(), ...semanticByKey.keys()]);
  const lexicalCount = Math.max(1, lexical.length);

  return [...keys]
    .map((key) => {
      const lexicalEntry = lexicalByKey.get(key);
      const semanticEntry = semanticByKey.get(key);
      const item = lexicalEntry?.item ?? semanticEntry?.item;
      if (!item) return null;
      const lexicalComponent = lexicalEntry
        ? lexicalWeight * lexicalRankScore(lexicalEntry.index, lexicalCount)
        : 0;
      const semanticComponent = semanticEntry
        ? semanticWeight * clamp01(semanticEntry.semanticScore)
        : 0;
      const productComponent = semanticEntry
        ? productWeight * clamp01(semanticEntry.productScore)
        : 0;
      return {
        item,
        score: round6(lexicalComponent + semanticComponent + productComponent),
        components: {
          lexical: round6(lexicalComponent),
          semantic: round6(semanticComponent),
          product: round6(productComponent),
        },
      } satisfies LensHybridRankedItem;
    })
    .filter((item): item is LensHybridRankedItem => item !== null)
    .toSorted(
      (a, b) =>
        b.score - a.score ||
        a.item.title.localeCompare(b.item.title) ||
        a.item.type.localeCompare(b.item.type) ||
        a.item.id.localeCompare(b.item.id),
    )
    .slice(0, Math.min(Math.max(limit, 1), 24));
}

function lexicalRankScore(index: number, count: number): number {
  if (count <= 1) return 1;
  const normalizedRank = index / (count - 1);
  return Math.max(0.2, 1 - normalizedRank * 0.8);
}

function resultKey(item: SearchResult): string {
  return `${item.type}:${item.id}`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
