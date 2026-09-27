import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { generateTotpCode, totpCounter } from "../../apps/api/src/auth/totp.js";
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
test.afterEach(() => {
  db("reset-discovery-operator");
});
test("discovery operators distinguish fixture evidence and save validated trending changes with step-up and audit", async ({
  page,
}) => {
  db("reset");
  db("reset-discovery-operator");
  const registration = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Discovery operator",
      email: "discovery-operations@e2e.ayin.test",
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBeTruthy();
  const { user } = await registration.json();
  const { secret } = await enrollMfa(page.request);
  db("grant-operator-role", { accountId: user.account.id, role: "FINANCE_MANAGER" });
  expect((await page.request.get(`${API}/admin/trending-settings`)).status()).toBe(403);
  expect(
    (
      await page.request.put(`${API}/admin/trending-settings`, {
        data: {},
        headers: { origin: WEB },
      })
    ).status(),
  ).toBe(403);
  await page.goto("/admin/operations/discovery");
  await expect(
    page.getByRole("alert").filter({ hasText: "Your current role cannot view" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Trending settings", exact: true }),
  ).not.toBeVisible();
  db("grant-operator-role", { accountId: user.account.id, role: "OPERATIONS" });
  // Age assurance on a real issued E2E session; the real guard must reject the first write.
  const session = (await page.context().cookies()).find((cookie) =>
    cookie.value.startsWith("v1."),
  )!;
  const payload = JSON.parse(Buffer.from(session.value.split(".")[1], "base64url").toString());
  payload.reauthAt = Math.floor(Date.now() / 1000) - 600;
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", "task-29-e2e-auth-secret-with-more-than-32-characters")
    .update(encoded)
    .digest("base64url");
  await page.context().addCookies([{ ...session, value: `v1.${encoded}.${signature}` }]);
  await page.goto("/admin/operations");
  await page.getByRole("link", { name: "Discovery & trending", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Offline fixture comparison" })).toBeVisible();
  await expect(
    page.getByText("No recommendation versions observed in the last 30 days.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Fixture candidate", { exact: true }).selectOption("watch-only");
  await page.getByRole("button", { name: "Compare fixture", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Fixture guardrails failed" }),
  ).toBeVisible();
  const recent = page.getByLabel("Recent activity window (hours)", { exact: true });
  await recent.fill("72");
  await page.getByLabel("Reason for change", { exact: true }).fill("Review recent activity window");
  const review = page.getByRole("button", { name: "Review trending changes", exact: true });
  await expect(review).toBeDisabled();
  await recent.fill("7");
  await review.click();
  const confirmation = page.getByRole("dialog", { name: "Confirm trending changes", exact: true });
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(review).toBeFocused();
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().endsWith("/admin/trending-settings")) writes++;
  });
  await review.click();
  await confirmation.getByRole("button", { name: "Confirm and save", exact: true }).click();
  const verification = page.getByRole("dialog", { name: "Confirm your identity", exact: true });
  await expect(verification).toBeVisible();
  expect(db("discovery-action-evidence", { accountId: user.account.id }).audits).toHaveLength(0);
  await verification.getByLabel("Password", { exact: true }).fill("strong-pass-123");
  await verification
    .getByLabel("Authenticator code")
    .fill(generateTotpCode(secret, totpCounter() + 1n));
  await verification.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(verification).not.toBeVisible();
  expect(writes).toBe(1);
  await expect(recent).toHaveValue("7");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/admin/trending-settings", async (route) => {
    if (route.request().method() === "PUT") await pending;
    await route.continue();
  });
  await review.click();
  await confirmation.getByRole("button", { name: "Confirm and save", exact: true }).click();
  await expect(recent).toBeDisabled();
  await expect(review).toBeDisabled();
  release();
  await expect(
    page.getByRole("status").filter({ hasText: "Trending settings saved" }),
  ).toBeVisible();
  await page.unroute("**/admin/trending-settings");
  expect(writes).toBe(2);
  const evidence = db("discovery-action-evidence", { accountId: user.account.id });
  expect(evidence.setting.value.recentHours).toBe(7);
  expect(evidence.audits).toHaveLength(1);
  expect(evidence.audits[0].reason).toBe("Review recent activity window");
  db("seed-observed-recommendations"); // Synthetic E2E exposure, not production telemetry.
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: "Inspect recent sample", exact: true }).click();
  await expect(page.getByText("Records with attributed events", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Missing attribution is not a zero outcome.", { exact: false }),
  ).toBeVisible();
  await page.route("**/admin/trending-settings", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: "UNAVAILABLE", message: "Trending configuration unavailable" } },
    }),
  );
  await page.getByRole("button", { name: "Reload saved settings", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Trending configuration unavailable" }),
  ).toBeVisible();
  await expect(review).not.toBeVisible();
  await page.unroute("**/admin/trending-settings");
  await page.getByRole("button", { name: "Reload saved settings", exact: true }).click();
  await expect(recent).toHaveValue("7");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().addCookies([{ name: "ayin_locale", value: "ar", url: WEB }]);
  await page.reload();
  await page.getByLabel("نافذة النشاط الحديث (ساعات)", { exact: true }).fill("8");
  await page.getByLabel("سبب التغيير", { exact: true }).fill("مراجعة نافذة النشاط");
  await page.getByRole("button", { name: "مراجعة تغييرات الرائج", exact: true }).click();
  const arabic = page.getByRole("dialog", { name: "تأكيد تغييرات الرائج", exact: true });
  await expect(arabic).toHaveAttribute("dir", "rtl");
  const box = await arabic.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.context().clearCookies();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Trending settings", exact: true }),
  ).not.toBeVisible();
  expect((await page.request.get(`${API}/admin/trending-settings`)).status()).toBe(401);
});
