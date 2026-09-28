import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { enrollMfa } from "./mfa-helper.js";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
const DB_HELPER = path.resolve(process.cwd(), "tests/e2e/db-helper.mjs");

function db<T>(command: string, payload: Record<string, unknown> = {}): T {
  const output = execFileSync(process.execPath, [DB_HELPER, command, JSON.stringify(payload)], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  return JSON.parse(output) as T;
}

async function expectNoDocumentOverflow(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toBeVisible();
  await page.evaluate(async () => {
    if ("fonts" in document) await document.fonts.ready;
  });
  await page.waitForLoadState("networkidle");
  // Sample settled dynamic content, not only the empty loading shell.
  for (let sample = 0; sample < 5; sample += 1) {
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(
      dimensions.scrollWidth,
      `${route} should keep horizontal scrolling inside local rails/tables instead of the document`,
    ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
    if (sample < 4) await page.waitForTimeout(150);
  }
}

test.beforeAll(() => {
  db("reset");
});

test("responsive viewer, account, Studio and Admin paths remain usable", async ({ page }) => {
  test.setTimeout(180_000);
  const registration = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Responsive Admin",
      email: "responsive-admin@e2e.ayin.test",
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBeTruthy();
  const identity = (await registration.json()) as {
    user: { account: { id: string; displayName: string }; channel: { handle: string } };
  };
  await enrollMfa(page.request);
  db("grant-admin", { accountId: identity.user.account.id });

  await test.step("phone layout preserves viewer and workspace journeys", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of [
      "/",
      "/browse",
      "/movies",
      "/search",
      "/upload",
      "/account",
      "/my-ayin",
      "/notifications",
      `/c/${identity.user.channel.handle}`,
      "/channel/edit",
      "/channel/playlists",
      "/channel/tv",
      "/studio",
      "/studio/content",
      "/studio/playlists",
      "/studio/tv",
      "/studio/analytics",
      "/studio/comments",
      "/studio/community",
      "/studio/live",
      "/studio/monetization",
      "/studio/support",
      "/studio/trust",
      "/studio/channel",
      "/admin",
      "/admin/users",
      "/admin/channels",
      "/admin/content",
      "/admin/videos",
      "/admin/operations",
      "/admin/product-controls",
      "/admin/settings",
      "/admin/revenue",
      "/admin/moderation",
      "/admin/trust",
      "/admin/tv",
      "/admin/video-ads",
    ]) {
      await expectNoDocumentOverflow(page, route);
    }
    await page.goto("/", { waitUntil: "networkidle" });
    const mobileNavigation = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(mobileNavigation).toBeVisible();
    for (const label of ["Home", "Search"]) {
      await expect(mobileNavigation.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    expect(await mobileNavigation.getByRole("link").count()).toBeLessThanOrEqual(5);
    await expect(page.locator("header a[href='/upload']")).toBeVisible();
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    const accountMenu = page.getByRole("navigation", { name: "Account navigation", exact: true });
    for (const label of ["Account", "Notifications", "My channel"]) {
      await expect(accountMenu.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    const creatorMenu = page.getByRole("navigation", { name: "Account and creator navigation" });
    for (const label of ["Create / Upload", "My videos", "Creator Studio"]) {
      await expect(creatorMenu.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await page.keyboard.press("Escape");

    await page.goto("/upload", { waitUntil: "networkidle" });
    const uploadTitle = page.getByRole("heading", {
      name: "Bring your next video to AYIN.",
      exact: true,
    });
    await expect(uploadTitle).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish video", exact: true })).toBeVisible();
    await expect(page.getByText("Skip Studio. Publish fast.", { exact: false })).toHaveCount(0);
    await expect(page.getByText(/Cloudflare R2/i)).toHaveCount(0);
    await expect(page.getByText(/direct-to-R2/i)).toHaveCount(0);
    await page.goto("/account", { waitUntil: "networkidle" });
    const accountTitle = page.getByRole("heading", { name: "Account", exact: true });
    await expect(accountTitle).toBeVisible();
    const accountContent = page.locator("main:visible");
    const accountName = accountContent.getByText(identity.user.account.displayName, {
      exact: true,
    });
    await expect(accountName).toBeVisible();
    await expect(page.getByRole("heading", { name: "Earnings & payouts" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Payment details" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Request payout" })).toBeVisible();
    await expect(page.getByText(/adapter/i)).toHaveCount(0);
    await expect(page.getByText(/Manual payout V1/i)).toHaveCount(0);

    await page.goto("/studio", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Open Studio navigation" }).click();
    const studio = page.getByRole("dialog").getByRole("navigation", { name: "Creator Studio" });
    await expect(studio).toBeVisible();
    await expect(studio.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await studio.getByRole("button", { name: "Audience & community" }).click();
    await expect(studio.getByRole("link", { name: "Analytics", exact: true })).toBeVisible();
    await expect(studio.locator("a[href='/studio/monetization']")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Verify session", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open Admin navigation" }).click();
    const admin = page.getByRole("dialog").getByRole("navigation", { name: "AYIN administration" });
    await expect(admin).toBeVisible();
    await expect(admin.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.keyboard.press("Escape");
  });

  await test.step("tablet layout preserves the same document-width invariant", async () => {
    await page.setViewportSize({ width: 768, height: 1024 });
    for (const route of [
      "/",
      "/search",
      "/upload",
      "/account",
      "/studio/analytics",
      "/studio/monetization",
      "/admin/revenue",
      "/admin/operations",
    ]) {
      await expectNoDocumentOverflow(page, route);
    }
  });

  await test.step("desktop keeps the same hierarchy without horizontal document overflow", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const route of [
      "/",
      "/search",
      "/upload",
      "/account",
      "/studio",
      "/studio/content",
      "/admin",
      "/admin/revenue",
      "/admin/operations",
    ]) {
      await expectNoDocumentOverflow(page, route);
    }
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeVisible();
  });
});
