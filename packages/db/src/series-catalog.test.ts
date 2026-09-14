import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const schemaUrl = new URL("../prisma/series-catalog.prisma", import.meta.url);
const migrationUrl = new URL(
  "../prisma/migrations/20260915020000_series_catalog/migration.sql",
  import.meta.url,
);

describe("series catalog relational model", () => {
  it("models Series → Season → Episode → Video with deterministic uniqueness", async () => {
    const [schema, migration] = await Promise.all([
      readFile(schemaUrl, "utf8"),
      readFile(migrationUrl, "utf8"),
    ]);

    expect(schema).toContain("model Series {");
    expect(schema).toContain("model SeriesSeason {");
    expect(schema).toContain("model SeriesEpisode {");
    expect(schema).toContain("@@unique([seriesId, seasonNumber])");
    expect(schema).toContain("@@unique([seasonId, episodeNumber])");
    expect(schema).toContain("@@index([seasonId, status, sortOrder, episodeNumber, id])");
    expect(migration).toContain('REFERENCES "Video"("id")');
    expect(migration).toContain('REFERENCES "MediaAsset"("id")');
    expect(migration).not.toMatch(/INSERT\s+INTO\s+"Series"/i);
    expect(schema).not.toContain("r2ObjectKey");
    expect(schema).not.toContain("sizeBytes");
  });
});
