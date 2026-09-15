import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

async function text(path: string) {
  return readFile(`${root}${path}`, "utf8");
}

describe("Kids catalog schema", () => {
  it("stores explicit Kids eligibility as fail-closed classification without backfilling uploads", async () => {
    const schema = await text("prisma/video-policy.prisma");
    const migration = await text("prisma/migrations/20260915020000_kids_catalog/migration.sql");

    expect(schema).toContain("kidsEligible       Boolean             @default(false)");
    expect(schema).toContain("@@index([kidsEligible, maturityLevel, ageRestriction])");
    expect(migration).toContain('ADD COLUMN "kidsEligible" BOOLEAN NOT NULL DEFAULT false');
    expect(migration).not.toMatch(/UPDATE\s+"VideoPolicy"[\s\S]*kidsEligible[\s\S]*true/i);
    expect(migration).not.toMatch(/INSERT\s+INTO\s+"VideoPolicy"/i);
  });
});
