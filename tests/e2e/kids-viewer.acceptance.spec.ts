import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:3001";
const DB_HELPER = path.resolve(process.cwd(), "tests/e2e/db-helper.mjs");

function db<T>(command: string, payload: Record<string, unknown> = {}): T {
  return JSON.parse(
    execFileSync(process.execPath, [DB_HELPER, command, JSON.stringify(payload)], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
    }),
  ) as T;
}

test.beforeEach(() => {
  db("reset");
});

test("Kids viewer is friendly, localized and preserves fail-closed catalog filtering", async ({
  page,
}, testInfo) => {
  db("seed-kids-surface");

  const response = await page.request.get(`${API}/public/discovery/kids`);
  expect(response.ok()).toBe(true);
  const home = (await response.json()) as {
    policy: { mode: string; socialCommunity: { enabled: boolean } };
    rows: Array<{ items: Array<{ title: string; href: string }> }>;
  };
  const titles = home.rows.flatMap((row) => row.items.map((item) => item.title));
  expect(titles).toContain("Kids Discovery Fixture");
  expect(titles).not.toContain("Ordinary Discovery Fixture");
  expect(home.policy).toMatchObject({
    mode: "KIDS",
    socialCommunity: { enabled: false },
  });
  for (const row of home.rows) {
    for (const item of row.items) {
      expect(item.href).toContain("kids=1");
    }
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/kids?lang=en");
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 1, name: "A simpler place for younger viewers" }),
  ).toBeVisible();
  await expect(main.getByText("Kids Discovery Fixture", { exact: true })).toBeVisible();
  await expect(main.getByText("Ordinary Discovery Fixture", { exact: true })).toHaveCount(0);
  for (const developerCopy of [
    "Children's privacy compliance",
    "Personalized ad targeting",
    "backend policy",
    "age-restricted content",
  ]) {
    await expect(main.getByText(developerCopy, { exact: false })).toHaveCount(0);
  }
  await page.screenshot({
    path: testInfo.outputPath("design-kids-1440-en.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar/kids?lang=ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    main.getByRole("heading", { level: 1, name: "مساحة أبسط للمشاهدين الأصغر سنًا" }),
  ).toBeVisible();
  await expect(main.getByText("Kids Discovery Fixture", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("design-kids-390-ar.png"),
    fullPage: true,
  });
});
