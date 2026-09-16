import { describe, expect, it, vi } from "vitest";

import { cosineSimilarity, LensEmbeddingIndexService } from "./lens-embedding-index.service.js";
import { DeterministicLensTestEmbeddingProvider } from "./lens-test-embedding.provider.js";

describe("LensEmbeddingIndexService", () => {
  it("uses deterministic test embeddings and ranks the bounded PostgreSQL cache by cosine similarity", async () => {
    const database = {
      client: {
        catalogSearchEmbedding: {
          count: vi.fn(async () => 2),
          findMany: vi.fn(async () => [
            {
              entityType: "VIDEO",
              entityId: "11111111-1111-4111-8111-111111111111",
              slug: "space",
              embedding: [1, 0, 0],
            },
            {
              entityType: "MOVIE",
              entityId: "22222222-2222-4222-8222-222222222222",
              slug: "ocean",
              embedding: [0, 1, 0],
            },
          ]),
        },
      },
    };
    const provider = new DeterministicLensTestEmbeddingProvider(
      new Map([["deep space", [1, 0, 0]]]),
    );
    const config = {
      snapshot: () => ({
        killSwitch: false,
        maxProviderCallsPerMinute: 30,
        providerBatchSize: 16,
        maxRefreshItems: 48,
        refreshStaleHours: 168,
        maxVectorScan: 100,
        maxSemanticCandidates: 12,
        minSimilarity: 0.2,
        maxEmbeddingTextChars: 2400,
      }),
    };
    const service = new LensEmbeddingIndexService(
      database as never,
      { filterAvailableVideoIds: vi.fn() } as never,
      provider,
      config as never,
    );

    const result = await service.semanticCandidates("deep space");

    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe("space");
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.purpose).toBe("QUERY");
  });

  it("has stable cosine similarity behavior for fixed vectors", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(-1);
  });
});
