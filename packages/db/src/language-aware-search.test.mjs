import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260916030000_language_aware_search/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const languageSearch = readFileSync(
  new URL(
    "../../../apps/api/src/search/language-aware-postgres-search.service.ts",
    import.meta.url,
  ),
  "utf8",
);

describe("Task 65 language-aware search", () => {
  it("adds English stemming and conservative Arabic normalized indexes", () => {
    expect(migration).toContain("to_tsvector('english'");
    expect(migration).toContain("ayin_arabic_search_normalize");
    expect(migration).toContain('"search65_video_english_fts_idx"');
    expect(migration).toContain('"search65_video_ar_title_prefix_idx"');
    expect(migration).toContain('"search65_series_localization_english_fts_idx"');
    expect(migration).toContain('"search65_movie_localization_ar_fts_idx"');
    expect(migration).toContain("'أإآٱىـًٌٍَُِّْٰ', 'ااااي'");
    expect(migration).not.toContain("ةه");
  });

  it("keeps language-aware search PostgreSQL-local and bounded", () => {
    expect(languageSearch).toContain("$queryRaw");
    expect(languageSearch).toContain("LIMIT ${limit}");
    expect(languageSearch).toContain("primaryLanguage");
    expect(languageSearch).toContain("originalLanguage");
    expect(languageSearch).toContain("SeriesLocalization");
    expect(languageSearch).toContain("MovieLocalization");
    expect(languageSearch).not.toMatch(
      /openai|anthropic|gemini|embedding|fetch\(|axios|third-party/i,
    );
  });
});
