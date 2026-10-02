import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
function db<T>(command: string, payload: Record<string, unknown> = {}): T {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/db-helper.mjs"), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  ) as T;
}
test.use({ serviceWorkers: "block" });
test.beforeEach(() => db("reset"));

test("Watch comments expose real pagination and recover a committed response loss without replay", async ({
  page,
}, testInfo) => {
  const email = "viewer-comments@e2e.ayin.test";
  expect(
    (
      await page.request.post(`${API}/auth/register`, {
        data: { name: "Comments viewer", email, password: "strong-pass-123" },
        headers: { origin: WEB },
      })
    ).ok(),
  ).toBe(true);
  const video = db<{ id: string; slug: string }>("seed-player-video");
  db("seed-viewer-comments", { videoId: video.id, email });
  const url = `${API}/comments/videos/${video.id}`;
  let failedRead = true;
  let writes = 0;
  await page.route(`${url}*`, async (route) => {
    if (route.request().method() === "GET" && failedRead)
      return route.fulfill({ status: 503, body: "{}" });
    return route.continue();
  });
  await page.goto(`/watch/${video.slug}?lang=en`);
  const main = page.getByRole("main");
  await main.locator("summary").filter({ hasText: "Comments" }).click();
  await expect(main.getByText("Comments could not be loaded.", { exact: true })).toBeVisible();
  await expect(main.getByText("Be the first to comment.", { exact: true })).toHaveCount(0);
  failedRead = false;
  await main.getByRole("button", { name: "Reload comments", exact: true }).click();
  await expect(main.getByText("Existing comment 1", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Load more comments", exact: true }).click();
  await expect(main.getByText("Existing comment 32", { exact: true })).toBeVisible();
  await page.route(url, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes += 1;
    const result = await route.fetch();
    expect(result.status()).toBe(201);
    await route.abort("failed");
  });
  const draft = main.getByRole("textbox", { name: "Join the conversation", exact: true });
  await draft.fill("A committed comment with a lost response");
  await main.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(main.getByText(/could not confirm whether your comment was posted/)).toBeVisible();
  await expect(draft).toHaveValue("A committed comment with a lost response");
  await expect(main.getByRole("button", { name: "Post comment", exact: true })).toBeDisabled();
  expect(writes).toBe(1);
  await main.getByRole("button", { name: "Refresh comments", exact: true }).click();
  await expect(
    main.getByText("A committed comment with a lost response", { exact: true }),
  ).toHaveCount(1);
  expect(writes).toBe(1);
  await page.screenshot({
    path: testInfo.outputPath("design-watch-comments-1440-en.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/ar/watch/${video.slug}?lang=ar`);
  await main.locator("summary").filter({ hasText: "التعليقات" }).click();
  await expect(main.getByLabel("شارك في الحوار", { exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: "نشر التعليق", exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("design-watch-comments-390-ar.png"),
    fullPage: true,
  });
});

test("Kids Watch preserves policy through the actual page and never requests general ads or social data", async ({
  page,
}, testInfo) => {
  const fixture = db<{ eligibleSlugs: string[]; ordinarySlug: string }>("seed-kids-surface");
  let adRequests = 0;
  let socialRequests = 0;
  page.on("request", (request) => {
    if (/\/ads\/(video|page)\//.test(request.url())) adRequests += 1;
    if (/\/(comments|social)\//.test(request.url())) socialRequests += 1;
  });
  await page.goto(`/watch/${fixture.eligibleSlugs[0]}?kids=1&lang=en`);
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 1, name: "Kids Discovery Fixture 01" }),
  ).toBeVisible();
  await expect(main.locator("summary").filter({ hasText: "Comments" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: /Like|Watch later|My list/i })).toHaveCount(0);
  await expect(main.locator('a[href^="/c/"]')).toHaveCount(0);
  for (const href of await main
    .locator('a[href*="/watch/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href"))))
    expect(href).toContain("kids=1");
  expect(adRequests).toBe(0);
  expect(socialRequests).toBe(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await page.screenshot({
    path: testInfo.outputPath("design-watch-kids-1440-en.png"),
    fullPage: true,
  });
  expect(
    (
      await page.request.get(`${API}/public/videos/${fixture.ordinarySlug}/playback?kids=1`)
    ).status(),
  ).toBe(404);
  await page.goto(`/watch/${fixture.ordinarySlug}?kids=1&lang=en`);
  await expect(page.getByRole("heading", { name: "Nothing here yet", exact: true })).toBeVisible();
  await expect(
    main.getByRole("heading", { level: 1, name: "Ordinary Discovery Fixture" }),
  ).toHaveCount(0);
  expect(adRequests).toBe(0);
  expect(socialRequests).toBe(0);
});
