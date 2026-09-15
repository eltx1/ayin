import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";

const CATALOG_SEED = path.resolve(process.cwd(), "tests/e2e/catalog-seed.mjs");

type CatalogSeed = {
  movieVideoSlug: string;
};

let catalog: CatalogSeed;

test.beforeAll(() => {
  const output = execFileSync(process.execPath, [CATALOG_SEED], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  catalog = JSON.parse(output) as CatalogSeed;
});

test("Arabic auth and search surfaces use RTL with localized viewer chrome", async ({ page }) => {
  await page.goto("/ar/login");

  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "تسجيل الدخول" })).toBeVisible();
  await expect(page.getByLabel("البريد الإلكتروني")).toBeVisible();
  await expect(page.getByLabel("كلمة المرور")).toBeVisible();
  await expect(page.getByRole("button", { name: "تسجيل الدخول" })).toBeVisible();

  await page.goto("/ar/search");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "البحث في AYIN" })).toBeVisible();
  await expect(page.getByLabel("البحث في AYIN")).toBeVisible();
  await expect(page.getByRole("button", { name: "بحث" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "التنقل الرئيسي" })).toBeVisible();
  await expect(page.getByRole("link", { name: "الرئيسية", exact: true })).toBeVisible();
});

test("Arabic watch page preserves mixed-content direction and LTR media semantics", async ({
  page,
}) => {
  await page.goto(`/ar/watch/${catalog.movieVideoSlug}`);

  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  const title = page.getByRole("heading", { name: "Catalog E2E Feature" });
  await expect(title).toBeVisible();
  await expect(title).toHaveAttribute("dir", "auto");

  const controls = page.locator('[aria-label="Playback controls"]');
  await expect(controls).toBeVisible();
  await expect(controls).toHaveCSS("direction", "ltr");

  await expect(page.getByRole("button", { name: "إعجاب" })).toBeVisible();
  await expect(page.getByRole("button", { name: "المشاهدة لاحقًا" })).toBeVisible();
  await expect(page.getByRole("button", { name: "مشاركة" })).toBeVisible();
});
