import { describe, expect, it } from "vitest";

import { compareLexicalWithHybrid } from "./lens-evaluation.js";
import { lensEvaluationFixture } from "./lens-evaluation.fixture.js";
import { rankLensHybrid } from "./lens-hybrid-ranker.js";

describe("AYIN Lens deterministic evaluation", () => {
  it("improves the fixed conceptual-relevance fixture without displacing the exact lexical result", () => {
    const comparison = compareLexicalWithHybrid(
      lensEvaluationFixture.lexical,
      lensEvaluationFixture.semantic,
      lensEvaluationFixture.relevantIds,
      3,
    );

    expect(comparison.hybrid.precisionAtK).toBeGreaterThan(comparison.lexical.precisionAtK);
    expect(comparison.hybrid.recallAtK).toBeGreaterThan(comparison.lexical.recallAtK);
    expect(comparison.hybridItems[0]?.id).toBe("exact");
    expect(comparison.hybridItems.slice(0, 3).map((item) => item.id)).toContain("semantic-related");
  });

  it("keeps ranking deterministic for identical fixed fixtures", () => {
    const first = rankLensHybrid(lensEvaluationFixture.lexical, lensEvaluationFixture.semantic, 4);
    const second = rankLensHybrid(lensEvaluationFixture.lexical, lensEvaluationFixture.semantic, 4);
    expect(second).toEqual(first);
  });
});
