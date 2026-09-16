import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const analytics = readFileSync(new URL("../prisma/analytics.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260916040000_recommendation_evaluation/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Task 66 recommendation evaluation schema", () => {
  it("stores versioned exposure outputs without private viewer identifiers", () => {
    expect(analytics).toContain("model RecommendationExposure {");
    expect(analytics).toContain("versionId   String");
    expect(analytics).toContain("algorithmId String");
    expect(analytics).toContain("itemIds     Json");
    expect(analytics).toContain("components  Json");

    const exposure = analytics.match(/model RecommendationExposure \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(exposure).not.toMatch(/profileId|profileHash|sessionHash|accountId|ipAddress|rawIp/i);
  });

  it("migrates the privacy-safe exposure log with version and surface indexes", () => {
    expect(migration).toContain('CREATE TABLE "RecommendationExposure"');
    expect(migration).toContain('"versionId" VARCHAR(120) NOT NULL');
    expect(migration).toContain('"components" JSONB NOT NULL');
    expect(migration).toContain('"RecommendationExposure_versionId_createdAt_idx"');
    expect(migration).not.toMatch(/profileId|profileHash|sessionHash|accountId|ipAddress|rawIp/i);
  });
});
