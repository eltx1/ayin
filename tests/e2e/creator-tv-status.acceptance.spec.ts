import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
function reset() {
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
}
test("Creator TV reports real empty/unconfigured state, retries privately and enforces ownership", async ({
  page,
  browser,
}) => {
  reset();
  const registration = await page.request.post(`${API}/auth/register`, {
    data: { name: "TV creator", email: "tv-status@e2e.ayin.test", password: "strong-pass-123" },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBeTruthy();
  const user = (await registration.json()).user;
  const url = `${API}/creator/tv/${user.creatorTv.id}/linear/summary`;
  let reads = 0,
    writes = 0;
  page.on("request", (request) => {
    if (request.url() === url) reads++;
    if (request.url().includes("/linear") && request.method() !== "GET") writes++;
  });
  await page.goto("/studio/tv");
  const status = page.getByRole("region", { name: "Broadcast status", exact: true });
  await expect(status.getByText("Not configured", { exact: true })).toBeVisible();
  await expect(status.getByText("No eligible programs scheduled", { exact: true })).toBeVisible();
  expect(reads).toBe(1);
  expect(writes).toBe(0);
  const response = await page.request.get(url);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(await response.text()).not.toMatch(/providerResourceId|lastError|hlsUrl|objectKey/);
  const other = await browser.newContext();
  await other.request.post(`${API}/auth/register`, {
    data: { name: "Other TV", email: "tv-status-other@e2e.ayin.test", password: "strong-pass-123" },
    headers: { origin: WEB },
  });
  expect((await other.request.get(url)).status()).toBe(403);
  await other.close();
  await page.route(url, (route) => route.abort("failed"));
  await status.getByRole("button", { name: "Refresh broadcast status" }).click();
  await expect(status.getByRole("alert")).toBeVisible();
  await expect(status.getByText("Not configured", { exact: true })).not.toBeVisible();
  await page.unroute(url);
  await status.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(status.getByText("Not configured", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar/studio/tv");
  const arabic = page.getByRole("region", { name: "حالة بث القناة", exact: true });
  await expect(arabic.getByText("غير مُعدّ", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.context().clearCookies();
  await arabic.getByRole("button", { name: "تحديث حالة البث" }).click();
  await expect(arabic.getByRole("link", { name: "تسجيل الدخول", exact: true })).toBeVisible();
  await expect(arabic.getByText("غير مُعدّ", { exact: true })).not.toBeVisible();
  expect(writes).toBe(0);
});

test("Creator TV distinguishes schedule and output, showing loading without replaying mutations", async ({
  page,
}) => {
  reset();
  const registration = await page.request.post(`${API}/auth/register`, {
    data: { name: "TV output", email: "tv-output@e2e.ayin.test", password: "strong-pass-123" },
    headers: { origin: WEB },
  });
  const user = (await registration.json()).user;
  const url = `${API}/creator/tv/${user.creatorTv.id}/linear/summary`;
  // Synthetic state checks the UI contract, not a real configured provider.
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  await page.route(url, async (route) => {
    reads++;
    await pending;
    await route.fulfill({
      json: {
        tvChannelId: user.creatorTv.id,
        checkedAt: new Date().toISOString(),
        output: {
          configured: true,
          status: "READY",
          available: true,
          lastManifestAt: null,
          lastPlanGeneratedAt: null,
        },
        schedule: { generatedAt: new Date().toISOString(), programCount: 0 },
        fallback: { strategy: "PROGRESSIVE_MP4", enabled: true },
      },
    });
  });
  await page.goto("/studio/tv");
  const status = page.getByRole("region", { name: "Broadcast status", exact: true });
  await expect(status.getByRole("status")).toHaveText("Checking broadcast status…");
  await expect(status.getByRole("button", { name: "Refresh broadcast status" })).toBeDisabled();
  release();
  await expect(status.getByText("Output available", { exact: true })).toBeVisible();
  await expect(status.getByText("No eligible programs scheduled", { exact: true })).toBeVisible();
  await expect(status.getByText(/does not confirm uninterrupted playback/)).toBeVisible();
  expect(reads).toBe(1);
});
