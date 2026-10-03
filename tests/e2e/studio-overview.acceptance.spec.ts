import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
    throw new Error("Requires local ayin_e2e database");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
test("Studio overview recovers failures, displays real counters and keeps Arabic workflow links", async ({
  page,
}, testInfo) => {
  const registration = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: {
      name: "Studio Overview Creator",
      email: "studio-overview@e2e.ayin.test",
      password: "strong-pass-123",
    },
  });
  expect(registration.ok()).toBe(true);
  const identity = await registration.json();
  let mode: "failed" | "real" | "malformed" = "failed";
  await page.route(`${API}/creator/studio/overview`, async (route) => {
    if (mode === "failed") return route.fulfill({ status: 503, body: "{}" });
    if (mode === "malformed") {
      const response = await route.fetch();
      const snapshot = await response.json();
      return route.fulfill({
        response,
        json: { ...snapshot, counters: { ...snapshot.counters, videos: -1 } },
      });
    }
    return route.continue();
  });
  await page.goto("/studio?lang=en");
  const main = page.getByRole("main");
  await expect(main.getByRole("alert")).toContainText("Studio could not be loaded.");
  await expect(main.getByRole("link", { name: "Quick upload" })).toHaveAttribute("href", "/upload");
  mode = "real";
  await main.getByRole("button", { name: "Try again" }).click();
  await expect(main.getByText("No uploads yet. Share your first video.")).toBeVisible();
  for (let index = 0; index < 2; index++) {
    const response = await page.request.post(`${API}/creator/videos/drafts`, {
      headers: { origin: WEB },
      data: {
        channelId: identity.user.channel.id,
        title: `Overview upload ${index}`,
        sizeBytes: 1024 * 1024,
        mimeType: "video/mp4",
        durationMs: 60_000,
      },
    });
    expect(response.ok()).toBe(true);
  }
  await main.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(main.getByText("Overview upload 1", { exact: true })).toBeVisible();
  await expect(
    main
      .locator('dl[aria-label="Channel counters"] > div')
      .filter({ has: page.locator("dt", { hasText: /^Videos$/ }) })
      .locator("dd"),
  ).toHaveText("2");
  await expect(main.getByRole("heading", { level: 1 })).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath("design-studio-overview-1440-en.png"),
    fullPage: true,
  });
  mode = "malformed";
  await main.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("Studio could not be loaded.");
  await expect(main.getByText("No uploads yet. Share your first video.")).toHaveCount(0);
  mode = "real";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar/studio");
  await expect(main.getByText("أحدث الفيديوهات", { exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "رفع سريع" })).toHaveAttribute("href", "/ar/upload");
  await expect(main.getByRole("link", { name: "إدارة المحتوى" })).toHaveAttribute(
    "href",
    "/ar/studio/content",
  );
  await main.locator("summary").filter({ hasText: "أدوات إضافية للقناة" }).click();
  await expect(main.getByRole("link", { name: "تلفزيون المنشئ" })).toHaveAttribute(
    "href",
    "/ar/studio/tv",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("design-studio-overview-390-ar.png"),
    fullPage: true,
  });
});
