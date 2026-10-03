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
      [path.resolve("tests/e2e/admin-trust-fixture.mjs"), command, JSON.stringify(payload)],
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
  db("reset");
});
async function register(page: Page, email: string) {
  const response = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: { name: "Trust reviewer", email, password: "strong-pass-123" },
  });
  expect(response.ok()).toBe(true);
  const user = (await response.json()).user;
  execFileSync(
    process.execPath,
    [
      path.resolve("tests/e2e/db-helper.mjs"),
      "grant-operator-role",
      JSON.stringify({ accountId: user.account.id, role: "CONTENT_MODERATOR" }),
    ],
    { env: process.env },
  );
  return user;
}
for (const locale of ["en", "ar"] as const)
  test(`Admin Trust exposes every bounded queue and native decisions ${locale}`, async ({
    page,
  }, testInfo) => {
    const user = await register(page, `trust-ui-${locale}@e2e.ayin.test`),
      seed = db("seed", { accountId: user.account.id }),
      ar = locale === "ar";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/trust?lang=${locale}`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(
      ar ? "الثقة والسلامة" : "Trust & Safety",
    );
    for (const title of [
      ar ? "البلاغات" : "Reports",
      ar ? "حالات الإشراف" : "Moderation cases",
      ar ? "طلبات إزالة المحتوى" : "Takedown requests",
      ar ? "الاستئنافات" : "Appeals",
    ]) {
      const region = main.getByRole("region", { name: title, exact: true });
      await expect(region.locator(":scope > ul > li")).toHaveCount(20);
      await region
        .getByRole("navigation", { name: title, exact: true })
        .getByRole("button", { name: ar ? "التالي" : "Next", exact: true })
        .click();
      await expect(region.locator(":scope > ul > li")).toHaveCount(6);
      await region
        .getByRole("navigation", { name: title, exact: true })
        .getByRole("button", { name: ar ? "السابق" : "Previous", exact: true })
        .click();
      await expect(region.locator(":scope > ul > li")).toHaveCount(20);
    }
    const cases = main.getByRole("region", {
        name: ar ? "حالات الإشراف" : "Moderation cases",
        exact: true,
      }),
      first = cases.locator(":scope > ul > li").first();
    await first.locator("summary").first().focus();
    await page.keyboard.press("Enter");
    await expect(first).toContainText(seed.caseId);
    await first.getByLabel(ar ? "القرار" : "Decision", { exact: true }).selectOption("CLOSED");
    await first
      .getByLabel(ar ? "سبب القرار" : "Decision reason", { exact: true })
      .fill("Actual native case decision evidence.");
    await first
      .getByRole("button", { name: ar ? "حفظ القرار" : "Save decision", exact: true })
      .click();
    await expect(
      main.getByRole("status").filter({ hasText: ar ? "تم حفظ العملية" : "Operation saved." }),
    ).toBeVisible();
    expect(
      db("evidence", { accountId: user.account.id, kind: "cases", id: seed.caseId }),
    ).toMatchObject({
      status: "CLOSED",
      resolution: "Actual native case decision evidence.",
      audits: 1,
    });
    await main
      .getByRole("button", {
        name: ar ? "مراجعة القائمة الحالية" : "Review current queue",
        exact: true,
      })
      .click();
    await expect(
      main.getByRole("heading", {
        name: ar ? "السجل المحفوظ الحالي" : "Current saved record",
        exact: true,
      }),
    ).toBeVisible();
    await expect(main).toContainText(ar ? "مغلق" : "Closed");
    await main
      .getByRole("button", {
        name: ar ? "تأكيد المراجعة وتفعيل القرارات" : "Confirm review and enable decisions",
        exact: true,
      })
      .click();
    await main.getByRole("tab", { name: ar ? "إجراءاتك" : "Your actions", exact: true }).click();
    const ledger = main.getByRole("region", {
      name: ar ? "أحدث إجراءات الإشراف الخاصة بك" : "Your recent enforcement actions",
      exact: true,
    });
    await expect(ledger.locator(":scope > ul > li")).toHaveCount(20);
    await ledger.getByRole("button", { name: ar ? "التالي" : "Next", exact: true }).click();
    await expect(ledger.locator(":scope > ul > li")).toHaveCount(6);
    await main.getByRole("tab", { name: ar ? "القرارات" : "Decisions", exact: true }).click();
    await expect(main.locator("form")).not.toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`design-admin-trust-390-${locale}.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: testInfo.outputPath(`design-admin-trust-1440-${locale}.png`),
      fullPage: true,
    });
    const terminal = await page.request.get(`${API}/admin/trust/records/cases/${seed.caseId}`);
    expect(terminal.ok()).toBe(true);
    expect(terminal.headers()["cache-control"]).toContain("no-store");
    expect((await terminal.json()).record.status).toBe("CLOSED");
    expect(
      (await page.request.get(`${API}/admin/trust/records/not-a-model/${seed.caseId}`)).status(),
    ).toBe(400);
    expect((await page.request.get(`${API}/admin/trust/records/cases/not-a-uuid`)).status()).toBe(
      400,
    );
  });
