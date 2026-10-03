import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
test.use({ serviceWorkers: "block" });
function db(command: string, payload: object = {}) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/db-helper.mjs"), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
    throw new Error("Requires isolated local ayin_e2e");
  db("reset");
});
async function register(page: Page, email: string) {
  const response = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: { name: "Analytics Creator", email, password: "strong-pass-123" },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}
for (const locale of ["en", "ar"] as const)
  test(`Creator analytics exposes complete measured reports, privacy suppression and native tabs ${locale}`, async ({
    page,
  }, testInfo) => {
    const identity = await register(page, `analytics-${locale}@e2e.ayin.test`);
    const seeded = db("seed-creator-analytics", { accountId: identity.user.account.id });
    const response = await page.request.get(`${API}/creator/studio/analytics?days=28`);
    expect(response.ok()).toBe(true);
    const actual = await response.json();
    expect(actual.views).toBe(280);
    expect(actual.cohorts.audienceDaily).toHaveLength(27);
    expect(actual.cohorts.retention).toHaveLength(27);
    expect(actual.cohorts.subscriberRetention).toHaveLength(27);
    expect(actual.cohorts.audienceDaily[0].date).toBe(seeded.firstVisible);
    const ar = locale === "ar";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(ar ? "/ar/studio/analytics" : "/studio/analytics?lang=en");
    const main = page.getByRole("main"),
      tabs = main.getByRole("tablist");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(
      ar ? "التحليلات" : "Analytics",
    );
    await expect(tabs.getByRole("tab")).toHaveCount(5);
    for (const button of await tabs.getByRole("tab").all()) {
      const bounds = await button.boundingBox();
      expect(bounds?.height).toBeLessThanOrEqual(50);
    }
    const overview = tabs.getByRole("tab", { name: ar ? "نظرة عامة" : "Overview", exact: true });
    await overview.focus();
    await page.keyboard.press("End");
    await expect(
      tabs.getByRole("tab", { name: ar ? "جودة التشغيل" : "Playback quality" }),
    ).toBeFocused();
    await expect(overview).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    const playback = main.getByRole("tabpanel", { name: ar ? "جودة التشغيل" : "Playback quality" });
    await expect(
      playback.getByText(ar ? "تغييرات الجودة" : "Quality switches", { exact: true }),
    ).toBeVisible();
    await expect(
      playback
        .getByText(ar ? "معدل العرض" : "Fill rate", { exact: true })
        .locator("..")
        .locator("dd"),
    ).toContainText(ar ? "٥٠" : "50");
    await tabs.getByRole("tab", { name: ar ? "الجمهور" : "Audience", exact: true }).click();
    const audience = main.getByRole("tabpanel", { name: ar ? "الجمهور" : "Audience", exact: true });
    const cohort = audience.getByRole("region", {
      name: ar ? "مجموعات عودة الجمهور" : "Audience return cohorts",
      exact: true,
    });
    await expect(cohort.locator("tbody tr")).toHaveCount(20);
    await expect(cohort.locator("details dt")).toHaveCount(0);
    const pager = audience.getByRole("navigation", {
      name: ar ? "مجموعات عودة الجمهور" : "Audience return cohorts",
      exact: true,
    });
    await pager.getByRole("button", { name: ar ? "التالي" : "Next" }).click();
    await expect(cohort.locator("tbody tr")).toHaveCount(7);
    await expect(pager.getByRole("status")).toContainText(ar ? "٢٧" : "27");
    const dailyPager = audience.getByRole("navigation", {
      name: ar ? "الجمهور الجديد والعائد" : "New and returning audience",
      exact: true,
    });
    await dailyPager.getByRole("button", { name: ar ? "التالي" : "Next" }).click();
    await expect(
      audience
        .getByRole("region", {
          name: ar ? "الجمهور الجديد والعائد" : "New and returning audience",
          exact: true,
        })
        .locator("tbody tr"),
    ).toHaveCount(7);
    await expect(cohort.locator("details dt")).toHaveCount(0);
    const cohortDetails = cohort.locator("details").first();
    const cohortSummary = cohortDetails.locator("summary");
    await cohortSummary.focus();
    await page.keyboard.press("Enter");
    await expect(cohortDetails).toHaveAttribute("open", "");
    await expect(cohort.getByRole("heading", { name: "D1", exact: true }).first()).toBeVisible();
    await expect(cohortDetails.locator("dt")).not.toHaveCount(0);
    const mountedFacts = await cohortDetails.locator("dt").count();
    await page.keyboard.press("Enter");
    await expect(cohortDetails).not.toHaveAttribute("open", "");
    await expect(cohortDetails.locator("dt")).toHaveCount(mountedFacts);
    await page.keyboard.press("Enter");
    await expect(cohortDetails).toHaveAttribute("open", "");
    const daily = audience.getByRole("region", {
      name: ar ? "الجمهور الجديد والعائد" : "New and returning audience",
      exact: true,
    });
    await expect(daily.locator("details dt")).toHaveCount(0);
    const dailyDetails = daily.locator("details").first();
    await dailyDetails.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(dailyDetails.locator("dt")).toHaveCount(4);
    await tabs.getByRole("tab", { name: ar ? "التفاعل" : "Engagement", exact: true }).click();
    const engagement = main.getByRole("tabpanel", {
      name: ar ? "التفاعل" : "Engagement",
      exact: true,
    });
    await engagement
      .getByRole("navigation", {
        name: ar ? "مجموعات احتفاظ المشتركين" : "Subscriber retention cohorts",
        exact: true,
      })
      .getByRole("button", { name: ar ? "التالي" : "Next" })
      .click();
    await expect(
      engagement
        .getByRole("region", {
          name: ar ? "مجموعات احتفاظ المشتركين" : "Subscriber retention cohorts",
          exact: true,
        })
        .locator("tbody tr"),
    ).toHaveCount(7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`design-studio-analytics-390-${locale}.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await tabs.getByRole("tab", { name: ar ? "الجمهور" : "Audience", exact: true }).click();
    await expect(cohort.locator("tbody tr")).toHaveCount(7);
    await expect(cohortDetails).toHaveAttribute("open", "");
    await expect(cohortDetails.locator("dt")).toHaveCount(mountedFacts);
    await expect(dailyDetails).toHaveAttribute("open", "");
    await expect(dailyDetails.locator("dt")).toHaveCount(4);
    await page.screenshot({
      path: testInfo.outputPath(`design-studio-analytics-1440-${locale}.png`),
      fullPage: true,
    });
  });
test("Analytics retains controls on failed reads, rejects malformed privacy rows and hides previous periods", async ({
  page,
}) => {
  const identity = await register(page, "analytics-recovery@e2e.ayin.test");
  db("seed-creator-analytics", { accountId: identity.user.account.id });
  let mode: "real" | "failed" | "malformed" = "failed",
    reads = 0;
  await page.route(`${API}/creator/studio/analytics?**`, async (route) => {
    reads++;
    if (mode === "failed") return route.fulfill({ status: 503, body: "{}" });
    const response = await route.fetch();
    if (mode === "malformed") {
      const data = await response.json();
      data.cohorts.retention[0].cohortSize = 1;
      return route.fulfill({ response, json: data });
    }
    return route.fulfill({ response });
  });
  await page.goto("/studio/analytics?lang=en");
  const main = page.getByRole("main");
  await expect(main.getByRole("alert")).toContainText("Analytics could not be loaded.");
  await expect(main.getByLabel("Date range", { exact: true })).toHaveValue("28");
  mode = "real";
  await main.getByRole("button", { name: "Retry analytics" }).click();
  await expect(main.getByRole("tablist")).toBeVisible();
  mode = "failed";
  await main.getByLabel("Date range", { exact: true }).selectOption("7");
  await expect(main.getByRole("alert")).toBeVisible();
  await expect(main.getByRole("tablist")).toHaveCount(0);
  mode = "malformed";
  await main.getByRole("button", { name: "Retry analytics" }).click();
  await expect(main.getByRole("alert")).toBeVisible();
  await expect(main.getByRole("tablist")).toHaveCount(0);
  mode = "real";
  const before = reads;
  await main.getByRole("button", { name: "Retry analytics" }).click();
  await expect(main.getByRole("tablist")).toBeVisible();
  expect(reads - before).toBe(1);
});
test("Analytics bounds stalled reads, discards obsolete results and preserves unavailable measurements", async ({
  page,
}) => {
  await register(page, "analytics-timeout@e2e.ayin.test");
  const actual = await page.request.get(`${API}/creator/studio/analytics?days=28`);
  expect((await actual.json()).advertising.fillRate).toBeNull();
  let release: () => void = () => {},
    seen: () => void = () => {};
  const arrived = new Promise<void>((resolve) => {
    seen = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${API}/creator/studio/analytics?days=28`, async (route) => {
    seen();
    await held;
    await route.fulfill({ response: actual }).catch(() => {});
  });
  await page.goto("/studio/analytics?lang=en");
  await arrived;
  const main = page.getByRole("main");
  await expect(main.getByRole("alert")).toContainText("Analytics could not be loaded.", {
    timeout: 20_000,
  });
  await main.getByLabel("Date range", { exact: true }).selectOption("7");
  await expect(main.getByRole("tablist")).toBeVisible();
  release();
  await expect(main.getByLabel("Date range", { exact: true })).toHaveValue("7");
  await main.getByRole("tab", { name: "Playback quality" }).click();
  await expect(
    main
      .getByRole("tabpanel", { name: "Playback quality" })
      .getByText("No measured ad-request telemetry exists for this period; fill is unavailable."),
  ).toBeVisible();
  await expect(
    main
      .getByRole("tabpanel", { name: "Playback quality" })
      .getByText("Unavailable", { exact: true })
      .first(),
  ).toBeVisible();
});
