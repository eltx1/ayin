import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const analytics = readFileSync(new URL("../prisma/analytics.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20260916010000_trending_engine/migration.sql", import.meta.url),
  "utf8",
);

describe("Task 63 trending engine schema", () => {
  it("stores explainable aggregate score snapshots without viewer identifiers", () => {
    expect(analytics).toContain("model TrendingScoreSnapshot {");
    expect(analytics).toContain("audienceCount Int");
    expect(analytics).toContain("components    Json");
    expect(analytics).toContain("@@unique([scopeKey, videoId])");

    const snapshot = analytics.match(/model TrendingScoreSnapshot \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(snapshot).not.toMatch(/sessionHash|profileHash|accountId|ipAddress|rawIp/i);
  });

  it("migrates only explainable aggregate score components", () => {
    expect(migration).toContain('CREATE TABLE "TrendingScoreSnapshot"');
    expect(migration).toContain('"components" JSONB NOT NULL');
    expect(migration).toContain('"audienceCount" INTEGER NOT NULL');
    expect(migration).toContain('"TrendingScoreSnapshot_scopeKey_videoId_key"');
    expect(migration).not.toMatch(/sessionHash|profileHash|accountId|ipAddress|rawIp/i);
  });
});
