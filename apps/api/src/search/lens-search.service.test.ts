import { describe, expect, it, vi } from "vitest";

import { LensSearchService } from "./lens-search.service.js";

const lexicalItem = {
  id: "lexical",
  type: "VIDEO" as const,
  title: "Exact title",
  href: "/watch/lexical",
  kicker: "Video",
  meta: "Creator",
  artworkObjectKey: null,
};

function build(
  input: {
    enabled?: boolean;
    killSwitch?: boolean;
    configured?: boolean;
    semanticError?: boolean;
  } = {},
) {
  const search = {
    search: vi.fn(async () => ({
      query: "deep space",
      items: [lexicalItem],
      nextCursor: null,
      emptyMessage: null,
    })),
  };
  const settings = { get: vi.fn(async () => input.enabled ?? false) };
  const embeddings = {
    providerConfigured: vi.fn(() => input.configured ?? false),
    providerInfo: vi.fn(() => ({
      providerKey: "test",
      model: "fixture",
      modelVersion: "v1",
      dimensions: 3,
    })),
    semanticCandidates: input.semanticError
      ? vi.fn(async () => {
          throw new Error("provider down");
        })
      : vi.fn(async () => [{ id: "semantic", type: "VIDEO", slug: "semantic", similarity: 0.96 }]),
  };
  const hydrator = {
    hydrate: vi.fn(async () => [
      {
        item: {
          id: "semantic",
          type: "VIDEO" as const,
          title: "Orbital Survival",
          href: "/watch/semantic",
          kicker: "Video",
          meta: "Creator",
          artworkObjectKey: null,
        },
        semanticScore: 0.96,
        productScore: 0.7,
      },
    ]),
  };
  const runtime = {
    snapshot: vi.fn(() => ({
      killSwitch: input.killSwitch ?? true,
      maxProviderCallsPerMinute: 30,
      providerBatchSize: 16,
      maxRefreshItems: 48,
      refreshStaleHours: 168,
      maxVectorScan: 750,
      maxSemanticCandidates: 48,
      minSimilarity: 0.3,
      maxEmbeddingTextChars: 2400,
    })),
  };
  return {
    service: new LensSearchService(
      search as never,
      settings as never,
      embeddings as never,
      hydrator as never,
      runtime as never,
    ),
    search,
    embeddings,
    hydrator,
  };
}

describe("LensSearchService", () => {
  it("always preserves lexical Search V2 when the semantic feature is disabled", async () => {
    const { service, search, embeddings } = build({
      enabled: false,
      killSwitch: false,
      configured: true,
    });
    const result = await service.searchLens("deep space");
    expect(search.search).toHaveBeenCalledTimes(1);
    expect(embeddings.semanticCandidates).not.toHaveBeenCalled();
    expect(result.mode).toBe("LEXICAL_FALLBACK");
    expect(result.items).toEqual([lexicalItem]);
  });

  it("uses the independent kill switch before any provider call", async () => {
    const { service, embeddings } = build({ enabled: true, killSwitch: true, configured: true });
    const result = await service.searchLens("deep space");
    expect(embeddings.semanticCandidates).not.toHaveBeenCalled();
    expect(result.mode).toBe("LEXICAL_FALLBACK");
    expect(result.fallbackReason).toBe("kill-switch");
  });

  it("does not fake semantic production results when no provider is configured", async () => {
    const { service, embeddings } = build({ enabled: true, killSwitch: false, configured: false });
    const result = await service.searchLens("deep space");
    expect(embeddings.semanticCandidates).not.toHaveBeenCalled();
    expect(result.mode).toBe("LEXICAL_FALLBACK");
    expect(result.fallbackReason).toBe("provider-unconfigured");
  });

  it("blends policy-hydrated semantic hits with lexical results when fully enabled", async () => {
    const { service, embeddings, hydrator } = build({
      enabled: true,
      killSwitch: false,
      configured: true,
    });
    const result = await service.searchLens("deep space", 12, { countryCode: "US" });
    expect(embeddings.semanticCandidates).toHaveBeenCalledWith("deep space");
    expect(hydrator.hydrate).toHaveBeenCalledWith(expect.any(Array), { countryCode: "US" });
    expect(result.mode).toBe("HYBRID");
    expect(result.rankingVersion).toBe("ayin-lens-hybrid-v1");
    expect(result.items.map((item) => item.id)).toContain("semantic");
  });

  it("fails open to lexical search when semantic retrieval is unavailable", async () => {
    const { service } = build({
      enabled: true,
      killSwitch: false,
      configured: true,
      semanticError: true,
    });
    const result = await service.searchLens("deep space");
    expect(result.mode).toBe("LEXICAL_FALLBACK");
    expect(result.fallbackReason).toBe("semantic-unavailable");
    expect(result.items).toEqual([lexicalItem]);
  });
});
