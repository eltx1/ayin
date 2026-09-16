import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(
  new URL("../prisma/search-embeddings.prisma", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../prisma/migrations/20260917010000_ayin_lens_embeddings/migration.sql", import.meta.url),
  "utf8",
);

describe("Task 67 AYIN Lens embedding storage", () => {
  it("tracks provider model version and content hash without viewer/profile identifiers", () => {
    expect(schema).toContain("model CatalogSearchEmbedding {");
    expect(schema).toContain("providerKey");
    expect(schema).toContain("modelVersion");
    expect(schema).toContain("embedding       Float[]");
    expect(schema).toContain("contentHash");
    expect(schema).toContain("@@unique([entityType, entityId, providerKey, model, modelVersion])");
    expect(schema).not.toMatch(/profileId|accountId|sessionHash|watchHistory|ipAddress|rawIp/i);
  });

  it("uses bounded PostgreSQL array storage and selective indexes without requiring pgvector", () => {
    expect(migration).toContain('"embedding" DOUBLE PRECISION[] NOT NULL');
    expect(migration).toContain("cardinality(\"embedding\") = \"dimensions\"");
    expect(migration).toContain(
      '"CatalogSearchEmbedding_provider_model_version_dimensions_embeddedAt_idx"',
    );
    expect(migration).not.toMatch(/CREATE EXTENSION.*vector|USING\s+(ivfflat|hnsw)/i);
  });
});
