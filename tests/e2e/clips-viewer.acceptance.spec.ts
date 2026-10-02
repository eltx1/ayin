import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
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

test.use({ serviceWorkers: "block" });

test.beforeEach(() => {
  db("reset");
});

test("Clips paginate real rows and recover uncertain social writes in EN/AR", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const registration = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Clips viewer",
      email: "clips-viewer@e2e.ayin.test",
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBe(true);

  const fixture = db<{
    channelId: string;
    handle: string;
    firstVideoId: string;
    items: Array<{ id: string; slug: string; title: string }>;
  }>("seed-clips-viewer");

  const invalid = await page.request.get(`${WEB}/api/clips?cursor=invalid`);
  expect(invalid.status()).toBe(400);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/clips?lang=en");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "AYIN Clips" })).toBeVisible();
  await expect(main.getByRole("article")).toHaveCount(20);
  await expect(main.getByText("Clip 01", { exact: true })).toBeVisible();
  await expect(main.locator('a[href*="#comments"]')).toHaveCount(0);
  await expect(main.getByText("Ad opportunity", { exact: true })).toHaveCount(0);

  const like = main.getByRole("button", { name: /^Like ·/ });
  await expect(like).toBeVisible();

  let likeWrites = 0;
  const likeUrl = `${API}/social/videos/${fixture.firstVideoId}/reaction`;
  await page.route(likeUrl, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    likeWrites += 1;
    await route.abort("failed");
  });
  await like.click();
  await expect(main.getByText(/could not confirm that change/i)).toBeVisible();
  expect(likeWrites).toBe(1);
  await page.unroute(likeUrl);

  await main.getByRole("button", { name: "Refresh actions", exact: true }).click();
  await expect(main.getByRole("button", { name: /^Like ·/ })).toBeVisible();
  await main.getByRole("button", { name: /^Like ·/ }).click();
  await expect(main.getByRole("button", { name: /^Liked ·/ })).toBeVisible();

  let subscriptionWrites = 0;
  const subscriptionUrl = `${API}/social/channels/${fixture.channelId}/subscription`;
  await page.route(subscriptionUrl, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    subscriptionWrites += 1;
    await route.abort("failed");
  });
  await main.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(main.getByText(/could not confirm that change/i)).toBeVisible();
  expect(subscriptionWrites).toBe(1);
  await page.unroute(subscriptionUrl);

  await main.getByRole("button", { name: "Refresh actions", exact: true }).click();
  await expect(main.getByRole("button", { name: "Subscribe", exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(main.getByRole("button", { name: "Subscribed", exact: true })).toBeVisible();

  expect(
    db<{ reactions: number; subscriptions: number }>("social-counts", {
      videoId: fixture.firstVideoId,
      channelId: fixture.channelId,
    }),
  ).toMatchObject({ reactions: 1, subscriptions: 1 });

  await main.getByRole("button", { name: "Load more Clips", exact: true }).click();
  await expect(main.getByRole("article")).toHaveCount(22);
  await expect(main.getByRole("button", { name: "Load more Clips", exact: true })).toHaveCount(0);

  await page.screenshot({
    path: testInfo.outputPath("design-clips-1440-en.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar/clips?lang=ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(main.getByRole("heading", { level: 1, name: "مقاطع AYIN" })).toBeVisible();
  await expect(main.getByRole("article")).toHaveCount(20);
  await expect(main.getByRole("button", { name: /^تم الإعجاب ·/ })).toBeVisible();
  await expect(main.getByRole("button", { name: "مشترك", exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("design-clips-390-ar.png"),
    fullPage: true,
  });
});
