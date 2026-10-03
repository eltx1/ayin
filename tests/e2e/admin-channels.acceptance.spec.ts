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
      [path.resolve("tests/e2e/admin-channels-fixture.mjs"), command, JSON.stringify(payload)],
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
async function register(page: Page, email: string) {
  const r = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: { name: "Actual Channel Operator", email, password: "strong-pass-123" },
  });
  expect(r.ok()).toBe(true);
  return (await r.json()).user;
}
async function operator(page: Page, email: string) {
  const user = await register(page, email);
  await enrollMfa(page.request);
  return { user, seed: db("seed", { accountId: user.account.id }) };
}
for (const locale of ["en", "ar"] as const)
  test(`Admin channel native forms retain drafts across actual pages and verify a zero-share save ${locale}`, async ({
    page,
  }, testInfo) => {
    const { user, seed } = await operator(page, `admin-channels-${locale}@e2e.ayin.test`),
      ar = locale === "ar";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/channels?query=Managed%20channel&lang=${locale}`);
    const main = page.getByRole("main"),
      list = main
        .locator("ul")
        .filter({ has: page.getByRole("heading", { name: new RegExp(seed.handle) }) });
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(
      ar ? "القنوات والمنشئون" : "Channels & Creators",
    );
    await expect(list.locator(":scope > li")).toHaveCount(25);
    const row = main
        .locator("li")
        .filter({ has: main.getByRole("heading", { name: new RegExp(seed.handle) }) }),
      edit = row
        .locator("summary")
        .filter({ hasText: ar ? `تعديل @${seed.handle}` : `Edit @${seed.handle}` });
    await edit.focus();
    await page.keyboard.press("Enter");
    await row
      .getByLabel(ar ? "اسم القناة" : "Channel name", { exact: true })
      .fill("Actual acknowledged channel");
    await row
      .getByLabel(ar ? "نسبة الأرباح · نقاط أساس" : "Revenue share · basis points", { exact: true })
      .fill("0");
    await row
      .getByLabel(ar ? "سبب التدقيق الفعلي" : "Actual audit reason", { exact: true })
      .fill("Actual reviewed zero share update");
    await main
      .getByRole("navigation", { name: ar ? "صفحات القنوات" : "Channel pages", exact: true })
      .getByRole("button", { name: ar ? "التالي" : "Next", exact: true })
      .click();
    await expect(main.locator("ul > li")).toHaveCount(1);
    await main
      .getByRole("navigation", { name: ar ? "صفحات القنوات" : "Channel pages", exact: true })
      .getByRole("button", { name: ar ? "السابق" : "Previous", exact: true })
      .click();
    await edit.click();
    await expect(row.getByLabel(ar ? "اسم القناة" : "Channel name", { exact: true })).toHaveValue(
      "Actual acknowledged channel",
    );
    let writes = 0,
      reads = 0;
    page.on("request", (r) => {
      if (r.method() === "PATCH" && r.url().includes("/admin/control/channels/")) writes++;
      if (r.method() === "GET" && r.url().includes("/admin/control/channels?")) reads++;
    });
    await row
      .getByRole("button", { name: ar ? "حفظ القناة" : "Save channel", exact: true })
      .click();
    await expect(
      main
        .getByRole("status")
        .filter({ hasText: ar ? "تم تأكيد القناة" : "Channel and actual contract acknowledged" }),
    ).toBeVisible();
    expect(writes).toBe(1);
    expect(reads).toBe(0);
    expect(db("evidence", { accountId: user.account.id, channelId: seed.channelId })).toMatchObject(
      {
        channel: {
          name: "Actual acknowledged channel",
          creatorContracts: [{ status: "ACTIVE", revenueShareBps: 0 }],
        },
        audits: 1,
      },
    );
    await page.route(`${API}/admin/control/channels/${seed.channelId}`, (route) =>
      route.fulfill({ status: 503, json: { message: "Controlled read unavailable" } }),
    );
    await main
      .getByRole("button", {
        name: ar ? "مراجعة القناة الحالية" : "Review current channel",
        exact: true,
      })
      .click();
    await expect(main.getByRole("alert")).toBeVisible();
    await expect(
      main.getByRole("button", {
        name: ar
          ? "راجعت القناة؛ فعّل التعديل التالي"
          : "I reviewed the channel; enable the next update",
        exact: true,
      }),
    ).toBeDisabled();
    expect(writes).toBe(1);
    await page.unroute(`${API}/admin/control/channels/${seed.channelId}`);
    await main
      .getByRole("button", {
        name: ar ? "مراجعة القناة الحالية" : "Review current channel",
        exact: true,
      })
      .click();
    await expect(
      main.getByRole("button", {
        name: ar
          ? "راجعت القناة؛ فعّل التعديل التالي"
          : "I reviewed the channel; enable the next update",
        exact: true,
      }),
    ).toBeEnabled();
    await main
      .getByRole("button", {
        name: ar
          ? "راجعت القناة؛ فعّل التعديل التالي"
          : "I reviewed the channel; enable the next update",
        exact: true,
      })
      .click();
    expect(writes).toBe(1);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`design-admin-channels-${width}-${locale}.png`),
        fullPage: true,
      });
    }
  });
test("Admin channel committed response loss preserves the actual draft and never replays", async ({
  page,
}) => {
  const { user, seed } = await operator(page, "admin-channel-loss@e2e.ayin.test");
  await page.goto("/admin/channels?query=Managed%20channel&lang=en");
  const main = page.getByRole("main"),
    row = main
      .locator("li")
      .filter({ has: main.getByRole("heading", { name: new RegExp(seed.handle) }) });
  await row
    .locator("summary")
    .filter({ hasText: `Edit @${seed.handle}` })
    .click();
  await row.getByLabel("Channel name", { exact: true }).fill("Retained committed channel draft");
  await row
    .getByLabel("Actual audit reason", { exact: true })
    .fill("Actual lost response audit reason");
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().includes("/admin/control/channels/")) writes++;
  });
  await page.route(`${API}/admin/control/channels/${seed.channelId}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("failed");
  });
  await row.getByRole("button", { name: "Save channel", exact: true }).click();
  await expect(
    main.getByRole("status").filter({ hasText: "response was not confirmed" }),
  ).toBeVisible();
  expect(db("evidence", { accountId: user.account.id, channelId: seed.channelId })).toMatchObject({
    channel: { name: "Retained committed channel draft" },
    audits: 1,
  });
  await expect(row.getByLabel("Channel name", { exact: true })).toHaveValue(
    "Retained committed channel draft",
  );
  await page.unroute(`${API}/admin/control/channels/${seed.channelId}`);
  await main.getByRole("button", { name: "Review current channel", exact: true }).click();
  await expect(
    main.getByRole("button", {
      name: "I reviewed the channel; enable the next update",
      exact: true,
    }),
  ).toBeEnabled();
  expect(writes).toBe(1);
  await expect(row.getByLabel("Actual audit reason", { exact: true })).toHaveValue(
    "Actual lost response audit reason",
  );
});
test("Admin channel rejects an actual concurrent edit before the stale browser draft overwrites it", async ({
  page,
}) => {
  const { user, seed } = await operator(page, "admin-channel-stale@e2e.ayin.test");
  await page.goto("/admin/channels?query=Managed%20channel&lang=en");
  const main = page.getByRole("main"),
    row = main
      .locator("li")
      .filter({ has: main.getByRole("heading", { name: new RegExp(seed.handle) }) });
  await row
    .locator("summary")
    .filter({ hasText: `Edit @${seed.handle}` })
    .click();
  await row.getByLabel("Channel name", { exact: true }).fill("Actual stale browser draft");
  await row
    .getByLabel("Actual audit reason", { exact: true })
    .fill("Actual stale attempt audit reason");
  const actual = await page.request.patch(`${API}/admin/control/channels/${seed.channelId}`, {
    headers: { origin: WEB },
    data: { name: "Actual concurrent channel change", reason: "Actual concurrent staff decision" },
  });
  expect(actual.ok()).toBe(true);
  await row.getByRole("button", { name: "Save channel", exact: true }).click();
  await expect(
    main.getByRole("status").filter({ hasText: "channel changed since your draft" }),
  ).toBeVisible();
  expect(db("evidence", { accountId: user.account.id, channelId: seed.channelId })).toMatchObject({
    channel: { name: "Actual concurrent channel change" },
    audits: 1,
  });
  await main.getByRole("button", { name: "Review current channel", exact: true }).click();
  await expect(row.getByLabel("Channel name", { exact: true })).toHaveValue(
    "Actual stale browser draft",
  );
  await expect(
    main.getByRole("button", {
      name: "I reviewed the channel; enable the next update",
      exact: true,
    }),
  ).toBeEnabled();
});
test("Finance access never requests the Operations directory", async ({ page }) => {
  const user = await register(page, "admin-channel-finance@e2e.ayin.test");
  db("finance-role", { accountId: user.account.id });
  let reads = 0;
  page.on("request", (r) => {
    if (r.method() === "GET" && r.url().includes("/admin/control/channels")) reads++;
  });
  await page.goto("/admin/channels?lang=en");
  await expect(page.getByRole("alert").filter({ hasText: "Operations access" })).toBeVisible();
  expect(reads).toBe(0);
  expect(
    (await page.request.get(`${API}/admin/control/channels/${user.channel.id}`)).status(),
  ).toBe(403);
});
