import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
test.use({ serviceWorkers: "block" });
function db(command: string, payload: object) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/creator-finance-fixture.mjs"), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
    throw Error("Requires isolated ayin_e2e");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
async function register(page: Page, email: string) {
  const response = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: { name: "Actual Finance Owner", email, password: "strong-pass-123" },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).user;
}
for (const locale of ["en", "ar"] as const)
  test(`Creator finance retains exact values, all daily rows and an acknowledged save ${locale}`, async ({
    page,
  }, testInfo) => {
    const user = await register(page, `finance-${locale}@e2e.ayin.test`);
    db("seed", { accountId: user.account.id });
    const ar = locale === "ar";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/studio/monetization?lang=${locale}`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(
      ar ? "الأرباح والمدفوعات" : "Earnings & payouts",
    );
    const reports = main.getByRole("tab", { name: ar ? "التقارير" : "Reports", exact: true });
    await reports.focus();
    await page.keyboard.press("Enter");
    const daily = main.getByRole("region", {
      name: ar ? "الأرباح اليومية" : "Daily revenue",
      exact: true,
    });
    await expect(daily.locator("tbody tr")).toHaveCount(20);
    await expect(daily.locator("tbody tr").first()).toContainText("USD 1.123456");
    const dailySection = daily.locator("..");
    await dailySection.getByRole("button", { name: ar ? "التالي" : "Next", exact: true }).click();
    await expect(dailySection.getByRole("status")).toContainText(ar ? "٢ / ٢" : "2 / 2");
    await main.getByRole("tab", { name: ar ? "النزاعات" : "Disputes", exact: true }).click();
    const disputes = main.getByRole("region", {
      name: ar ? "سجلات النزاعات الحالية" : "Current dispute records",
      exact: true,
    });
    await expect(disputes.locator("tbody tr")).toHaveCount(20);
    await disputes
      .locator("..")
      .getByRole("button", { name: ar ? "التالي" : "Next", exact: true })
      .click();
    await expect(disputes.locator("tbody tr")).toHaveCount(6);
    await main
      .getByRole("tab", { name: ar ? "بيانات الدفع" : "Payment details", exact: true })
      .click();
    await main
      .getByLabel(ar ? "الاسم القانوني" : "Legal name", { exact: true })
      .fill("Actual saved beneficiary");
    await main
      .getByLabel(ar ? "وجهة دفع جديدة · اختيارية" : "New payout destination · optional", {
        exact: true,
      })
      .fill("Actual test bank destination 1122334455");
    let writes = 0,
      reads = 0;
    page.on("request", (r) => {
      if (r.method() === "PUT" && r.url().endsWith("/payment-profile")) writes++;
      if (r.method() === "GET" && r.url() === `${API}/creator/studio/revenue`) reads++;
    });
    await main
      .getByRole("button", { name: ar ? "حفظ بيانات الدفع" : "Save payment details", exact: true })
      .click();
    await expect(
      main.getByRole("status").filter({ hasText: ar ? "أكد الخادم" : "server acknowledged" }),
    ).toBeVisible();
    expect(writes).toBe(1);
    expect(reads).toBe(0);
    expect(db("evidence", { accountId: user.account.id })).toMatchObject({
      profile: {
        legalName: "Actual saved beneficiary",
        currency: "USD",
        provider: "MANUAL",
        encrypted: true,
      },
      profileAudits: 1,
    });
    await expect(
      main.getByLabel(ar ? "وجهة دفع جديدة · اختيارية" : "New payout destination · optional", {
        exact: true,
      }),
    ).toHaveValue("");
    await page.route(`${API}/creator/studio/revenue`, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"message":"Controlled read failure"}',
      }),
    );
    await main
      .getByRole("button", {
        name: ar ? "مراجعة الحالة الحالية" : "Review current state",
        exact: true,
      })
      .click();
    await expect(main.getByRole("alert")).toBeVisible();
    await expect(main.getByText("Actual saved beneficiary", { exact: true })).toBeVisible();
    expect(writes).toBe(1);
    await page.unroute(`${API}/creator/studio/revenue`);
    await main
      .getByRole("button", {
        name: ar ? "مراجعة الحالة الحالية" : "Review current state",
        exact: true,
      })
      .click();
    await expect(
      main.getByRole("button", {
        name: ar
          ? "راجعت الحالة؛ فعّل العملية التالية"
          : "I reviewed the state; enable the next operation",
        exact: true,
      }),
    ).toBeEnabled();
    await main
      .getByRole("button", {
        name: ar
          ? "راجعت الحالة؛ فعّل العملية التالية"
          : "I reviewed the state; enable the next operation",
        exact: true,
      })
      .click();
    await main.getByRole("tab", { name: ar ? "التقارير" : "Reports", exact: true }).click();
    await expect(dailySection.getByRole("status")).toContainText(ar ? "٢ / ٢" : "2 / 2");
    const download = page.waitForEvent("download");
    await main
      .getByRole("button", { name: ar ? "تنزيل كشف CSV" : "Download CSV statement", exact: true })
      .click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
    expect(writes).toBe(1);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
      // Preserve each exact amount and unavailable label on one readable line.
      const metricValues = main.locator("dl[aria-label] dd:visible");
      expect(await metricValues.count()).toBeGreaterThan(0);
      for (const value of await metricValues.all()) {
        expect(
          await value.evaluate((node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            const tops = [...range.getClientRects()].map((rect) => Math.round(rect.top));
            return new Set(tops).size;
          }),
        ).toBe(1);
      }
      await page.screenshot({
        path: testInfo.outputPath(`design-creator-finance-${width}-${locale}.png`),
        fullPage: true,
      });
    }
  });
test("Creator finance preserves a committed profile response loss without replay", async ({
  page,
}) => {
  const user = await register(page, "finance-loss@e2e.ayin.test");
  db("seed", { accountId: user.account.id });
  await page.goto("/studio/monetization?lang=en");
  const main = page.getByRole("main");
  await main.getByRole("tab", { name: "Payment details", exact: true }).click();
  await main.getByLabel("Legal name", { exact: true }).fill("Retained beneficiary draft");
  const destination = "Retained actual bank destination 66778899";
  await main.getByLabel("New payout destination · optional", { exact: true }).fill(destination);
  let writes = 0,
    reads = 0;
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().endsWith("/payment-profile")) writes++;
    if (r.method() === "GET" && r.url() === `${API}/creator/studio/revenue`) reads++;
  });
  await page.route(`${API}/creator/studio/revenue/payment-profile`, async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("failed");
  });
  await main.getByRole("button", { name: "Save payment details", exact: true }).click();
  await expect(
    main.getByRole("status").filter({ hasText: "response was not confirmed" }),
  ).toBeVisible();
  await expect(main.getByLabel("New payout destination · optional", { exact: true })).toHaveValue(
    destination,
  );
  expect(writes).toBe(1);
  expect(reads).toBe(0);
  expect(db("evidence", { accountId: user.account.id })).toMatchObject({
    profile: { legalName: "Retained beneficiary draft", encrypted: true },
    profileAudits: 1,
  });
  await page.unroute(`${API}/creator/studio/revenue/payment-profile`);
  await main.getByRole("button", { name: "Review current state", exact: true }).click();
  await expect(
    main.getByRole("button", {
      name: "I reviewed the state; enable the next operation",
      exact: true,
    }),
  ).toBeEnabled();
  await main.getByRole("tab", { name: "Payment details", exact: true }).click();
  await expect(main.getByLabel("New payout destination · optional", { exact: true })).toHaveValue(
    destination,
  );
  expect(writes).toBe(1);
  expect(reads).toBe(1);
});
test("Creator finance rejects a changed account before writing and clears the old draft", async ({
  page,
}) => {
  const user = await register(page, "finance-owner@e2e.ayin.test");
  db("seed", { accountId: user.account.id });
  await page.goto("/studio/monetization?lang=en");
  const main = page.getByRole("main");
  await main.getByRole("tab", { name: "Disputes", exact: true }).click();
  await main
    .getByLabel("Detailed message", { exact: true })
    .fill("Actual retained owner dispute message 123456");
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/disputes")) writes++;
  });
  await register(page, "finance-other@e2e.ayin.test");
  await main.getByRole("button", { name: "Submit dispute", exact: true }).click();
  await expect(
    main.getByRole("alert").filter({ hasText: "account or channel changed" }),
  ).toBeVisible();
  await expect(
    main.getByText("Actual retained owner dispute message 123456", { exact: true }),
  ).toHaveCount(0);
  expect(writes).toBe(0);
  expect(db("evidence", { accountId: user.account.id }).disputes).toBe(26);
});
test("Creator finance bounds a stalled snapshot and rejects malformed money before retry", async ({
  page,
}) => {
  await register(page, "finance-read@e2e.ayin.test");
  await page.route(`${API}/creator/studio/revenue`, () => {});
  await page.goto("/studio/monetization?lang=en");
  const main = page.getByRole("main");
  await expect(main.getByRole("alert")).toBeVisible({ timeout: 20000 });
  await expect(
    main.getByRole("button", { name: "Review current state", exact: true }),
  ).toBeEnabled();
  await page.unroute(`${API}/creator/studio/revenue`);
  await page.route(`${API}/creator/studio/revenue`, async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    body.availableForPayout = "NaN";
    await route.fulfill({ response, json: body });
  });
  await main.getByRole("button", { name: "Review current state", exact: true }).click();
  await expect(main.getByRole("alert")).toBeVisible();
  await expect(main.getByRole("tablist")).toHaveCount(0);
  await page.unroute(`${API}/creator/studio/revenue`);
  await main.getByRole("button", { name: "Review current state", exact: true }).click();
  await expect(main.getByRole("tab", { name: "Payment details", exact: true })).toBeVisible();
});
