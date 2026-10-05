import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { enrollMfa } from "./mfa-helper.js";

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

const navigation = [
  { key: "home", label: "Home", href: "/" },
  { key: "movies", label: "Movies", href: "/movies" },
  { key: "series", label: "Series", href: "/series" },
  { key: "tv", label: "TV", href: "/tv" },
  { key: "creators", label: "Creators", href: "/creators" },
  { key: "shorts", label: "Clips", href: "/shorts" },
  { key: "kids", label: "Kids", href: "/kids" },
  { key: "my-ayin", label: "My AYIN", href: "/my-ayin" },
  { key: "search", label: "Search", href: "/search" },
].map((item) => ({
  ...item,
  enabled: true,
  featureFlag: ["home", "search"].includes(item.key) ? null : `navigation.${item.key}`,
}));

async function navigationFixture(page: Page) {
  const state = {
    fail: false,
    flags: Object.fromEntries(
      navigation.flatMap((item) => (item.featureFlag ? [[item.featureFlag, true]] : [])),
    ),
    controls: {
      navigation: structuredClone(navigation),
      announcement: { enabled: false, text: "", href: null },
      deviceVisibility: { web: true, mobile: true, tv: true },
    },
    reads: { flags: 0, controls: 0 },
  };
  // The shared controls read carries the current session; match the API's credentialed CORS.
  const headers = {
    "access-control-allow-origin": WEB,
    "access-control-allow-credentials": "true",
  };
  await page.route(`${API}/platform/navigation`, async (route) => {
    state.reads.flags += 1;
    await route.fulfill({
      status: state.fail ? 503 : 200,
      headers,
      json: state.fail ? { message: "Fixture unavailable" } : { flags: state.flags },
    });
  });
  await page.route(`${API}/product-controls`, async (route) => {
    state.reads.controls += 1;
    await route.fulfill({
      status: state.fail ? 503 : 200,
      headers,
      json: state.fail ? { message: "Fixture unavailable" } : state.controls,
    });
  });
  return state;
}

async function noOverflow(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
}

test.beforeEach(() => db("reset"));

test("Browse and primary navigation share one configuration across responsive EN/AR layouts", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await navigationFixture(page);
  for (const viewport of [
    { width: 360, height: 800, locale: "en" },
    { width: 390, height: 844, locale: "ar" },
    { width: 768, height: 1024, locale: "en" },
    { width: 1440, height: 1000, locale: "en" },
    { width: 1920, height: 1080, locale: "en" },
  ]) {
    const prefix = viewport.locale === "ar" ? "/ar" : "";
    await page.setViewportSize(viewport);
    const before = { ...fixture.reads };
    await page.goto(`${prefix}/browse?lang=${viewport.locale}`);
    await expect(page.locator("main h1:visible")).toHaveText(
      viewport.locale === "ar" ? "استكشف AYIN" : "Explore AYIN",
    );
    const categories = page.locator("main nav");
    await expect(categories.getByRole("link")).toHaveCount(5);
    for (const destination of ["/movies", "/series", "/creators", "/clips", "/kids"]) {
      await expect(categories.locator(`a[href="${prefix}${destination}"]`)).toBeVisible();
    }
    const label =
      viewport.width <= 1100
        ? viewport.locale === "ar"
          ? "التنقل على الهاتف"
          : "Mobile navigation"
        : "Primary navigation";
    // Localized aria labels come from the product, not a second fixture translation map.
    const navigationRegion = page.getByRole("navigation", { name: label, exact: true });
    await expect(navigationRegion.getByRole("link")).toHaveCount(5);
    await expect(navigationRegion.locator(`a[href="${prefix}/browse"]`)).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(fixture.reads.flags - before.flags).toBe(1);
    expect(fixture.reads.controls - before.controls).toBe(1);
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`navigation-browse-${viewport.width}-${viewport.locale}.png`),
      fullPage: true,
    });
  }
  await page.locator("main nav a[href='/movies']").click();
  await expect(page).toHaveURL(/\/movies$/);
  await expect(page.locator("main h1:visible")).toHaveText("Movies");
  const primary = page.getByRole("navigation", { name: "Primary navigation", exact: true });
  await expect(primary.getByRole("link", { name: "Browse", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("configuration failures, disabled categories and long custom labels remain recoverable", async ({
  page,
}, testInfo) => {
  const fixture = await navigationFixture(page);
  fixture.fail = true;
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/browse?lang=en");
  await expect(page.locator("main:visible").getByRole("alert")).toContainText(
    "Browse is unavailable",
  );
  await expect(page.locator("main").getByRole("link", { name: "Search" })).toBeVisible();
  fixture.fail = false;
  fixture.flags["navigation.movies"] = false;
  fixture.controls.navigation.push({
    key: "community-special",
    label: "A".repeat(60),
    href: "/community",
    enabled: true,
    featureFlag: null,
  });
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator("main nav a[href='/community']")).toBeVisible();
  await expect(page.locator("main nav a[href='/movies']")).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("navigation-browse-recovery-long-title-360.png"),
    fullPage: true,
  });
  expect(fixture.reads).toEqual({ flags: 2, controls: 2 });
});

