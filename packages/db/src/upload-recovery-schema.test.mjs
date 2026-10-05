import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("dormant upload recovery schema", () => {
  it("adds bounded operational records without backfilling legacy uploads", () => {
    const sql = readFileSync(
      new URL(
        "../prisma/migrations/20261005190000_upload_recovery_foundation/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(sql).toContain('CREATE TABLE "MediaUploadSession"');
    expect(sql).toContain("ON DELETE SET NULL");
    expect(sql).toContain("AYIN_SHA256_CHUNKS_V1");
    expect(sql).toContain("53687091200");
    expect(sql).toContain("10000");
    expect(sql).not.toMatch(/INSERT\s+INTO/i);
    expect(sql).not.toMatch(/UPDATE\s+"(?:MediaAsset|Video|Account)"/i);
  });
});
