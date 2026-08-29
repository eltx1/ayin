import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const discovery = readFileSync(new URL("../prisma/discovery.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20260829120000_discovery_home_rows/migration.sql", import.meta.url),
  "utf8",
);
const seed = readFileSync(new URL("../prisma/seed.sql", import.meta.url), "utf8");

describe("Task 12 discovery schema", () => {
  it("models ordered admin-configurable home rows and manual merchandising", () => {
    expect(discovery).toContain("model HomeRowConfig {");
    expect(discovery).toContain("source                        HomeRowSource");
    expect(discovery).toContain("manualItems HomeRowManualItem[]");
    expect(discovery).toContain("enum HomeManualItemType {");
    expect(migration).toContain("HomeRowConfig_maxItems_check");
  });

  it("seeds a global neutral default set without fake catalog content", () => {
    expect(seed).toContain("'trending-worldwide', 'Trending Worldwide'");
    expect(seed).toContain("'new-on-ayin', 'New on AYIN'");
    expect(seed).toContain("'creator-tv', 'Creator TV'");
    expect(seed).toContain("'editor-picks', 'Editor Picks'");
    expect(seed).not.toContain("Egypt");
  });
});