test("navigation dialog contains keyboard/remote focus and restores its trigger", async ({
  page,
}, testInfo) => {
  await navigationFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/browse?lang=en");
  await expect(page.locator("main nav a")).toHaveCount(5);
  const trigger = page.getByRole("button", { name: "Open menu", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  for (const key of ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath("navigation-menu-390.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  const before = page.url();
  const consumed = await page.evaluate(() => {
    const event = new CustomEvent("ayin:native-remote", {
      detail: { key: "BACK", platform: "webos" },
      cancelable: true,
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(consumed).toBe(true);
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(page.url()).toBe(before);
});

test("TV geometry keeps repeated semantic focus IDs distinct", async ({ page }) => {
  await navigationFixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/browse?lang=en");

  const links = page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link");
  await expect(links).toHaveCount(5);
  await links.nth(0).evaluate((element) => {
    element.dataset.tvFocusId = "duplicate-media";
    element.style.position = "fixed";
    element.style.left = "40px";
    element.style.top = "220px";
  });
  await links.nth(1).evaluate((element) => {
    element.dataset.tvFocusId = "duplicate-media";
    element.style.position = "fixed";
    element.style.left = "40px";
    element.style.top = "520px";
  });
  await links.nth(2).evaluate((element) => {
    element.dataset.tvFocusId = "target-top";
    element.style.position = "fixed";
    element.style.left = "320px";
    element.style.top = "220px";
  });
  await links.nth(3).evaluate((element) => {
    element.dataset.tvFocusId = "target-bottom";
    element.style.position = "fixed";
    element.style.left = "320px";
    element.style.top = "520px";
  });

  await links.nth(1).focus();
  await page.keyboard.press("ArrowRight");
  await expect(links.nth(3)).toBeFocused();

  const stored = await page.evaluate(() => window.sessionStorage.getItem("ayin:last-tv-focus"));
  expect(stored).not.toBe("duplicate-media");
});

test("Studio keeps direct upload and grouped paths while finance Admin stays server restricted", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const registration = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Navigation Finance Creator",
      email: "navigation-finance@e2e.ayin.test",
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBe(true);
  const identity = (await registration.json()) as { user: { account: { id: string } } };
  await enrollMfa(page.request);
  db("grant-operator-role", { accountId: identity.user.account.id, role: "FINANCE_MANAGER" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/studio?lang=en");
  const studio = page.getByRole("navigation", { name: "Creator Studio", exact: true });
  const content = studio.getByRole("button", { name: "Content", exact: true });
  await expect(content).toHaveAttribute("aria-expanded", "false");
  await content.click();
  await studio.locator("a[href='/studio/content']").click();
  await expect(studio.getByRole("button", { name: "Content", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(studio.locator("a[href='/studio/content']")).toHaveAttribute("aria-current", "page");
  await expect(page.locator("aside a[href='/upload']")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Current location" })).toContainText("Content");
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("navigation-studio-1440-en.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar/studio/content?lang=ar");
  await page.getByRole("button", { name: "فتح قائمة الاستوديو" }).click();
  const studioDialog = page.getByRole("dialog");
  await expect(studioDialog.locator("a[href='/ar/studio/content']")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("navigation-studio-390-ar.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/admin/revenue?lang=en");
  const admin = page.getByRole("navigation", { name: "AYIN administration", exact: true });
  await expect(admin.getByRole("link")).toHaveCount(3);
  for (const destination of ["/admin", "/admin/revenue", "/admin/operations"]) {
    await expect(admin.locator(`a[href='${destination}']`)).toBeVisible();
  }
  await expect(admin.locator("a[href='/admin/users']")).toHaveCount(0);
  const forbidden = await page.request.get(`${API}/admin/control/users`);
  expect(forbidden.status()).toBe(403);
  await expect(page.getByRole("button", { name: "Verify session", exact: true })).toHaveCount(1);
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("navigation-admin-finance-1440-en.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open Admin navigation" }).click();
  await expect(page.getByRole("dialog").getByRole("link")).toHaveCount(3);
  await page.screenshot({
    path: testInfo.outputPath("navigation-admin-finance-390-en.png"),
    fullPage: true,
  });
});
