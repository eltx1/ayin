import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { enrollMfa } from "./mfa-helper.js";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
function db(command: string, payload: Record<string, unknown> = {}) {
  execFileSync(
    process.execPath,
    [path.resolve("tests/e2e/db-helper.mjs"), command, JSON.stringify(payload)],
    { env: process.env },
  );
}

test("failed artwork preserves real catalog links, dimensions and RTL across loading outcomes", async ({
  page,
}, testInfo) => {
  db("reset");
  execFileSync(process.execPath, [path.resolve("tests/e2e/directory-seed.mjs")], {
    env: process.env,
  });
  for (const view of [
    { width: 390, height: 844, locale: "ar" },
    { width: 1440, height: 1000, locale: "en" },
  ]) {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/^https?:\/\/media\.invalid\//, async (route) => {
      await gate;
      await route.fulfill({ status: 404, body: "Unavailable fixture artwork" });
    });
    await page.setViewportSize(view);
    await page.goto(`${view.locale === "ar" ? "/ar" : ""}/movies?lang=${view.locale}`, {
      waitUntil: "domcontentloaded",
    });
    const card = page.locator("main:visible ul > li > a").first();
    await expect(card).toBeVisible();
    const artwork = card.locator("[data-artwork-fallback]").locator("..");
    // Production CSP upgrades the HTTP fixture URL to HTTPS. Capture both
    // schemes without weakening CSP, and always release the held response.
    const before = await (async () => {
      try {
        await expect(artwork.locator("img")).toBeVisible();
        return await artwork.boundingBox();
      } finally {
        release();
      }
    })();
    await expect(artwork.locator("img")).toHaveCount(0);
    await expect(artwork.locator("[data-artwork-fallback]")).toBeVisible();
    const after = await artwork.boundingBox();
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after!.width).toBeCloseTo(before!.width, 1);
    expect(after!.height).toBeCloseTo(before!.height, 1);
    await expect(card).toHaveAttribute(
      "href",
      new RegExp(`${view.locale === "ar" ? "/ar" : ""}/movies/catalog-e2e-movie-`),
    );
    await expect(page.getByRole("main")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`design-artwork-failed-${view.width}-${view.locale}.png`),
      fullPage: true,
    });
    await page.unrouteAll({ behavior: "wait" });
    // A reload with genuinely available content must recover; no permanent URL/global failure cache.
    await page.route(/^https?:\/\/media\.invalid\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNIET0HAAIoAUh9ho5VAAAAAElFTkSuQmCC",
          "base64",
        ),
      }),
    );
    await page.reload();
    await expect(card.locator("img")).toHaveJSProperty("naturalWidth", 1);
    await expect(card).toBeVisible();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("shared creator fields and Admin counters retain actual workflows and accessible names", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  db("reset");
  const registration = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Design Foundations Creator",
      email: "design-foundations@e2e.ayin.test",
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBe(true);
  const identity = (await registration.json()) as { user: { account: { id: string } } };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/studio/playlists?lang=en");
  await expect(page.getByRole("main")).toHaveCount(1);
  const create = page.getByRole("button", { name: "Create playlist", exact: true });
  await expect(create).toBeDisabled();
  await page.getByLabel("Name", { exact: true }).fill("A real playlist from the design test");
  await page.getByLabel("Visibility", { exact: true }).selectOption("PRIVATE");
  await expect(create).toBeEnabled();
  const geometry = await create.boundingBox();
  expect(geometry!.height).toBeGreaterThanOrEqual(44);
  await create.click();
  await expect(
    page.getByRole("heading", { name: "A real playlist from the design test", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Playlist created.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("design-creator-fields-390.png"),
    fullPage: true,
  });
  await enrollMfa(page.request);
  db("grant-admin", { accountId: identity.user.account.id });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/admin?lang=en");
  await expect(
    page.getByRole("heading", { level: 1, name: "AYIN Admin", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Search AYIN administration", { exact: true })).toBeVisible();
  await expect(page.locator('dl[aria-label="Platform counters"] dt').first()).toBeVisible();
  await page.getByLabel("Search AYIN administration", { exact: true }).fill("design-foundations");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.locator('main a[href^="/admin/users"]').filter({ hasText: "Design Foundations Creator" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify session", exact: true })).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath("design-admin-overview-1440.png"),
    fullPage: true,
  });
});
