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

async function register(page: Page, email: string) {
  const response = await page.request.post(`${API}/auth/register`, {
    data: { name: "My AYIN Viewer", email, password: "strong-pass-123" },
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

test.beforeEach(() => {
  db("reset");
});

test("My AYIN and Lens are localized, truthful and recover uncertain recommendation writes", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const email = "my-ayin-lens@e2e.ayin.test";
  await register(page, email);
  const fixture = db<{
    profileId: string;
    activityVideoId: string;
    activitySlug: string;
    recommendationVideoId: string;
    recommendationSlug: string;
    recommendationChannelId: string;
    recommendationHandle: string;
  }>("seed-my-ayin-lens", { email });

  let failLibrary = true;
  await page.route(`${API}/discovery/my-ayin`, async (route) => {
    if (route.request().method() !== "GET" || !failLibrary) return route.continue();
    await route.fulfill({
      status: 503,
      headers: {
        "access-control-allow-origin": WEB,
        "access-control-allow-credentials": "true",
      },
      json: { message: "Unavailable" },
    });
  });

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/my-ayin?lang=en");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "My AYIN" })).toBeVisible();
  await expect(
    main.getByRole("heading", { name: "Your library could not be loaded" }),
  ).toBeVisible();
  await expect(main.getByRole("heading", { name: "Sign in to open My AYIN" })).toHaveCount(0);

  failLibrary = false;
  await main.getByRole("button", { name: "Reload My AYIN", exact: true }).click();
  await expect(main.getByText("My AYIN Activity Fixture", { exact: true }).first()).toBeVisible();
  for (const title of [
    "Continue Watching",
    "My List",
    "Watch Later",
    "Watch History",
    "Liked Content",
    "Playlists",
  ]) {
    await expect(main.getByText(title, { exact: true }).first()).toBeVisible();
  }
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("design-my-ayin-1440-en.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar/my-ayin?lang=ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(main.getByRole("heading", { level: 1, name: "مكتبتي على AYIN" })).toBeVisible();
  for (const title of ["متابعة المشاهدة", "قائمتي", "المشاهدة لاحقًا", "سجل المشاهدة"]) {
    await expect(main.getByText(title, { exact: true }).first()).toBeVisible();
  }
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("design-my-ayin-390-ar.png"),
    fullPage: true,
  });

  let failLens = true;
  await page.route(`${API}/recommendations/home?limit=18`, async (route) => {
    if (route.request().method() !== "GET" || !failLens) return route.continue();
    await route.fulfill({
      status: 503,
      headers: {
        "access-control-allow-origin": WEB,
        "access-control-allow-credentials": "true",
      },
      json: { message: "Unavailable" },
    });
  });

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/my-ayin/lens?lang=en");
  await expect(main.getByRole("heading", { level: 1, name: "AYIN Lens" })).toBeVisible();
  await expect(
    main.getByRole("heading", { name: "Recommendations could not be loaded" }),
  ).toBeVisible();

  failLens = false;
  await main.getByRole("button", { name: "Reload recommendations", exact: true }).click();
  await expect(main.getByText("Lens Recommendation Fixture", { exact: true })).toBeVisible();
  await expect(main.getByText("Personalized for you", { exact: true })).toBeVisible();

  const recommendation = main
    .getByRole("article")
    .filter({ hasText: "Lens Recommendation Fixture" });
  const notInterested = recommendation.getByRole("button", {
    name: "Not interested",
    exact: true,
  });
  let notInterestedWrites = 0;
  await page.route(`${API}/recommendations/not-interested`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    notInterestedWrites += 1;
    const committed = await page.request.post(route.request().url(), {
      data: route.request().postDataJSON(),
      headers: { origin: WEB },
    });
    expect(committed.ok()).toBe(true);
    await route.abort("failed");
  });

  await notInterested.click();
  await expect(
    main.getByText(/could not confirm whether this suggestion was hidden/i),
  ).toBeVisible();
  await expect(notInterested).toBeDisabled();
  const recoveryRefresh = main.getByRole("button", { name: "Refresh recommendations", exact: true });
  await expect(recoveryRefresh).toBeFocused();
  expect(notInterestedWrites).toBe(1);
  expect(
    db<{ feedback: Array<{ videoId: string; type: string }> }>("my-ayin-lens-evidence", { email })
      .feedback,
  ).toEqual([{ videoId: fixture.recommendationVideoId, type: "NOT_INTERESTED" }]);

  await page.unroute(`${API}/recommendations/not-interested`);
  await recoveryRefresh.click();
  await expect(main.getByText("Lens Recommendation Fixture", { exact: true })).toHaveCount(0);
  const resetPersonalization = main.getByRole("button", {
    name: "Reset personalization",
    exact: true,
  });
  await expect(resetPersonalization).toBeFocused();
  expect(notInterestedWrites).toBe(1);

  await resetPersonalization.click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Reset recommendation signals?" }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();

  let resetWrites = 0;
  await page.route(`${API}/recommendations/reset`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    resetWrites += 1;
    const committed = await page.request.post(route.request().url(), {
      data: route.request().postDataJSON(),
      headers: { origin: WEB },
    });
    expect(committed.ok()).toBe(true);
    await route.abort("failed");
  });
  await dialog.getByRole("button", { name: "Reset personalization", exact: true }).click();
  await expect(
    main.getByText(/could not confirm whether personalization was reset/i),
  ).toBeVisible();
  const resetRecovery = main.getByRole("button", {
    name: "Refresh recommendations",
    exact: true,
  });
  await expect(resetRecovery).toBeFocused();
  expect(resetWrites).toBe(1);

  const evidence = db<{
    feedback: Array<{ videoId: string; type: string }>;
    state: { resetAt: string | null } | null;
  }>("my-ayin-lens-evidence", { email });
  expect(evidence.feedback).toEqual([]);
  expect(evidence.state?.resetAt).not.toBeNull();

  await page.unroute(`${API}/recommendations/reset`);
  await resetRecovery.click();
  await expect(main.getByText("General recommendations", { exact: true })).toBeVisible();
  await expect(
    main.getByRole("button", { name: "Reset personalization", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("link", { name: "Skip to content", exact: true })).toBeHidden();
  expect(resetWrites).toBe(1);

  await page.screenshot({
    path: testInfo.outputPath("design-lens-1440-en.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar/my-ayin/lens?lang=ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(main.getByRole("heading", { level: 1, name: "AYIN Lens" })).toBeVisible();
  await expect(main.getByText("إعدادات التوصيات", { exact: true })).toBeVisible();
  await expect(main.getByText("توصيات عامة", { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("design-lens-390-ar.png"),
    fullPage: true,
  });

  const anonymous = await browser.newContext();
  try {
    const anonymousPage = await anonymous.newPage();
    await anonymousPage.goto("/my-ayin?lang=en");
    await expect(
      anonymousPage.getByRole("heading", { name: "Sign in to open My AYIN" }),
    ).toBeVisible();
    await anonymousPage.goto("/my-ayin/lens?lang=en");
    await expect(
      anonymousPage.getByRole("heading", { name: "Sign in to use AYIN Lens" }),
    ).toBeVisible();
  } finally {
    await anonymous.close();
  }
});
