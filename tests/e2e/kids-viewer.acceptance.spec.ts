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

test("Kids viewer is localized and keeps every discovery page fail-closed", async ({
  page,
}, testInfo) => {
  db("seed-kids-surface");

  const response = await page.request.get(`${API}/public/discovery/kids`);
  expect(response.ok()).toBe(true);
  const home = (await response.json()) as {
    policy: { mode: string; socialCommunity: { enabled: boolean } };
    rows: Array<{
      key: string;
      source: string;
      nextCursor: string | null;
      items: Array<{ title: string; href: string }>;
    }>;
  };
  const titles = home.rows.flatMap((row) => row.items.map((item) => item.title));
  expect(titles).toContain("Kids Discovery Fixture 01");
  expect(titles).not.toContain("Ordinary Discovery Fixture");
  expect(home.policy).toMatchObject({
    mode: "KIDS",
    socialCommunity: { enabled: false },
  });
  for (const row of home.rows) {
    for (const item of row.items) expect(item.href).toContain("kids=1");
  }

  const newRow = home.rows.find((row) => row.source === "NEW_ON_AYIN");
  expect(newRow?.nextCursor).toBeTruthy();
  const secondPage = await page.request.get(
    `${API}/public/discovery/kids/rows/${newRow!.key}?cursor=${newRow!.nextCursor}&limit=8`,
  );
  expect(secondPage.ok()).toBe(true);
  const secondPayload = (await secondPage.json()) as {
    items: Array<{ title: string; href: string }>;
  };
  expect(secondPayload.items.map((item) => item.title)).toContain("Kids Discovery Fixture 10");
  expect(secondPayload.items.map((item) => item.title)).not.toContain("Ordinary Discovery Fixture");
  expect(secondPayload.items.every((item) => item.href.includes("kids=1"))).toBe(true);

  await page.setViewportSize({ width: 1440, height: 1000 });
  let kidsRowReads = 0;
  page.on("request", (request) => {
    if (request.url().includes("/public/discovery/kids/rows/")) kidsRowReads += 1;
  });
  await page.goto("/kids?lang=en");
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 1, name: "A simpler place for younger viewers" }),
  ).toBeVisible();
  await expect(main.getByText("Kids Discovery Fixture 01", { exact: true }).first()).toBeVisible();
  await expect(main.getByText("Ordinary Discovery Fixture", { exact: true })).toHaveCount(0);
  await main.getByRole("button", { name: "Load more", exact: true }).first().click();
  await expect.poll(() => kidsRowReads).toBe(1);
  await expect(main.getByText("Kids Discovery Fixture 10", { exact: true }).first()).toBeVisible();
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
  await expect(main.getByRole("heading", { level: 2, name: "جديد على AYIN" })).toBeVisible();
  await expect(main.getByRole("heading", { level: 2, name: "أضيف حديثًا" })).toBeVisible();
  await expect(main.getByText("New on AYIN", { exact: true })).toHaveCount(0);
  await expect(main.getByText("Recently Added", { exact: true })).toHaveCount(0);
  await expect(main.getByText("Ordinary Discovery Fixture", { exact: true })).toHaveCount(0);
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
