import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
function db(command: string, payload: Record<string, unknown> = {}) {
  execFileSync(
    process.execPath,
    [path.resolve("tests/e2e/db-helper.mjs"), command, JSON.stringify(payload)],
    { env: process.env },
  );
}

test("operator workspaces preserve role boundaries, empty/error states and mobile RTL", async ({
  page,
}) => {
  db("reset");
  const registered = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Operations browser",
      email: "operator-workspace@e2e.ayin.test",
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  expect(registered.ok()).toBeTruthy();
  const identity = (await registered.json()) as { user: { account: { id: string } } };
  await enrollMfa(page.request);
  db("grant-admin", { accountId: identity.user.account.id });
  let sessionReads = 0;
  let databaseReads = 0;
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/admin/session")) sessionReads++;
    if (request.url().endsWith("/admin/observability/postgres")) databaseReads++;
    if (request.url().includes("/admin/") && !["GET", "OPTIONS"].includes(request.method()))
      writes.push(request.method());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/operations/media");
  await expect(page.getByRole("heading", { name: "Media operations", exact: true })).toBeVisible();
  await expect(
    page.getByText("No processing jobs have been reported.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Adaptive HLS rollout" })).toBeVisible();
  expect(sessionReads).toBe(1);
  await page.route("**/admin/media-processing", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: "UNAVAILABLE", message: "Queue temporarily unavailable" } },
    }),
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Queue temporarily unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByText("No processing jobs have been reported.", { exact: true }),
  ).not.toBeVisible();
  await page.unroute("**/admin/media-processing");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByText("No processing jobs have been reported.", { exact: true }),
  ).toBeVisible();
  await page.goto("/admin/operations/database");
  await expect(
    page.getByRole("alert").filter({ hasText: "Your current role cannot view" }),
  ).toBeVisible();
  expect(databaseReads).toBe(0);
  expect((await page.request.get(`${API}/admin/observability/postgres`)).status()).toBe(403);
  db("grant-operator-role", { accountId: identity.user.account.id, role: "SUPERADMIN" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Connections by application" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Statement timings" })).toBeVisible();
  expect(databaseReads).toBe(1);
  await page.context().addCookies([{ name: "ayin_locale", value: "ar", url: WEB }]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "الاتصالات حسب التطبيق" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(writes).toEqual([]);
});
