import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const schemaUrl = new URL("../prisma/movie-catalog.prisma", import.meta.url);
const migrationUrl = new URL(
  "../prisma/migrations/20260915010000_movie_catalog/migration.sql",
  import.meta.url,
);

describe("movie catalog relational model", () => {
  it("relates catalog identity to existing Video and MediaAsset rows without copying media bytes", async () => {
    const [schema, migration] = await Promise.all([
      readFile(schemaUrl, "utf8"),
      readFile(migrationUrl, "utf8"),
    ]);

    expect(schema).toContain("model Movie {");
    expect(schema).toContain("primaryVideoId   String?");
    expect(schema).toContain("trailerVideoId   String?");
    expect(schema).toContain("mediaAssetId String");
    expect(migration).toContain('REFERENCES "Video"("id")');
    expect(migration).toContain('REFERENCES "MediaAsset"("id")');
    expect(migration).not.toMatch(/INSERT\s+INTO\s+"Movie"/i);
    expect(schema).not.toContain("r2ObjectKey");
    expect(schema).not.toContain("sizeBytes");
  });
});