test("actual lost terminal appeal response retains decision draft and review reads its committed record without replay", async ({
  page,
}) => {
  const user = await register(page, "trust-ui-loss@e2e.ayin.test"),
    seed = db("seed", { accountId: user.account.id });
  let writes = 0,
    records = 0;
  await page.route(`${API}/admin/trust/records/appeals/${seed.appealId}`, async (route) => {
    records++;
    await route.continue();
  });
  await page.route(`${API}/admin/trust/appeals/${seed.appealId}`, async (route) => {
    writes++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("failed");
  });
  await page.goto("/admin/trust?lang=en");
  const main = page.getByRole("main"),
    appeal = main
      .getByRole("region", { name: "Appeals", exact: true })
      .locator(":scope > ul > li")
      .first();
  await appeal.getByLabel("Decision", { exact: true }).selectOption("UPHELD");
  await appeal
    .getByLabel("Decision reason", { exact: true })
    .fill("Actual retained appeal decision evidence.");
  await appeal.getByRole("button", { name: "Save decision", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("outcome could not be verified");
  expect(writes).toBe(1);
  expect(records).toBe(0);
  await main.getByRole("button", { name: "Review current queue", exact: true }).click();
  await expect(
    main.getByRole("heading", { name: "Current saved record", exact: true }),
  ).toBeVisible();
  await expect(main).toContainText("Upheld");
  await expect(main).toContainText("Actual retained appeal decision evidence.");
  expect(
    db("evidence", { accountId: user.account.id, kind: "appeals", id: seed.appealId }),
  ).toMatchObject({
    status: "UPHELD",
    resolution: "Actual retained appeal decision evidence.",
    audits: 1,
  });
  expect(writes).toBe(1);
  expect(records).toBe(1);
  await main.getByText("Retained decision drafts", { exact: true }).click();
  await expect(
    main.getByText("Actual retained appeal decision evidence.", { exact: true }),
  ).toHaveCount(2);
  await expect(
    main.getByRole("button", { name: "Confirm review and enable decisions", exact: true }),
  ).toBeEnabled();
});
test("malformed trust reads hide prior queue and unrelated staff cannot access terminal records", async ({
  page,
}) => {
  const user = await register(page, "trust-ui-malformed@e2e.ayin.test"),
    seed = db("seed", { accountId: user.account.id });
  let malformed = false;
  await page.route(`${API}/admin/trust/queue`, async (route) => {
    const response = await route.fetch();
    if (!malformed) return route.fulfill({ response });
    const body = await response.json();
    body.appeals[0].actionId = seed.caseId;
    await route.fulfill({ response, json: body });
  });
  await page.goto("/admin/trust?lang=en");
  const main = page.getByRole("main");
  await expect(main.getByRole("region", { name: "Reports", exact: true })).toBeVisible();
  malformed = true;
  await main.getByRole("button", { name: "Review current queue", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("could not be verified");
  await expect(main.getByRole("region", { name: "Reports", exact: true })).toHaveCount(0);
  await expect(
    main.getByRole("button", { name: "Confirm review and enable decisions", exact: true }),
  ).toHaveCount(0);
  const response = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: {
      name: "Finance reader",
      email: "trust-ui-finance@e2e.ayin.test",
      password: "strong-pass-123",
    },
  });
  expect(response.ok()).toBe(true);
  const finance = (await response.json()).user;
  execFileSync(
    process.execPath,
    [
      path.resolve("tests/e2e/db-helper.mjs"),
      "grant-operator-role",
      JSON.stringify({ accountId: finance.account.id, role: "FINANCE_MANAGER" }),
    ],
    { env: process.env },
  );
  expect((await page.request.get(`${API}/admin/trust/records/cases/${seed.caseId}`)).status()).toBe(
    403,
  );
});

test("a changed actual account is rejected before any protected mutation and clears the previous queue and draft", async ({
  page,
}) => {
  const first = await register(page, "trust-ui-identity-first@e2e.ayin.test");
  db("seed", { accountId: first.account.id });
  await page.goto("/admin/trust?lang=en");
  const main = page.getByRole("main");
  await expect(main.getByRole("region", { name: "Reports", exact: true })).toBeVisible();
  await main.getByRole("tab", { name: "Decisions", exact: true }).click();
  await main.getByText("Resource references", { exact: true }).click();
  await main.getByPlaceholder("Account UUID when required", { exact: true }).fill(first.account.id);
  await main
    .getByLabel("Detailed enforcement reason", { exact: true })
    .fill("Retained local intent from the previous account.");
  await register(page, "trust-ui-identity-second@e2e.ayin.test");
  let writes = 0;
  await page.route(`${API}/admin/trust/actions`, async (route) => {
    if (route.request().method() === "POST") writes++;
    await route.continue();
  });
  await main.getByRole("button", { name: "Record enforcement action", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("identity changed");
  expect(writes).toBe(0);
  await expect(main.getByRole("region", { name: "Reports", exact: true })).toHaveCount(0);
  await expect(main.getByLabel("Detailed enforcement reason", { exact: true })).toHaveValue("");
  const actions = await page.request.get(`${API}/admin/trust/actions`);
  expect((await actions.json()).actions).toEqual([]);
});
