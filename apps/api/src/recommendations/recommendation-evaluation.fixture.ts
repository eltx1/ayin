import type { RecommendationEvaluationFixture } from "./recommendation-evaluator.js";

export const recommendationEvaluationFixture: RecommendationEvaluationFixture = {
  fixtureId: "task66-fixed-v1",
  cases: [
    {
      caseId: "balanced-home",
      rankings: {
        baseline: ["a", "b", "c", "d"],
        balanced: ["a", "e", "c", "f"],
        "watch-only": ["a", "b", "g", "h"],
      },
      itemMetadata: {
        a: { creatorId: "creator-1", catalogKey: "MOVIE", topicKey: "drama", durationMs: 100_000 },
        b: { creatorId: "creator-1", catalogKey: "MOVIE", topicKey: "drama", durationMs: 100_000 },
        c: {
          creatorId: "creator-2",
          catalogKey: "CREATOR_VIDEO",
          topicKey: "science",
          durationMs: 100_000,
        },
        d: {
          creatorId: "creator-3",
          catalogKey: "DOCUMENTARY",
          topicKey: "history",
          durationMs: 100_000,
        },
        e: {
          creatorId: "creator-4",
          catalogKey: "DOCUMENTARY",
          topicKey: "nature",
          durationMs: 100_000,
        },
        f: {
          creatorId: "creator-5",
          catalogKey: "CREATOR_VIDEO",
          topicKey: "travel",
          durationMs: 100_000,
        },
        g: { creatorId: "creator-1", catalogKey: "MOVIE", topicKey: "drama", durationMs: 100_000 },
        h: { creatorId: "creator-1", catalogKey: "MOVIE", topicKey: "drama", durationMs: 100_000 },
      },
      outcomes: {
        a: { clicked: true, watchTimeMs: 95_000, completed: true },
        b: { clicked: true, watchTimeMs: 90_000, completed: true },
        c: { clicked: true, watchTimeMs: 72_000, completed: false },
        d: { watchTimeMs: 35_000, completed: false },
        e: { clicked: true, watchTimeMs: 80_000, completed: true },
        f: { clicked: true, watchTimeMs: 70_000, completed: false },
        g: { clicked: true, watchTimeMs: 100_000, completed: true },
        h: { clicked: true, watchTimeMs: 100_000, completed: true },
      },
      relevantVideoIds: ["a", "b", "c", "e", "f", "g", "h"],
      priorSeenVideoIds: ["a", "b"],
      recentRecommendationIds: ["b"],
    },
    {
      caseId: "novelty-and-repeat",
      rankings: {
        baseline: ["i", "j", "k", "l"],
        balanced: ["m", "j", "n", "l"],
        "watch-only": ["i", "j", "i", "j"],
      },
      itemMetadata: {
        i: { creatorId: "creator-6", catalogKey: "MOVIE", topicKey: "action", durationMs: 120_000 },
        j: { creatorId: "creator-6", catalogKey: "MOVIE", topicKey: "action", durationMs: 120_000 },
        k: {
          creatorId: "creator-7",
          catalogKey: "CREATOR_VIDEO",
          topicKey: "music",
          durationMs: 120_000,
        },
        l: {
          creatorId: "creator-8",
          catalogKey: "DOCUMENTARY",
          topicKey: "history",
          durationMs: 120_000,
        },
        m: {
          creatorId: "creator-9",
          catalogKey: "DOCUMENTARY",
          topicKey: "science",
          durationMs: 120_000,
        },
        n: {
          creatorId: "creator-10",
          catalogKey: "CREATOR_VIDEO",
          topicKey: "food",
          durationMs: 120_000,
        },
      },
      outcomes: {
        i: { clicked: true, watchTimeMs: 115_000, completed: true },
        j: { clicked: true, watchTimeMs: 110_000, completed: true },
        k: { watchTimeMs: 45_000, completed: false },
        l: { clicked: true, watchTimeMs: 70_000, completed: false },
        m: { clicked: true, watchTimeMs: 80_000, completed: false },
        n: { clicked: true, watchTimeMs: 75_000, completed: false },
      },
      relevantVideoIds: ["i", "j", "l", "m", "n"],
      priorSeenVideoIds: ["i", "j", "k"],
      recentRecommendationIds: ["i", "j"],
    },
  ],
};
