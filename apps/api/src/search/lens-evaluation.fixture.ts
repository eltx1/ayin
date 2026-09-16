import type { SemanticSearchHit } from "./lens-hybrid-ranker.js";
import type { SearchResult } from "./search.service.js";

const result = (id: string, title: string): SearchResult => ({
  id,
  type: "VIDEO",
  title,
  href: `/watch/${id}`,
  kicker: "Video",
  meta: "Fixture creator",
  artworkObjectKey: null,
});

export const lensEvaluationFixture = {
  lexical: [
    result("exact", "Deep Space"),
    result("noise-a", "Space News"),
    result("noise-b", "Deep Sea"),
    result("noise-c", "Daily Update"),
  ],
  semantic: [
    {
      item: result("semantic-related", "Orbital Survival"),
      semanticScore: 0.96,
      productScore: 0.7,
    },
    {
      item: result("exact", "Deep Space"),
      semanticScore: 0.88,
      productScore: 0.4,
    },
  ] satisfies SemanticSearchHit[],
  relevantIds: new Set(["exact", "semantic-related"]),
} as const;
