import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const preferences = readFileSync(new URL("../prisma/creator-tv.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20260829100000_creator_tv_v1/migration.sql", import.meta.url),
  "utf8",
);

describe("Task 10 Creator TV schema", () => {
  it("models per-TV include and priority/order preferences without manual schedule duplication", () => {
    expect(preferences).toContain("model CreatorTvVideoPreference {");
    expect(preferences).toContain("@@unique([tvChannelId, videoId])");
    expect(schema).toContain("tvPreferences      CreatorTvVideoPreference[]");
    expect(schema).toContain("videoPreferences  CreatorTvVideoPreference[]");
  });

  it("adds defensive range constraints and useful preference indexes", () => {
    expect(migration).toContain("CreatorTvVideoPreference_priority_check");
    expect(migration).toContain("CreatorTvVideoPreference_sortOrder_check");
    expect(migration).toContain(
      "CreatorTvVideoPreference_tvChannelId_included_priority_sortOrder_idx",
    );
  });
});
