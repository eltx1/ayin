import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
function db(command: string, payload: Record<string, unknown> = {}) {
  execFileSync(
    process.execPath,
    [path.resolve("tests/e2e/db-helper.mjs"), command, JSON.stringify(payload)],
    { env: process.env },
  );
}
test.afterEach(() => db("reset-warehouse-status"));
test("warehouse status is scoped, sanitized and honest about unavailable worker health", async ({
  page,
}) => {
  db("reset");
  db("reset-warehouse-status");
  expect((await page.request.get(`${API}/admin/warehouse-status`)).status()).toBe(401);
  const registration = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Export operator",
      email: "warehouse-status@e2e.ayin.test",
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBeTruthy();
  const { user } = await registration.json();
  await enrollMfa(page.request);
  db("grant-operator-role", { accountId: user.account.id, role: "FINANCE_MANAGER" });
  expect((await page.request.get(`${API}/admin/warehouse-status`)).status()).toBe(403);
  await page.goto("/admin/operations/warehouse");
  await expect(
    page.getByRole("alert").filter({ hasText: "Your current role cannot view" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delivery checkpoints" })).not.toBeVisible();
  db("grant-operator-role", { accountId: user.account.id, role: "OPERATIONS" });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/admin/") && !["GET", "OPTIONS"].includes(request.method()))
      writes.push(request.method());
  });
  await page.goto("/admin/operations");
  await page.getByRole("link", { name: "Data export status", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Export connector not configured" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "No successful export batch has been recorded for the current dataset versions.",
      { exact: true },
    ),
  ).toBeVisible();
  const empty = await page.request.get(`${API}/admin/warehouse-status`);
  expect(empty.headers()["cache-control"]).toContain("no-store");
  expect((await empty.json()).datasets).toHaveLength(5);
  db("seed-warehouse-status");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText(
      "No successful export batch has been recorded for the current dataset versions.",
      { exact: true },
    ),
  ).not.toBeVisible();
  const populated = await (await page.request.get(`${API}/admin/warehouse-status`)).json();
  expect(populated.configured).toBe(false);
  expect(
    populated.datasets.find((row: { dataset: string }) => row.dataset === "analytics_facts"),
  ).toEqual({
    dataset: "analytics_facts",
    schemaVersion: 1,
    cursorAt: "2026-09-01T10:00:00.000Z",
    lastSucceededAt: "2026-09-01T10:05:00.000Z",
  });
  expect(JSON.stringify(populated)).not.toMatch(/private|future-cursor|cursorId|lastBatchId/);
  await expect(page.getByText(/No independent worker heartbeat is available/)).toBeVisible();
  await page.route("**/admin/warehouse-status", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: "UNAVAILABLE", message: "Checkpoint temporarily unavailable" } },
    }),
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Checkpoint temporarily unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delivery checkpoints" })).not.toBeVisible();
  await page.unroute("**/admin/warehouse-status");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Delivery checkpoints" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().addCookies([{ name: "ayin_locale", value: "ar", url: WEB }]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "نقاط تقدم التسليم" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(writes).toEqual([]);
  await page.context().clearCookies();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Delivery checkpoints" })).not.toBeVisible();
  expect((await page.request.get(`${API}/admin/warehouse-status`)).status()).toBe(401);
});
