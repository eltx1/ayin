import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { searchResultTypes } from "./search";

const searchExperience = readFileSync(
  new URL("../components/search/search-experience.tsx", import.meta.url),
  "utf8",
);
const detailLayout = readFileSync(
  new URL("../components/content/content-detail-layout.tsx", import.meta.url),
  "utf8",
);
const watchPage = readFileSync(
  new URL("../app/(viewer)/watch/[slug]/page.tsx", import.meta.url),
  "utf8",
);
const detailContracts = readFileSync(new URL("./content-detail.ts", import.meta.url), "utf8");

describe("Task 13 search and unified content detail surfaces", () => {
  it("searches only real entity types supported by the current schema", () => {
    expect(searchResultTypes).toEqual(["VIDEO", "CHANNEL", "PLAYLIST", "CREATOR_TV"]);
    expect(searchExperience).toContain("fetchSearchSuggestions");
    expect(searchExperience).toContain("}, 250)");
    expect(searchExperience).toContain("Load more");
    expect(searchExperience).toContain("No results for");
  });

  it("uses the unified content detail API while preserving AYIN Player", () => {
    expect(watchPage).toContain("/public/content/videos/");
    expect(watchPage).toContain("<AyinPlayer");
    expect(watchPage).toContain("<ContentDetailLayout");
  });

  it("keeps future detail kinds architectural while rendering honest reserved hooks", () => {
    expect(detailContracts).toContain('| "MOVIE"');
    expect(detailContracts).toContain('| "SERIES"');
    expect(detailLayout).toContain('data-action-hook="save"');
    expect(detailLayout).toContain('data-content-slot="comments"');
    expect(detailLayout).toContain('data-ad-placement-key="watch_below_player"');
    expect(detailLayout).toContain('data-ad-placement-key="content_detail"');
    expect(detailLayout).not.toContain("Google Ad");
  });
});
