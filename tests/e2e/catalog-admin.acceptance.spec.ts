import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";

const CATALOG_SEED = path.resolve(process.cwd(), "tests/e2e/catalog-seed.mjs");

type CatalogSeed = {
  movieSlug: string;
  seriesSlug: string;
  movieVideoSlug: string;
  trailerVideoSlug: string;
  episodeVideoSlug: string;
};

function seedCatalog(): CatalogSeed {
  const output = execFileSync(process.execPath, [CATALOG_SEED], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  return JSON.parse(output) as CatalogSeed;
}

test("Task 58 published Movie and Series reach the public catalog experience", async ({ page }) => {
  const catalog = seedCatalog();

  await test.step("published Movie exposes playable feature and trailer", async () => {
    await page.goto(`/movies/${catalog.movieSlug}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Catalog E2E Published Movie" }),
    ).toBeVisible();
    await expect(page.getByText("E2E Drama")).toBeVisible();
    await expect(page.getByRole("link", { name: "Watch movie" })).toHaveAttribute(
      "href",
      `/watch/${catalog.movieVideoSlug}`,
    );
    await expect(page.getByRole("link", { name: "Watch trailer" })).toHaveAttribute(
      "href",
      `/watch/${catalog.trailerVideoSlug}`,
    );
  });

  await test.step("published Series exposes ordered Season and playable Episode", async () => {
    await page.goto(`/series/${catalog.seriesSlug}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Catalog E2E Published Series" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Launch Season" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("heading", { level: 3, name: "Pilot" })).toBeVisible();
    await expect(page.getByText("E2E Technology")).toBeVisible();
    await expect(page.getByRole("link", { name: "Start watching" })).toHaveAttribute(
      "href",
      `/watch/${catalog.episodeVideoSlug}`,
    );
    await expect(page.getByRole("link", { name: "Watch", exact: true })).toHaveAttribute(
      "href",
      `/watch/${catalog.episodeVideoSlug}`,
    );
  });
});
