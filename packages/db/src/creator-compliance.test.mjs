import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../prisma/migrations/20260918050000_creator_compliance/migration.sql", import.meta.url),
  "utf8",
);
const schema = readFileSync(new URL("../prisma/creator-finance.prisma", import.meta.url), "utf8");
const service = readFileSync(
  new URL("../../../apps/api/src/revenue/creator-compliance.service.ts", import.meta.url),
  "utf8",
);
const adapter = readFileSync(
  new URL("../../../apps/api/src/revenue/creator-compliance.adapter.ts", import.meta.url),
  "utf8",
);

describe("Task 71 creator compliance privacy invariants", () => {
  it("normalizes all three workflows to the requested status vocabulary", () => {
    for (const status of ["NOT_STARTED", "PENDING", "VERIFIED", "REQUIRES_ACTION", "REJECTED"]) {
      expect(migration).toContain(status);
    }
    expect(schema).toContain("payoutDestinationStatus");
  });

  it("does not add a tax ID or identity document vault", () => {
    expect(migration).not.toMatch(/taxId|taxIdentifier|documentNumber|passportNumber|documentUrl/i);
    expect(schema).not.toMatch(/taxId|taxIdentifier|documentNumber|passportNumber|documentUrl/i);
  });

  it("stores only an encrypted opaque compliance reference", () => {
    expect(schema).toContain("complianceReferenceEncrypted");
    expect(schema).not.toContain("complianceReference String");
  });

  it("keeps the default adapter disabled and requirement-free", () => {
    expect(adapter).toContain("productionEnabled: false");
    expect(adapter).toContain("identityRequired: false");
    expect(adapter).toContain("taxRequired: false");
    expect(adapter).toContain("payoutDestinationVerificationRequired: false");
  });

  it("does not put external profile references or action URLs into audit metadata", () => {
    expect(service).toContain("sensitiveReferenceLogged: false");
    const auditBlocks = [
      "creator.compliance_workflow_started",
      "creator.compliance_status_refreshed",
      "creator.compliance_status_overridden",
    ].map((action) => {
      const start = service.indexOf(`action: "${action}"`);
      expect(start).toBeGreaterThanOrEqual(0);
      const metadataStart = service.indexOf("metadata: {", start);
      expect(metadataStart).toBeGreaterThan(start);
      const metadataEnd = service.indexOf("\n          },", metadataStart);
      expect(metadataEnd).toBeGreaterThan(metadataStart);
      return service.slice(metadataStart, metadataEnd);
    });
    for (const block of auditBlocks) {
      expect(block).not.toMatch(/\bexternalProfileReference\s*:/u);
      expect(block).not.toMatch(/\bactionUrl\s*:/u);
    }
  });
});
