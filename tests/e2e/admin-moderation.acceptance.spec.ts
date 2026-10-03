import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
const cors = { "access-control-allow-origin": WEB, "access-control-allow-credentials": "true" };
test.use({ serviceWorkers: "block" });
function db(command: string, payload: Record<string, unknown> = {}) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/db-helper.mjs"), command, JSON.stringify(payload)],
      { env: process.env },
    ).toString(),
  );
}
test.beforeEach(() => {
  const url = new URL(
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "http://invalid",
  );
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("ayin_e2e"))
    throw new Error("Moderation acceptance requires isolated local ayin_e2e");
  db("reset");
});
async function register(page: Page, role: string) {
  const response = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Queue operator",
      email: `queue-${role}@e2e.ayin.test`,
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  expect(response.ok()).toBe(true);
  const user = (await response.json()).user;
  db("grant-operator-role", { accountId: user.account.id, role });
  return user;
}
for (const locale of ["en", "ar"] as const)
  test(`moderation reads every bounded page and recovers filter failures in ${locale}`, async ({
    page,
  }, testInfo) => {
    const user = await register(page, "CONTENT_MODERATOR");
    db("seed-moderation-queue", { accountId: user.account.id });
    let fail = false;
    await page.route(`${API}/admin/control/moderation?*`, async (route) => {
      const status = new URL(route.request().url()).searchParams.get("status");
      if (status === "RESOLVED" && fail)
        await route.fulfill({
          status: 503,
          headers: cors,
          json: { error: { code: "UNAVAILABLE" } },
        });
      else await route.continue();
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/moderation?lang=${locale}`);
    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", {
        level: 1,
        name: locale === "en" ? "Moderation" : "الإشراف",
        exact: true,
      }),
    ).toBeVisible();
    await expect(main.locator("article")).toHaveCount(25);
    await expect(main.locator("article").first().locator("time")).toContainText("UTC");
    await main.locator("summary").first().click();
    await expect(main.locator("article").first()).toContainText("FULL COMMENT END");
    const first = await main.locator("article").allTextContents();
    await main
      .getByRole("button", { name: locale === "en" ? "Next" : "التالي", exact: true })
      .click();
    await expect(main.locator("article")).toHaveCount(6);
    const second = await main.locator("article").allTextContents();
    expect(new Set([...first, ...second]).size).toBe(31);
    fail = true;
    await main.getByRole("combobox").selectOption("RESOLVED");
    await expect(
      main.getByRole("button", {
        name: locale === "en" ? "Retry reports" : "إعادة تحميل البلاغات",
        exact: true,
      }),
    ).toBeVisible();
    await expect(main.locator("article")).toHaveCount(0);
    fail = false;
    await main
      .getByRole("button", {
        name: locale === "en" ? "Retry reports" : "إعادة تحميل البلاغات",
        exact: true,
      })
      .click();
    await expect(main.locator("article")).toHaveCount(1);
    await main.locator("summary").click();
    await expect(main.locator("article")).toContainText("Resolved queue report");
    await expect(
      main.getByRole("link", {
        name: locale === "en" ? "Open Trust & Safety" : "فتح الثقة والسلامة",
        exact: true,
      }),
    ).toHaveAttribute("href", locale === "ar" ? "/ar/admin/trust" : "/admin/trust");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`design-admin-moderation-390-${locale}.png`),
      fullPage: true,
    });
  });
test("finance role cannot request or render the moderation queue", async ({ page }) => {
  await register(page, "FINANCE_MANAGER");
  expect((await page.request.get(`${API}/admin/control/moderation`)).status()).toBe(403);
  let reads = 0;
  page.on("request", (request) => {
    if (request.url().includes("/admin/control/moderation")) reads++;
  });
  await page.goto("/admin/moderation?lang=en");
  await expect(
    page
      .getByRole("main")
      .getByText("Your current role cannot access moderation reports.", { exact: true }),
  ).toBeVisible();
  expect(reads).toBe(0);
  await expect(page.getByRole("main").locator("article")).toHaveCount(0);
});

test("stalled moderation reads time out and explicit retry cannot render an obsolete filter", async ({
  page,
}) => {
  const user = await register(page, "OPERATIONS");
  db("seed-moderation-queue", { accountId: user.account.id });
  let held = true;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${API}/admin/control/moderation?*`, async (route) => {
    if (held) await gate;
    try {
      await route.continue();
    } catch {
      /* aborted original read remains canceled */
    }
  });
  try {
    await page.goto("/admin/moderation?lang=en");
    const main = page.getByRole("main");
    await expect(main.getByRole("button", { name: "Retry reports", exact: true })).toBeVisible({
      timeout: 20000,
    });
    await expect(main.locator("article")).toHaveCount(0);
    held = false;
    await main.getByRole("combobox").selectOption("RESOLVED");
    await expect(main.locator("article")).toHaveCount(1);
    release();
    await main.locator("summary").click();
    await expect(main.locator("article")).toContainText("Resolved queue report");
    await expect(main.locator("article")).toHaveCount(1);
  } finally {
    held = false;
    release();
  }
});
