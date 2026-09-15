import { describe, expect, it, vi } from "vitest";

import { RecommendationService } from "./recommendation.service.js";

function settings() {
  const values: Record<string, unknown> = {
    recommendationsPersonalizedEnabled: true,
    recommendationWeightHistory: 30,
    recommendationWeightSubscriptions: 25,
    recommendationWeightLikes: 15,
    recommendationWeightPopularity: 10,
    recommendationWeightRecency: 10,
    recommendationWeightCompletion: 10,
  };
  return { get: vi.fn(async (key: string) => values[key]) };
}

const safeId = "11111111-1111-4111-8111-111111111111";
const matureId = "22222222-2222-4222-8222-222222222222";

function candidate(id: string, title: string) {
  return {
    id,
    slug: title.toLowerCase(),
    title,
    channelId: "33333333-3333-4333-8333-333333333333",
    publishedAt: new Date(),
    channel: { handle: "creator", name: "Creator" },
    mediaAssets: [],
    _count: { watchHistory: 0, reactions: 0 },
  };
}

describe("Kids recommendation boundaries", () => {
  it("filters recommendation and autoplay candidates through Kids eligibility and disables personalization", async () => {
    const database = {
      client: {
        viewerProfile: { findUnique: vi.fn(async () => ({ isKids: true })) },
        recommendationProfileState: { findUnique: vi.fn(async () => null) },
        subscription: { findMany: vi.fn(async () => []) },
        watchHistory: { findMany: vi.fn(async () => []) },
        reaction: { findMany: vi.fn(async () => []) },
        watchProgress: { findMany: vi.fn(async () => []) },
        recommendationFeedback: { findMany: vi.fn(async () => []) },
        video: {
          findMany: vi.fn(async () => [candidate(safeId, "Safe"), candidate(matureId, "Mature")]),
          findFirst: vi.fn(async () => null),
        },
      },
    };
    const videoPolicy = {
      filterAvailableVideoIds: vi.fn(
        async (_ids: string[], context: { isKidsProfile?: boolean }) => {
          expect(context.isKidsProfile).toBe(true);
          return new Set([safeId]);
        },
      ),
    };
    const service = new RecommendationService(
      database as never,
      settings() as never,
      videoPolicy as never,
    );

    const home = await service.getHomeRecommendations("profile");
    expect(home.mode).toBe("SAFE_FALLBACK");
    expect(home.items.map((item) => item.id)).toEqual([safeId]);

    const upNext = await service.getUpNext("source-video", "profile");
    expect(upNext.items.map((item) => item.id)).toEqual([safeId]);
  });

  it("returns no Creator TV suggestions for Kids profiles", async () => {
    const database = {
      client: {
        viewerProfile: { findUnique: vi.fn(async () => ({ isKids: true })) },
      },
    };
    const service = new RecommendationService(
      database as never,
      settings() as never,
      { filterAvailableVideoIds: vi.fn() } as never,
    );

    const result = await service.getTvSuggestions("profile");
    expect(result.mode).toBe("SAFE_FALLBACK");
    expect(result.items).toEqual([]);
  });
});
