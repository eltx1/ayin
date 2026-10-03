import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
test.use({ serviceWorkers: "block" });
function db(command: string, payload: object) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/admin-finance-fixture.mjs"), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
    throw Error("Requires isolated local ayin_e2e");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
async function actor(page: Page, suffix: string, finance = true) {
  const r = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: {
      name: "Actual Finance Operator",
      email: `admin-finance-${suffix}@e2e.ayin.test`,
      password: "strong-pass-123",
    },
  });
  expect(r.ok()).toBe(true);
  const user = (await r.json()).user;
  if (finance) {
    const profile = await page.request.put(`${API}/creator/studio/revenue/payment-profile`, {
      headers: { origin: WEB },
      data: {
        legalName: "Actual E2E Finance Beneficiary",
        preferredCurrency: "USD",
        provider: "MANUAL",
        countryCode: "US",
        destination: "actual-e2e-destination-never-provider-approved",
      },
    });
    expect(profile.ok()).toBe(true);
  }
  await enrollMfa(page.request);
  const seed = db(finance ? "seed" : "operations", { accountId: user.account.id });
  return { user, seed };
}
async function section(page: Page, name: string) {
  const main = page.getByRole("main");
  await main.getByRole("tab", { name, exact: true }).click();
  return main.getByRole("tabpanel", { name, exact: true });
}
async function choose(page: Page, seed: { query: string; handle: string }, ar = false) {
  const panel = await section(page, ar ? "قرارات القناة" : "Channel decisions");
  await panel
    .getByLabel(ar ? "اسم القناة أو معرّفها" : "Channel name or handle", { exact: true })
    .fill(seed.query);
  await panel
    .getByRole("button", { name: ar ? "البحث عن القنوات" : "Search channels", exact: true })
    .click();
  await panel.getByRole("button", { name: new RegExp(seed.handle) }).click();
  await expect(
    panel.getByLabel(
      ar ? "حصة المنشئ (٠–١٠٠٠٠ نقطة أساس)" : "Creator share (0–10000 basis points)",
      { exact: true },
    ),
  ).toBeEnabled();
  return panel;
}
for (const locale of ["en", "ar"] as const)
  test(`Native Finance verifies exact writes, retained channel drafts, all-row pages and report import ${locale}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    const { user, seed } = await actor(page, locale),
      ar = locale === "ar",
      copy = (en: string, arabic: string) => (ar ? arabic : en);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/revenue?lang=${locale}`);
    const main = page.getByRole("main"),
      ack = main.getByTestId("finance-ack");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(copy("Finance", "المالية"));
    await expect(
      main.getByLabel(
        copy(
          "Default creator share (0–10000 basis points)",
          "حصة المنشئ الافتراضية (٠–١٠٠٠٠ نقطة أساس)",
        ),
      ),
    ).toHaveValue("0");
    let settingsWrites = 0,
      adjustments = 0,
      financialReads = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/admin/revenue/settings") && r.method() === "PATCH") settingsWrites++;
      if (r.url().endsWith("/admin/revenue/adjustments") && r.method() === "POST") adjustments++;
      if (
        r.method() === "GET" &&
        r.url().includes("/admin/revenue/") &&
        !r.url().includes("/channels/")
      )
        financialReads++;
    });
    await main
      .getByLabel(
        copy(
          "Default creator share (0–10000 basis points)",
          "حصة المنشئ الافتراضية (٠–١٠٠٠٠ نقطة أساس)",
        ),
      )
      .fill("");
    await main
      .getByRole("button", { name: copy("Save defaults", "حفظ الإعدادات"), exact: true })
      .click();
    await expect(
      main
        .getByRole("status")
        .filter({ hasText: copy("Check the required fields", "راجع الحقول المطلوبة") }),
    ).toBeVisible();
    expect(settingsWrites).toBe(0);
    await main
      .getByLabel(
        copy(
          "Default creator share (0–10000 basis points)",
          "حصة المنشئ الافتراضية (٠–١٠٠٠٠ نقطة أساس)",
        ),
      )
      .fill("0");
    await main
      .getByLabel(copy("Minimum payout amount (each currency)", "الحد الأدنى للصرف (لكل عملة)"))
      .fill("0.000000");
    await main
      .getByRole("button", { name: copy("Save defaults", "حفظ الإعدادات"), exact: true })
      .click();
    await expect(ack).toContainText(copy("Global defaults", "الإعدادات العامة"));
    expect(settingsWrites).toBe(1);
    expect(financialReads).toBe(0);
    let panel = await choose(page, seed, ar);
    const adjustment = panel.locator("#finance-section-2"),
      amountLabel = copy(
        "Signed amount (up to six decimals)",
        "المبلغ بإشارته (حتى ٦ منازل عشرية)",
      ),
      reasonLabel = copy("Reason (8–500 characters)", "السبب (٨–٥٠٠ حرف)");
    await adjustment.getByLabel(amountLabel).fill("-0.000001");
    await adjustment.getByLabel(reasonLabel).fill("Actual reviewed one micro adjustment");
    await panel.getByRole("button", { name: new RegExp(seed.secondHandle) }).click();
    await expect(
      panel.getByLabel(
        copy("Creator share (0–10000 basis points)", "حصة المنشئ (٠–١٠٠٠٠ نقطة أساس)"),
      ),
    ).toBeEnabled();
    await panel.getByRole("button", { name: new RegExp(seed.handle) }).click();
    await expect(adjustment.getByLabel(amountLabel)).toHaveValue("-0.000001");
    await adjustment
      .getByRole("button", { name: copy("Record adjustment", "تسجيل التسوية"), exact: true })
      .click();
    await expect(ack).toContainText("USD -0.000001");
    expect(adjustments).toBe(1);
    const evidence = db("evidence", { accountId: user.account.id });
    expect(evidence.adjustments).toEqual([
      { amount: "-0.000001", currency: "USD", memo: "Actual reviewed one micro adjustment" },
    ]);
    expect(
      evidence.audits.filter((r: { action: string }) => r.action === "REVENUE_SETTINGS_UPDATED"),
    ).toHaveLength(1);
    const history = panel
      .locator("details")
      .filter({ hasText: copy("Contract history", "سجل العقود") });
    await history.locator("summary").click();
    await expect(history.locator("article")).toHaveCount(20);
    await history.getByRole("button", { name: copy("Next", "التالي"), exact: true }).click();
    await expect(history.locator("article")).toHaveCount(6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    const eligibility = panel.locator("details").filter({
      hasText: copy("Payout eligibility and provider requirements", "أهلية الصرف ومتطلبات المزود"),
    });
    await eligibility.locator("summary").click();
    await expect(
      eligibility.getByText(copy("No configured requirements", "لا توجد متطلبات مضبوطة"), {
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`design-admin-finance-channel-${locale}-390.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: testInfo.outputPath(`design-admin-finance-channel-${locale}-1440.png`),
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    panel = await section(page, copy("Payouts", "عمليات الصرف"));
    await expect(panel.locator("article")).toHaveCount(25);
    await panel
      .getByRole("navigation", { name: copy("Payout pages", "صفحات الصرف") })
      .getByRole("button", { name: copy("Next", "التالي"), exact: true })
      .click();
    await expect(panel.locator("article")).toHaveCount(1);
    panel = await section(page, copy("Disputes", "النزاعات"));
    await expect(panel.locator("article")).toHaveCount(20);
    await panel
      .getByRole("navigation", { name: copy("Dispute pages", "صفحات النزاعات") })
      .getByRole("button", { name: copy("Next", "التالي"), exact: true })
      .click();
    await expect(panel.locator("article")).toHaveCount(6);
    panel = await section(page, copy("My recent decisions", "قراراتي الأخيرة"));
    await panel
      .getByRole("button", { name: copy("Read my decisions", "قراءة قراراتي"), exact: true })
      .click();
    await expect(panel.locator("article")).toHaveCount(20);
    await panel
      .getByRole("navigation", { name: copy("Recent decisions", "القرارات الأخيرة") })
      .getByRole("button", { name: copy("Next", "التالي"), exact: true })
      .click();
    await expect(panel.locator("article")).toHaveCount(8);
    panel = await section(page, copy("Report reconciliation", "مطابقة التقارير"));
    await expect(panel.getByLabel(copy("Source", "المصدر"), { exact: true })).toBeVisible();
    await panel
      .getByLabel(copy("Source", "المصدر"), { exact: true })
      .fill(`Actual Finance ${locale}`);
    await panel
      .getByLabel(copy("Source report reference", "مرجع تقرير المصدر"), { exact: true })
      .fill(`retained-report-${locale}`);
    await panel
      .getByLabel(copy("Period start", "بداية الفترة"), { exact: true })
      .fill("2026-10-01T00:00");
    await panel
      .getByLabel(copy("Period end", "نهاية الفترة"), { exact: true })
      .fill("2026-10-02T00:00");
    await panel.getByLabel(copy("Currency", "العملة"), { exact: true }).fill("USD");
    await panel
      .getByLabel(copy("Revenue state", "حالة الإيراد"), { exact: true })
      .selectOption("FINAL");
    await panel
      .getByLabel(copy("CSV content", "محتوى CSV"), { exact: true })
      .fill(`externalRowId,grossAmount,channelId\nactual-row,1.123456,${seed.channelId}`);
    let imports = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/reconciliation/imports")) imports++;
    });
    await panel
      .getByRole("button", { name: copy("Reconcile report", "مطابقة التقرير"), exact: true })
      .click();
    await expect(ack).toContainText(`retained-report-${locale}`);
    expect(imports).toBe(1);
    await expect(panel.getByLabel(copy("CSV content", "محتوى CSV"))).toHaveValue("");
    await panel
      .getByRole("button", {
        name: copy("Apply report filters", "تطبيق فلاتر التقارير"),
        exact: true,
      })
      .click();
    await panel
      .getByRole("button", { name: copy("Inspect report rows", "فحص صفوف التقرير"), exact: true })
      .first()
      .click();
    await expect(panel.locator("article").filter({ hasText: "actual-row" })).toHaveCount(1);
    panel = await section(page, copy("Channel decisions", "قرارات القناة"));
    const contract = panel.locator("#finance-section-1");
    await contract
      .getByLabel(copy("Creator share (0–10000 basis points)", "حصة المنشئ (٠–١٠٠٠٠ نقطة أساس)"))
      .fill("0");
    await contract
      .getByLabel(copy("Effective from", "يسري من"), { exact: true })
      .fill("2026-10-03T12:00");
    await contract
      .getByRole("button", { name: copy("Create contract", "إنشاء العقد"), exact: true })
      .click();
    await expect(ack).toContainText(copy("Channel contract", "عقد القناة"));
    const compliance = panel.locator("#finance-section-5");
    await compliance
      .getByLabel(copy("New status", "الحالة الجديدة"), { exact: true })
      .selectOption("PENDING");
    await compliance
      .getByLabel(reasonLabel)
      .fill("Actual independently reviewed identity decision");
    await compliance
      .getByRole("button", {
        name: copy("Record compliance decision", "تسجيل قرار الامتثال"),
        exact: true,
      })
      .click();
    await expect(ack).toContainText(copy("Compliance decision", "قرار الامتثال"));
    panel = await section(page, copy("Payouts", "عمليات الصرف"));
    await panel
      .getByRole("navigation", { name: copy("Payout pages", "صفحات الصرف") })
      .getByRole("button", { name: copy("Previous", "السابق"), exact: true })
      .click();
    const payout = panel.locator("article").filter({ hasText: seed.payoutId });
    await payout
      .getByLabel(copy("New status", "الحالة الجديدة"), { exact: true })
      .selectOption("PAID");
    await payout
      .getByLabel(copy("Decision reason (8–500 characters)", "سبب القرار (٨–٥٠٠ حرف)"))
      .fill("Actual reviewed manual payout status decision");
    await payout
      .getByRole("button", {
        name: copy("Record payout decision", "تسجيل قرار الصرف"),
        exact: true,
      })
      .click();
    await expect(ack).toContainText(copy("Payout decision", "قرار الصرف"));
    panel = await section(page, copy("Channel decisions", "قرارات القناة"));
    await panel
      .locator("#finance-section-4")
      .getByRole("button", { name: copy("Create payout", "إنشاء عملية صرف"), exact: true })
      .click();
    await expect(ack).toContainText(copy("Payout creation", "إنشاء صرف"));
    const final = db("evidence", { accountId: user.account.id });
    for (const action of [
      "CREATOR_CONTRACT_CREATED",
      "creator.compliance_status_overridden",
      "PAYOUT_STATUS_UPDATED",
    ])
      expect(final.audits.filter((row: { action: string }) => row.action === action)).toHaveLength(
        1,
      );
  });
test("Finance keeps a committed interrupted adjustment locked, reviews its original channel and never replays", async ({
  page,
}) => {
  const { user, seed } = await actor(page, "lost-ack");
  await page.goto("/admin/revenue");
  const panel = await choose(page, seed),
    adjustment = panel.locator("#finance-section-2"),
    main = page.getByRole("main");
  await adjustment.getByLabel("Signed amount (up to six decimals)").fill("-0.000001");
  await adjustment
    .getByLabel("Reason (8–500 characters)")
    .fill("Actual interrupted reviewed adjustment");
  let writes = 0,
    reads = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/admin/revenue/adjustments")) writes++;
    if (
      r.method() === "GET" &&
      r.url().includes("/admin/revenue/") &&
      !r.url().includes("/channels/")
    )
      reads++;
  });
  await page.route(`${API}/admin/revenue/adjustments`, async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("failed");
  });
  await adjustment.getByRole("button", { name: "Record adjustment", exact: true }).click();
  await expect(
    main.getByRole("status").filter({ hasText: "The result needs review" }),
  ).toBeVisible();
  expect(writes).toBe(1);
  expect(reads).toBe(0);
  await expect(
    adjustment.getByRole("button", { name: "Record adjustment", exact: true }),
  ).toBeDisabled();
  await expect(adjustment.getByLabel("Reason (8–500 characters)")).toHaveValue(
    "Actual interrupted reviewed adjustment",
  );
  await panel.getByRole("button", { name: new RegExp(seed.secondHandle) }).click();
  await page.unroute(`${API}/admin/revenue/adjustments`);
  await main
    .getByRole("button", { name: "Read current records and my decisions", exact: true })
    .click();
  await expect(main.getByText("The original channel was read:")).toContainText(seed.channelId);
  expect(writes).toBe(1);
  expect(db("evidence", { accountId: user.account.id }).adjustments).toHaveLength(1);
});
test("Finance preserves a verified acknowledgment when the next explicit read fails", async ({
  page,
}) => {
  await actor(page, "read-failure");
  await page.goto("/admin/revenue");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Save defaults", exact: true }).click();
  await expect(main.getByTestId("finance-ack")).toContainText("Global defaults");
  await page.route(`${API}/admin/revenue/settings`, (route) =>
    route.fulfill({ status: 503, json: { message: "Controlled read unavailable" } }),
  );
  await main.getByRole("button", { name: "Refresh financial records", exact: true }).click();
  await expect(
    main.getByRole("alert").filter({ hasText: "Records could not be read" }),
  ).toBeVisible();
  await expect(main.getByTestId("finance-ack")).toContainText("Global defaults");
});
test("Operations sends zero Finance and reconciliation reads or writes", async ({ page }) => {
  await actor(page, "operations", false);
  let financial = 0;
  page.on("request", (r) => {
    if (r.url().includes("/admin/revenue/") || r.url().includes("/directory/revenue-channels"))
      financial++;
  });
  await page.goto("/admin/revenue");
  await expect(
    page.getByRole("main").getByText("Finance access unavailable", { exact: true }),
  ).toBeVisible();
  expect(financial).toBe(0);
});
