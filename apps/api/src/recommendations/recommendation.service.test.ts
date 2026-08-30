import { describe, expect, it, vi } from "vitest";

import { RecommendationService } from "./recommendation.service.js";

function settings(values: Partial<Record<string, unknown>> = {}) {
  const defaults: Record<string, unknown> = {
    recommendationsPersonalizedEnabled: true,
    recommendationWeightHistory: 30,
    recommendationWeightSubscriptions: 25,
    recommendationWeightLikes: 15,
    recommendationWeightPopularity: 10,
    recommendationWeightRecency: 10,
    recommendationWeightCompletion: 10,
  };
  return { get: vi.fn(async (key: string) => values[key] ?? defaults[key]) };
}

describe("RecommendationService", () => {
  it("uses safe fallback ordering for a profile without personal signals", async () => {
    const database = {
      client: {
        recommendationProfileState: { findUnique: vi.fn(async () => null) },
        subscription: { findMany: vi.fn(async () => []) },
        watchHistory: { findMany: vi.fn(async () => []) },
        reaction: { findMany: vi.fn(async () => []) },
        watchProgress: { findMany: vi.fn(async () => []) },
        recommendationFeedback: { findMany: vi.fn(async () => []) },
        video: {
          findMany: vi.fn(async () => [
            {
              id: "11111111-1111-4111-8111-111111111111",
              slug: "recent",
              title: "Recent",
              channelId: "21111111-1111-4111-8111-111111111111",
              publishedAt: new Date(),
              channel: { handle: "recent", name: "Recent" },
              mediaAssets: [],
              _count: { watchHistory: 0, reactions: 0 },
            },
          ]),
          findFirst: vi.fn(async () => null),
        },
      },
    };
    const service = new RecommendationService(database as never, settings() as never);
    const result = await service.getHomeRecommendations("31111111-1111-4111-8111-111111111111");
    expect(result.mode).toBe("SAFE_FALLBACK");
    expect(result.items[0]?.reason.code).toBe("SAFE_FALLBACK");
  });

  it("excludes videos marked not interested", async () => {
    const excluded = "11111111-1111-4111-8111-111111111111";
    const database = {
      client: {
        recommendationProfileState: { findUnique: vi.fn(async () => null) },
        subscription: {
          findMany: vi.fn(async () => [{ channelId: "21111111-1111-4111-8111-111111111111" }]),
        },
        watchHistory: { findMany: vi.fn(async () => []) },
        reaction: { findMany: vi.fn(async () => []) },
        watchProgress: { findMany: vi.fn(async () => []) },
        recommendationFeedback: { findMany: vi.fn(async () => [{ videoId: excluded }]) },
        video: {
          findMany: vi.fn(async () => [
            {
              id: excluded,
              slug: "excluded",
              title: "Excluded",
              channelId: "21111111-1111-4111-8111-111111111111",
              publishedAt: new Date(),
              channel: { handle: "creator", name: "Creator" },
              mediaAssets: [],
              _count: { watchHistory: 2, reactions: 2 },
            },
          ]),
          findFirst: vi.fn(async () => null),
        },
      },
    };
    const service = new RecommendationService(database as never, settings() as never);
    const result = await service.getHomeRecommendations("31111111-1111-4111-8111-111111111111");
    expect(result.items).toEqual([]);
  });
});
