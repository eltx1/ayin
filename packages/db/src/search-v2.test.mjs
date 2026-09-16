import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../prisma/migrations/20260916020000_search_v2/migration.sql", import.meta.url),
  "utf8",
);
const postgresSearch = readFileSync(
  new URL("../../../apps/api/src/search/search-postgres.service.ts", import.meta.url),
  "utf8",
);
const searchPage = readFileSync(
  new URL("../../../apps/web/src/app/(viewer)/search/page.tsx", import.meta.url),
  "utf8",
);

describe("Task 64 PostgreSQL search V2", () => {
  it("installs PostgreSQL-native prefix, trigram and FTS indexes", () => {
    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    expect(migration).toContain('"search_video_title_prefix_idx"');
    expect(migration).toContain('"search_video_title_trgm_idx"');
    expect(migration).toContain('"search_video_document_fts_idx"');
    expect(migration).toContain('"search_channel_name_trgm_idx"');
    expect(migration).toContain('"search_series_title_trgm_idx"');
    expect(migration).toContain('"search_movie_title_trgm_idx"');
    expect(migration).toContain('"search_video_metadata_tags_gin_idx"');
  });

  it("uses bounded parameterized prefix/trigram queries instead of leading-wildcard scans", () => {
    expect(postgresSearch).toContain("escapeLikePrefix");
    expect(postgresSearch).toContain("plainto_tsquery('simple'");
    expect(postgresSearch).toContain("similarity(lower(");
    expect(postgresSearch).toContain("LIMIT ${limit}");
    expect(postgresSearch).not.toMatch(/LIKE\s+['\"`]%/i);
    expect(postgresSearch).not.toMatch(/elasticsearch|opensearch|meilisearch/i);
  });

  it("keeps the public search page noindex policy", () => {
    expect(searchPage).toContain("robots: metadataRobots(false)");
  });
});
