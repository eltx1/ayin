import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
const destination = "controlled-e2e-immutable-destination-never-provider-approved";
test.use({ serviceWorkers: "block" });
function db(command: string, payload: object) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/admin-payout-detail-fixture.mjs"), command, JSON.stringify(payload)],
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
async function actor(page: Page, suffix: string) {
  const r = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: {
      name: "Actual payout detail operator",
      email: `payout-detail-${suffix}@e2e.ayin.test`,
      password: "strong-pass-123",
    },
  });
  expect(r.ok()).toBe(true);
  const user = (await r.json()).user;
  const profile = await page.request.put(`${API}/creator/studio/revenue/payment-profile`, {
    headers: { origin: WEB },
    data: {
      legalName: "Immutable E2E beneficiary",
      preferredCurrency: "USD",
      provider: "MANUAL",
      countryCode: "US",
      destination,
    },
  });
  expect(profile.ok()).toBe(true);
  await enrollMfa(page.request);
  return {
    accountId: user.account.id as string,
    ...db("seed", { accountId: user.account.id }),
  } as { accountId: string; payoutId: string; channelId: string };
}
for (const locale of ["en", "ar"] as const)
  test(`Native payout detail preserves exact records, audited immutable reveal, independent drafts and privacy ${locale}`, async ({
    page,
  }, info) => {
    const seed = await actor(page, locale),
      copy = (en: string, ar: string) => (locale === "ar" ? ar : en);
    let reads = 0,
      writes = 0;
    page.on("request", (r) => {
      if (r.url().includes(`/admin/revenue/payouts/${seed.payoutId}`)) {
        if (r.method() === "GET") reads++;
        if (r.method() === "POST") writes++;
      }
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/revenue/payouts/${seed.payoutId}?lang=${locale}`);
    const main = page.getByRole("main");
    await expect(main.getByText("USD 210.123456", { exact: true })).toBeVisible();
    await expect(main.getByText("Immutable E2E beneficiary", { exact: true })).toBeVisible();
    await expect(main.getByText("Later mutable beneficiary", { exact: true })).toHaveCount(0);
    await expect(
      main.getByText(copy("No transfer created", "لم يُنشأ تحويل"), { exact: true }),
    ).toBeVisible();
    expect(reads).toBe(2);
    expect(writes).toBe(0);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: info.outputPath(`design-admin-payout-detail-${locale}-${width}.png`),
        fullPage: true,
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    }
    const providerReason = main.getByLabel(copy("Provider action reason", "سبب إجراء المزود"), {
      exact: true,
    });
    const revealReason = main.getByLabel(
      copy("Reason for revealing payout destination", "سبب كشف جهة الصرف"),
      { exact: true },
    );
    await providerReason.fill("Retained independent provider draft");
    await revealReason.fill("Inspect the immutable beneficiary");
    const beforeReveal = reads;
    const disclosureResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/admin/revenue/payouts/${seed.payoutId}/destination`) &&
        response.request().method() === "POST",
    );
    await main
      .getByRole("button", {
        name: copy("Reveal sensitive destination", "كشف جهة الدفع الحساسة"),
        exact: true,
      })
      .click();
    const disclosure = await disclosureResponse;
    expect(disclosure.ok()).toBe(true);
    expect(disclosure.headers()["cache-control"]).toContain("private");
    expect(disclosure.headers()["cache-control"]).toContain("no-store");
    expect(disclosure.headers()["pragma"]).toBe("no-cache");
    const revealed = main.getByRole("region", {
      name: copy("Revealed destination", "جهة الدفع المكشوفة"),
      exact: true,
    });
    await expect(revealed).toContainText(destination);
    await expect(providerReason).toHaveValue("Retained independent provider draft");
    await expect(revealReason).toHaveValue("");
    expect(reads).toBe(beforeReveal);
    expect(writes).toBe(1);
    expect(db("evidence", seed)).toMatchObject({
      audits: [{ entityId: seed.payoutId }],
      transfers: 0,
      payout: { status: "PROCESSING", amount: "210.123456", provider: "MANUAL" },
    });
    // Controlled lifecycle event verifies synchronous sensitive DOM erasure and explicit recovery.
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
    );
    await expect(revealed).toHaveCount(0);
    await expect(main.getByText("Immutable E2E beneficiary", { exact: true })).toHaveCount(0);
    expect(await page.locator("body").textContent()).not.toContain(destination);
    expect(reads).toBe(beforeReveal);
    await main
      .getByRole("button", { name: copy("Read payout records", "قراءة سجلات الصرف"), exact: true })
      .click();
    await expect(providerReason).toHaveValue("Retained independent provider draft");
    expect(writes).toBe(1);
    await page.route(`**/admin/revenue/payouts/${seed.payoutId}`, (route) =>
      route.fulfill({ status: 503, json: { message: "Controlled read failure" } }),
    );
    await main
      .getByRole("button", { name: copy("Read payout records", "قراءة سجلات الصرف"), exact: true })
      .click();
    await expect(
      main.getByText(copy("Payout records unavailable", "سجلات الصرف غير متاحة"), { exact: true }),
    ).toBeVisible();
    await expect(main.getByText(copy("Acknowledged", "تم التأكيد"), { exact: true })).toBeVisible();
    expect(await page.locator("body").textContent()).not.toContain(destination);
    expect(writes).toBe(1);
  });
