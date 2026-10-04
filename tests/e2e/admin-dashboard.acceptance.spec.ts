import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
const cors = { "access-control-allow-origin": WEB, "access-control-allow-credentials": "true" };
test.use({ serviceWorkers: "block" });
function db(command: string, payload: Record<string, unknown> = {}) {
  execFileSync(
    process.execPath,
    [path.resolve("tests/e2e/db-helper.mjs"), command, JSON.stringify(payload)],
    { env: process.env },
  );
}
test.beforeEach(() => {
  const url = new URL(
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "http://invalid",
  );
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("ayin_e2e"))
    throw new Error("Dashboard acceptance requires isolated local ayin_e2e");
  db("reset");
});
async function register(page: Page, email: string) {
  const response = await page.request.post(`${API}/auth/register`, {
    data: { name: "Dashboard search acceptance operator", email, password: "strong-pass-123" },
    headers: { origin: WEB },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).user;
}
async function noOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
}
test("scoped dashboard keeps available data through a failed summary and renders role-safe real search in EN/AR", async ({
  page,
}, testInfo) => {
  expect((await page.request.get(`${API}/admin/control/dashboard`)).status()).toBe(401);
  const user = await register(page, "scoped-dashboard@e2e.ayin.test");
  db("grant-operator-role", { accountId: user.account.id, role: "OPERATIONS" });
  expect((await page.request.get(`${API}/admin/revenue/finance-summary`)).status()).toBe(403);
  let fail = true,
    financeReads = 0,
    sessionReads = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/admin/revenue/finance-summary")) financeReads++;
    if (request.url().endsWith("/admin/session")) sessionReads++;
  });
  await page.route(`${API}/admin/control/dashboard`, async (route) =>
    fail
      ? route.fulfill({ status: 503, headers: cors, json: { error: { code: "UNAVAILABLE" } } })
      : route.continue(),
  );
  await page.goto("/admin?lang=en");
  const main = page.getByRole("main"),
    counters = main.getByRole("region", { name: "Platform counters", exact: true });
  await expect(
    main.getByRole("heading", { level: 1, name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(counters.getByText(/This summary could not be loaded/)).toBeVisible();
  await expect(
    main
      .getByRole("region", { name: "System status", exact: true })
      .getByText("Test", { exact: true }),
  ).toBeVisible();
  await expect(main.getByRole("region", { name: "Revenue operations", exact: true })).toContainText(
    "available to finance roles",
  );
  expect(financeReads).toBe(0);
  expect(sessionReads).toBe(1);
  fail = false;
  await expect(main.getByRole("button", { name: "Refresh overview", exact: true })).toBeEnabled();
  await main.getByRole("button", { name: "Refresh overview", exact: true }).click();
  await expect(counters.locator("dd")).toHaveCount(8);
  await expect(counters.locator("dd").first()).toHaveText("1");
  const search = main.getByRole("textbox", { name: "Search administration", exact: true });
  await expect(
    main.getByText("No permitted records match this search.", { exact: true }),
  ).toHaveCount(0);
  await search.fill("no-matches-unique");
  await main.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    main.getByText("No permitted records match this search.", { exact: true }),
  ).toBeVisible();
  await search.fill("Dashboard search acceptance");
  await expect(
    main.getByText("No permitted records match this search.", { exact: true }),
  ).toHaveCount(0);
  await main.getByRole("button", { name: "Search", exact: true }).click();
  const results = main.getByRole("list", { name: "Search results", exact: true });
  await expect(results.locator("li")).toHaveCount(2);
  await expect(results.getByRole("link").first()).toHaveAttribute("href", /\/admin\/users\?query=/);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("design-admin-overview-390-en.png"),
    fullPage: true,
  });
  await page.goto("/ar/admin?lang=ar");
  await expect(
    main.getByRole("heading", { level: 1, name: "نظرة عامة", exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("region", { name: "إحصاءات المنصة", exact: true }).locator("dd"),
  ).toHaveCount(8);
  const workspaces = main.getByRole("region", { name: "مساحات عملك", exact: true });
  await expect(workspaces.getByRole("link").first()).toHaveAttribute("href", /^\/ar\/admin\//);
  await noOverflow(page);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("design-admin-overview-390-ar.png"),
    fullPage: true,
  });
});
test("privileged overview uses real MFA and keeps validated finance mode and access boundaries", async ({
  page,
}) => {
  const user = await register(page, "privileged-dashboard@e2e.ayin.test");
  await enrollMfa(page.request);
  db("grant-admin", { accountId: user.account.id });
  const financeResponse = await page.request.get(`${API}/admin/revenue/finance-summary`);
  expect(financeResponse.ok()).toBe(true);
  const finance = await financeResponse.json();
  await page.goto("/admin?lang=en");
  const main = page.getByRole("main"),
    region = main.getByRole("region", { name: "Revenue operations", exact: true });
  await expect(
    region.getByText(
      finance.mode === "MANUAL_PAYOUT" ? "Manual payouts" : "Provider and manual payouts",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(region.locator("dd").first()).toHaveText(String(finance.pendingPayouts));
  await page.route(`${API}/admin/session`, (route) =>
    route.fulfill({
      status: 200,
      headers: cors,
      json: { accountId: user.account.id, roles: ["UNKNOWN"] },
    }),
  );
  await page.reload();
  await expect(
    main.getByText("Administrative access could not be verified.", { exact: false }),
  ).toBeVisible();
  await expect(main.getByRole("region", { name: "Platform counters", exact: true })).toHaveCount(0);
});

test("a stalled overview read reaches bounded recovery without hiding completed summaries", async ({
  page,
}) => {
  const user = await register(page, "dashboard-stalled@e2e.ayin.test");
  db("grant-operator-role", { accountId: user.account.id, role: "OPERATIONS" });
  let held = true,
    release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${API}/admin/control/dashboard`, async (route) => {
    if (held) {
      await gate;
      await route.continue().catch(() => {});
    } else await route.continue();
  });
  await page.goto("/admin?lang=en");
  const main = page.getByRole("main"),
    counters = main.getByRole("region", { name: "Platform counters", exact: true });
  await expect(
    main
      .getByRole("region", { name: "System status", exact: true })
      .getByText("Test", { exact: true }),
  ).toBeVisible();
  await expect(counters.getByText(/This summary could not be loaded/)).toBeVisible({
    timeout: 20000,
  });
  await expect(main.getByRole("button", { name: "Refresh overview", exact: true })).toBeEnabled();
  held = false;
  release();
  await main.getByRole("button", { name: "Refresh overview", exact: true }).click();
  await expect(counters.locator("dd")).toHaveCount(8);
});
