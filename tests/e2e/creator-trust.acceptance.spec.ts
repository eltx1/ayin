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
      [path.resolve("tests/e2e/creator-trust-fixture.mjs"), command, JSON.stringify(payload)],
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
    data: { name: "Trust Creator", email, password: "strong-pass-123" },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).user;
}
for (const locale of ["en", "ar"] as const)
  test(`Creator trust exposes every bounded real record and submits an owned appeal ${locale}`, async ({
    page,
  }, testInfo) => {
    const user = await register(page, `trust-${locale}@e2e.ayin.test`),
      seed = db("seed", { accountId: user.account.id }),
      ar = locale === "ar";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(ar ? "/ar/studio/trust" : "/studio/trust?lang=en");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(
      ar ? "الثقة والسلامة" : "Trust & Safety",
    );
    for (const [en, arabic, remaining] of [
      ["Moderation actions", "إجراءات الإشراف", 6],
      ["Appeal history", "سجل الاستئنافات", 5],
      ["Moderation notices", "إشعارات الإشراف", 5],
    ] as const) {
      const region = main.getByRole("region", { name: ar ? arabic : en, exact: true });
      await expect(region.locator("li")).toHaveCount(20);
      await region.getByRole("button", { name: ar ? "التالي" : "Next", exact: true }).click();
      await expect(region.locator("li")).toHaveCount(remaining);
      await region.locator("summary").first().click();
    }
    await expect(main.locator("pre")).toHaveCount(0);
    await expect(main.getByText("never render this diagnostic", { exact: false })).toHaveCount(0);
    await main
      .getByLabel(ar ? "إجراء الإشراف" : "Moderation action", { exact: true })
      .selectOption(seed.actionId);
    await main
      .getByLabel(ar ? "شرح الاستئناف" : "Appeal explanation", { exact: true })
      .fill("Actual creator explanation with enough information.");
    await main
      .getByRole("button", { name: ar ? "إرسال الاستئناف" : "Send appeal", exact: true })
      .click();
    await expect(
      main.getByRole("status").filter({ hasText: ar ? "تم إرسال الاستئناف" : "Appeal sent" }),
    ).toContainText(ar ? "تم إرسال الاستئناف" : "Appeal sent");
    expect(db("evidence", { accountId: user.account.id, actionId: seed.actionId }).appeals).toBe(1);
    await main
      .getByRole("button", { name: ar ? "تحديث السجل" : "Refresh history", exact: true })
      .click();
    await expect(
      main
        .getByRole("region", { name: ar ? "سجل الاستئنافات" : "Appeal history", exact: true })
        .locator("li"),
    ).toHaveCount(20);
    await main
      .getByLabel(ar ? "إجراء الإشراف" : "Moderation action", { exact: true })
      .selectOption(seed.actionId);
    await expect(
      main.getByRole("button", { name: ar ? "إرسال الاستئناف" : "Send appeal", exact: true }),
    ).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`design-creator-trust-390-${locale}.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: testInfo.outputPath(`design-creator-trust-1440-${locale}.png`),
      fullPage: true,
    });
  });
test("committed appeal loss retains explanation and locks writes until explicit history review", async ({
  page,
}) => {
  const user = await register(page, "trust-loss@e2e.ayin.test"),
    seed = db("seed", { accountId: user.account.id });
  let reads = 0,
    writes = 0;
  await page.route(`${API}/trust/creator/history`, async (route) => {
    reads++;
    await route.continue();
  });
  await page.route(`${API}/trust/appeals`, async (route) => {
    writes++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("failed");
  });
  await page.goto("/studio/trust?lang=en");
  const main = page.getByRole("main"),
    explanation = main.getByLabel("Appeal explanation", { exact: true });
  await expect(main.getByRole("region", { name: "Moderation actions", exact: true })).toBeVisible();
  const before = reads;
  await main.getByLabel("Moderation action", { exact: true }).selectOption(seed.actionId);
  await explanation.fill("Retained explanation after the actual committed appeal.");
  await main.getByRole("button", { name: "Send appeal", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("The appeal may already have been received");
  await expect(explanation).toHaveValue("Retained explanation after the actual committed appeal.");
  expect(reads).toBe(before);
  expect(writes).toBe(1);
  expect(db("evidence", { accountId: user.account.id, actionId: seed.actionId }).appeals).toBe(1);
  await main.getByRole("button", { name: "Review appeal history", exact: true }).click();
  await expect(
    main.getByRole("button", { name: "I have reviewed the result", exact: true }),
  ).toBeEnabled();
  await expect(main.getByRole("button", { name: "Send appeal", exact: true })).toBeDisabled();
  await main.getByRole("button", { name: "I have reviewed the result", exact: true }).click();
  await expect(main.getByRole("button", { name: "Send appeal", exact: true })).toBeDisabled();
  expect(writes).toBe(1);
  await page.route(`${API}/trust/creator/history`, async (route) =>
    route.fulfill({ status: 503, json: { error: { message: "diagnostic must not render" } } }),
  );
  await main.getByRole("button", { name: "Refresh history", exact: true }).click();
  await expect(
    main.getByRole("alert").filter({ hasText: "Trust history could not be loaded" }),
  ).toBeVisible();
  await expect(main.getByRole("region", { name: "Moderation actions", exact: true })).toHaveCount(
    0,
  );
  await expect(explanation).toHaveValue("Retained explanation after the actual committed appeal.");
  await expect(main.getByText("diagnostic must not render", { exact: false })).toHaveCount(0);
});