test("Lost actual committed reveal is never replayed after explicit payout recovery", async ({
  page,
}) => {
  const seed = await actor(page, "lost");
  await page.goto(`/admin/revenue/payouts/${seed.payoutId}?lang=en`);
  const main = page.getByRole("main"),
    reason = main.getByLabel("Reason for revealing payout destination", { exact: true }),
    button = main.getByRole("button", { name: "Reveal sensitive destination", exact: true });
  await reason.fill("Inspect original immutable beneficiary");
  let writes = 0;
  await page.route(`**/admin/revenue/payouts/${seed.payoutId}/destination`, async (route) => {
    writes++;
    const actual = await route.fetch();
    expect(actual.ok()).toBe(true);
    await route.abort("failed");
  });
  await button.click();
  await expect(main.getByText("Result uncertain", { exact: true })).toBeVisible();
  await expect(reason).toHaveValue("Inspect original immutable beneficiary");
  await expect(button).toBeDisabled();
  expect(db("evidence", seed).audits).toHaveLength(1);
  await main.getByRole("button", { name: "Read payout records", exact: true }).click();
  await main
    .getByRole("button", { name: "I reviewed this payout and provider state", exact: true })
    .click();
  await expect(button).toBeEnabled();
  expect(writes).toBe(1);
  expect(db("evidence", seed).audits).toHaveLength(1);
  expect(await main.textContent()).not.toContain(destination);
});
test("Explicit payout step-up rejection retains the original reason without replay", async ({
  page,
}) => {
  const seed = await actor(page, "step-up");
  await page.goto(`/admin/revenue/payouts/${seed.payoutId}?lang=en`);
  const main = page.getByRole("main"),
    reason = main.getByLabel("Reason for revealing payout destination", { exact: true });
  await reason.fill("Review original payout before verification");
  let writes = 0;
  await page.route(`**/admin/revenue/payouts/${seed.payoutId}/destination`, (route) => {
    writes++;
    return route.fulfill({
      status: 403,
      json: { error: { code: "STEP_UP_REQUIRED", message: "Controlled pre-handler rejection" } },
    });
  });
  await main.getByRole("button", { name: "Reveal sensitive destination", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(reason).toHaveValue("Review original payout before verification");
  await expect(
    main.getByRole("button", { name: "Reveal sensitive destination", exact: true }),
  ).toBeEnabled();
  expect(writes).toBe(1);
  expect(db("evidence", seed).audits).toHaveLength(0);
});
test("Operations administrator requests no private payout or provider records", async ({
  page,
}) => {
  const seed = await actor(page, "operations");
  db("operations", seed);
  let reads = 0;
  page.on("request", (r) => {
    if (r.url().includes(`/admin/revenue/payouts/${seed.payoutId}`)) reads++;
  });
  await page.goto(`/admin/revenue/payouts/${seed.payoutId}?lang=en`);
  await expect(page.getByText("Payout records unavailable", { exact: true })).toBeVisible();
  expect(reads).toBe(0);
  expect(await page.locator("body").textContent()).not.toContain(destination);
  expect(db("evidence", seed).audits).toHaveLength(0);
});

test("Sensitive destination expires after sixty seconds and supports immediate hide", async ({
  page,
}) => {
  const seed = await actor(page, "expiry");
  await page.clock.install();
  await page.goto(`/admin/revenue/payouts/${seed.payoutId}?lang=en`);
  const main = page.getByRole("main"),
    reason = main.getByLabel("Reason for revealing payout destination", { exact: true });
  const reveal = main.getByRole("button", { name: "Reveal sensitive destination", exact: true });
  await reason.fill("Review immutable beneficiary with expiry");
  await reveal.click();
  await expect(
    main.getByRole("region", { name: "Revealed destination", exact: true }),
  ).toContainText(destination);
  await page.clock.fastForward(60000);
  await expect(main.getByRole("region", { name: "Revealed destination", exact: true })).toHaveCount(
    0,
  );
  expect(await main.textContent()).not.toContain(destination);
  expect(db("evidence", seed).audits).toHaveLength(1);
  await reason.fill("Review immutable beneficiary then hide");
  await reveal.click();
  await expect(
    main.getByRole("region", { name: "Revealed destination", exact: true }),
  ).toContainText(destination);
  await main.getByRole("button", { name: "Hide destination now", exact: true }).click();
  expect(await main.textContent()).not.toContain(destination);
  expect(db("evidence", seed).audits).toHaveLength(2);
});
