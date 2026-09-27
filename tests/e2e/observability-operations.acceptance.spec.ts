import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
function db(command: string, payload: Record<string, unknown> = {}) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/db-helper.mjs"), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
test.afterEach(() => db("reset-operator-state"));
test("service observability keeps SUPERADMIN scope and distinguishes sampled, historical and unavailable evidence", async ({
  page,
}) => {
  db("reset");
  db("reset-operator-state");
  expect((await page.request.get(`${API}/admin/observability`)).status()).toBe(401);
  const registration = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Observability",
      email: "observability@e2e.ayin.test",
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBeTruthy();
  const { user } = await registration.json();
  await enrollMfa(page.request);
  for (const role of ["OPERATIONS", "ADMIN"]) {
    db("grant-operator-role", { accountId: user.account.id, role });
    expect((await page.request.get(`${API}/admin/observability`)).status()).toBe(403);
  }
  await page.goto("/admin/operations/observability");
  await expect(
    page.getByRole("alert").filter({ hasText: "Your current role cannot view" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "API request sample" })).not.toBeVisible();
  db("grant-operator-role", { accountId: user.account.id, role: "SUPERADMIN" });
  db("seed-operator-job", { channelId: user.channel.id });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/admin/") && !["GET", "OPTIONS"].includes(request.method()))
      writes.push(request.method());
  });
  await page.goto("/admin/operations");
  await page.getByRole("link", { name: "Service observability", exact: true }).click();
  await expect(page.getByRole("heading", { name: "API request sample" })).toBeVisible();
  await expect(page.getByText(/External telemetry is not connected/)).toBeVisible();
  await expect(page.getByText(/not total platform traffic/)).toBeVisible();
  const response = await page.request.get(`${API}/admin/observability`);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const real = await response.json();
  expect(real.api).toMatchObject({ scope: "PROCESS", sampleLimit: 1000, windowSeconds: 60 });
  expect(real.worker.failures).toBe(1);
  expect(real.errors.counterScope).toBe("PROCESS_LIFETIME");
  await page.route(`${API}/admin/observability`, (route) =>
    route.fulfill({ status: 503, json: { error: { message: "Metrics temporarily unavailable" } } }),
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Metrics temporarily unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "API request sample" })).not.toBeVisible();
  await page.unroute(`${API}/admin/observability`);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "API request sample" })).toBeVisible();
  // These explicit fixtures establish client empty/capped-sample presentation,
  // not a production zero-traffic or high-load observation.
  const empty = {
    ...real,
    api: {
      ...real.api,
      requests: 0,
      requestsPerSecond: 0,
      statusClasses: { "1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 },
      latencyMs: { average: 0, p50: 0, p95: 0, max: 0 },
    },
    errors: { ...real.errors, counters: {} },
  };
  await page.route(`${API}/admin/observability`, (route) => route.fulfill({ json: empty }));
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText(/Latency is unavailable without retained requests/)).toBeVisible();
  await expect(
    page.getByText("No error counters recorded in this process.", { exact: true }),
  ).toBeVisible();
  await page.unroute(`${API}/admin/observability`);
  await page.route(`${API}/admin/observability`, (route) =>
    route.fulfill({ json: { ...real, api: { ...real.api, requests: real.api.sampleLimit } } }),
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText(/The sample limit is reached/)).toBeVisible();
  await page.unroute(`${API}/admin/observability`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().addCookies([{ name: "ayin_locale", value: "ar", url: WEB }]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "عينة طلبات API" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(writes).toEqual([]);
  await page.context().clearCookies();
  await page.reload();
  await expect(page.getByRole("heading", { name: "عينة طلبات API" })).not.toBeVisible();
  expect((await page.request.get(`${API}/admin/observability`)).status()).toBe(401);
});
