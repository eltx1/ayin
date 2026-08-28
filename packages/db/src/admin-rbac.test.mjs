import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const adminSchema = readFileSync(new URL("../prisma/admin-rbac.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20260828040000_admin_rbac/migration.sql", import.meta.url),
  "utf8",
);
const seed = readFileSync(new URL("../prisma/seed.sql", import.meta.url), "utf8");

describe("Task 04 database foundation", () => {
  it("stores extensible platform-admin role assignments independently from channel roles", () => {
    expect(adminSchema).toContain("model AdminRoleAssignment {");
    expect(adminSchema).toContain("@@unique([accountId, role])");
    expect(migration).toContain("AdminRoleAssignment_accountId_fkey");
    expect(migration).toContain("AdminRoleAssignment_role_format_check");
  });

  it("seeds safe typed defaults without provider secrets", () => {
    for (const key of [
      "registrationEnabled",
      "automaticCreatorProvisioningEnabled",
      "uploadsPlaylistName",
      "creatorTvNameTemplate",
      "autoAddPublishedUploadsToCreatorTv",
      "defaultVideoVisibility",
      "defaultCommentsEnabled",
      "defaultMonetizationAdEligibility",
      "uploadMaxSizeBytes",
      "initialMediaCompatibilityProfileText",
      "defaultCreatorRevenueShareBps",
      "moderationDefaultMode",
      "maintenanceMode",
    ]) {
      expect(seed).toContain(`'${key}'`);
    }
    expect(seed.toLowerCase()).not.toMatch(/api[_-]?key|secret|password|access[_-]?token/);
  });
});
