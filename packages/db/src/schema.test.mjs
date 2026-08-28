import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = [
  "../prisma/migrations/20260828010000_core_v1_schema/migration.sql",
  "../prisma/migrations/20260828010100_core_v1_relations/migration.sql",
  "../prisma/migrations/20260828010200_core_v1_indexes_constraints/migration.sql",
]
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .join("\n");

const requiredModels = [
  "Account",
  "ViewerProfile",
  "Channel",
  "ChannelMember",
  "ChannelSettings",
  "Video",
  "MediaAsset",
  "Playlist",
  "PlaylistItem",
  "CreatorTvChannel",
  "TvScheduleItem",
  "WatchProgress",
  "WatchHistory",
  "Subscription",
  "Reaction",
  "Comment",
  "Notification",
  "ContentRightsDeclaration",
  "Report",
  "ModerationCase",
  "PlatformSetting",
  "FeatureFlag",
  "AdminAuditLog",
  "AdPlacement",
  "Advertiser",
  "Campaign",
  "Creative",
  "AdEvent",
  "CreatorContract",
  "EarningsLedgerEntry",
  "Payout",
];

describe("Task 02 core Prisma schema", () => {
  it("contains every required durable model", () => {
    for (const model of requiredModels) {
      expect(schema).toContain(`model ${model} {`);
    }
  });

  it("models video lifecycle separately from visibility", () => {
    expect(schema).toMatch(
      /enum VideoStatus \{[\s\S]*DRAFT[\s\S]*UPLOADING[\s\S]*VALIDATING[\s\S]*SCHEDULED[\s\S]*PUBLISHED[\s\S]*REMOVED[\s\S]*\}/,
    );
    expect(schema).toMatch(
      /enum VideoVisibility \{[\s\S]*PUBLIC[\s\S]*UNLISTED[\s\S]*PRIVATE[\s\S]*\}/,
    );
  });

  it("supports the Task 03 provisioning transaction without implementing it", () => {
    expect(schema).toMatch(/role\s+ChannelMemberRole/);
    expect(schema).toMatch(/systemKey\s+PlaylistSystemKey\?/);
    expect(schema).toMatch(/isProtected\s+Boolean/);
    expect(schema).toMatch(/primaryTvChannelId\s+String\?\s+@unique\s+@db\.Uuid/);
    expect(schema).toMatch(/revenueShareBps\s+Int\?/);
  });

  it("stores only media metadata and R2 references, never video binary data", () => {
    expect(schema).not.toMatch(/\bBytes\b/);
    expect(migration).not.toMatch(/\bBYTEA\b/i);
    expect(schema).toContain("r2ObjectKey String");
  });

  it("commits database-level relational and operational constraints", () => {
    expect(migration).toContain("Reaction_exactly_one_target_check");
    expect(migration).toContain("Report_exactly_one_target_check");
    expect(migration).toContain("Playlist_system_playlist_protected_check");
    expect(migration).toContain("PlatformSetting_declared_type_check");
    expect(migration).toContain("AdPlacement_inventory_format_check");
    expect(migration).toContain("FeatureFlag_rolloutPercentage_check");
  });

  it("indexes the required hot access patterns", () => {
    expect(schema).toContain("@@index([channelId, status, publishedAt])");
    expect(schema).toContain("@@index([status, visibility, publishedAt])");
    expect(schema).toContain("@@index([videoId, status, createdAt])");
    expect(schema).toContain("@@index([channelId, createdAt])");
    expect(schema).toContain("@@index([profileId, lastWatchedAt])");
    expect(schema).toContain("@@index([tvChannelId, startsAt])");
  });
});
