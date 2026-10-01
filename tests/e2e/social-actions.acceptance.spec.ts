import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

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

async function register(page: Page) {
  const response = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Social recovery viewer",
      email: "social-recovery@e2e.ayin.test",
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  expect(response.ok()).toBe(true);
}

async function noOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
}

test.use({ serviceWorkers: "block" });
test.beforeEach(() => db("reset"));

test("subscription and video actions reconcile uncertain writes without blind replay", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await register(page);
  const video = db<{
    id: string;
    slug: string;
    channelId: string;
    sourceKey: string;
  }>("seed-player-video");
  const handle = video.slug.replace(/^hls-player-/, "hls-");

  let channelReadFails = true;
  await page.route(`${API}/social/channels/${video.channelId}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    if (channelReadFails) return route.abort("failed");
    return route.continue();
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/c/${handle}?lang=en`);
  const main = page.getByRole("main");
  await expect(
    main.getByText("Subscription status could not be loaded.", { exact: true }),
  ).toBeVisible();
  const subscriptionButton = main.getByRole("button", { name: /Retry subscription/ });
  await expect(subscriptionButton).toBeVisible();

  channelReadFails = false;
  await subscriptionButton.click();
  await expect(main.getByRole("button", { name: /Subscribe · 0/ })).toBeVisible();

  let subscriptionWrites = 0;
  const subscriptionUrl = `${API}/social/channels/${video.channelId}/subscription`;
  await page.route(subscriptionUrl, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    subscriptionWrites += 1;
    await route.fetch();
    await route.abort("failed");
  });

  await main.getByRole("button", { name: /Subscribe · 0/ }).click();
  await expect(main.getByText(/could not confirm that subscription change/i)).toBeVisible();
  expect(subscriptionWrites).toBe(1);

  await page.unroute(subscriptionUrl);
  await main.getByRole("button", { name: /Refresh subscription/ }).click();
  await expect(main.getByRole("button", { name: /Subscribed · 1/ })).toBeVisible();
  expect(subscriptionWrites).toBe(1);

  await page.screenshot({
    path: testInfo.outputPath("design-social-subscription-1440-en.png"),
    fullPage: true,
  });

  let videoReadFails = true;
  let videoReads = 0;
  await page.route(`${API}/social/videos/${video.id}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    videoReads += 1;
    if (videoReadFails) return route.abort("failed");
    return route.continue();
  });

  await page.goto(`/watch/${video.slug}?lang=en`);
  await expect.poll(() => videoReads).toBeGreaterThan(0);
  await expect(
    main.getByText("Your video actions could not be loaded.", { exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("button", { name: "Retry video actions", exact: true }),
  ).toBeVisible();

  videoReadFails = false;
  await main.getByRole("button", { name: "Retry video actions", exact: true }).click();
  const like = main.getByRole("button", { name: /Like · 0/ });
  await expect(like).toBeEnabled();

  await main.getByRole("button", { name: "Watch Later", exact: true }).click();
  await expect(main.getByRole("button", { name: "In Watch Later", exact: true })).toBeVisible();
  await main.getByRole("button", { name: "My List", exact: true }).click();
  await expect(main.getByRole("button", { name: "In My List", exact: true })).toBeVisible();

  let reactionWrites = 0;
  const reactionUrl = `${API}/social/videos/${video.id}/reaction`;
  await page.route(reactionUrl, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    reactionWrites += 1;
    await route.fetch();
    await route.abort("failed");
  });

  await like.click();
  await expect(main.getByText(/could not confirm that change/i)).toBeVisible();
  await expect(like).toBeDisabled();
  expect(reactionWrites).toBe(1);

  await page.unroute(reactionUrl);
  await main.getByRole("button", { name: "Refresh video actions", exact: true }).click();
  const reconciledLike = main.getByRole("button", { name: /Like · 1/ });
  await expect(reconciledLike).toHaveAttribute("aria-pressed", "true");
  await expect(main.getByRole("button", { name: "In Watch Later", exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: "In My List", exact: true })).toBeVisible();
  expect(reactionWrites).toBe(1);

  expect(
    db<{ reactions: number; subscriptions: number }>("social-counts", {
      channelId: video.channelId,
      videoId: video.id,
    }),
  ).toMatchObject({ reactions: 1, subscriptions: 1 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/ar/watch/${video.slug}?lang=ar`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(main.getByRole("button", { pressed: true, name: /إعجاب/ })).toBeVisible();
  await expect(
    main.getByRole("button", { name: "مضاف للمشاهدة لاحقًا", exact: true }),
  ).toBeVisible();
  await expect(main.getByRole("button", { name: "مضاف إلى قائمتي", exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("design-social-actions-390-ar.png"),
    fullPage: true,
  });
});
