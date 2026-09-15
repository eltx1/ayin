import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const discovery = readFileSync(new URL("../prisma/discovery.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20260829120000_discovery_home_rows/migration.sql", import.meta.url),
  "utf8",
);
const regionalMigration = readFileSync(
  new URL("../prisma/migrations/20260916003000_regional_discovery/migration.sql", import.meta.url),
  "utf8",
);
const seed = readFileSync(new URL("../prisma/seed.sql", import.meta.url), "utf8");

describe("Task 12 discovery schema", () => {
  it("models ordered admin-configurable home rows and manual merchandising", () => {
    expect(discovery).toContain("model HomeRowConfig {");
    expect(discovery).toContain("source                        HomeRowSource");
    expect(discovery).toMatch(/manualItems\s+HomeRowManualItem\[\]/);
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

describe("Task 62 regional discovery schema", () => {
  it("stores only coarse regional merchandising and privacy-safe aggregate inputs", () => {
    expect(discovery).toContain("enum RegionalDiscoverySignal {");
    expect(discovery).toContain("model HomeRowRegionTarget {");
    expect(discovery).toContain("model RegionalDiscoveryAggregate {");
    expect(discovery).toMatch(/regionTargets\s+HomeRowRegionTarget\[\]/);
    expect(discovery).toMatch(/cohortSize\s+Int/);

    const aggregateModel =
      discovery.match(/model RegionalDiscoveryAggregate \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(aggregateModel).not.toMatch(/accountId|profileId|ipAddress|rawIp/i);
  });

  it("migrates region targets and aggregate ranking inputs without viewer identifiers", () => {
    expect(regionalMigration).toContain('CREATE TABLE "HomeRowRegionTarget"');
    expect(regionalMigration).toContain('CREATE TABLE "RegionalDiscoveryAggregate"');
    expect(regionalMigration).toContain('"cohortSize" INTEGER NOT NULL');
    expect(regionalMigration).toContain(
      '"RegionalDiscoveryAggregate_regionCode_signal_entityKey_key"',
    );
    expect(regionalMigration).not.toMatch(/accountId|profileId|ipAddress|rawIp/i);
  });
});
