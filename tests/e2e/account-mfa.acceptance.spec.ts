import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { generateTotpCode, totpCounter } from "../../apps/api/src/auth/totp.js";
import { enrollMfa } from "./mfa-helper";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
const password = "strong-pass-123";
function db(command: string, payload: Record<string, unknown> = {}) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/db-helper.mjs"), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
async function register(page: Page, name: string) {
  const response = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: { name, email: `${name}@account-mfa.e2e.test`, password },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).user.account.id as string;
}
test.beforeEach(() => db("reset"));

test("account enrollment and reviewed code replacement preserve one-time secrets and revoke old sessions", async ({
  page,
  request,
}) => {
  const accountId = await register(page, "account-mfa-enroll");
  const second = await request.post(`${API}/auth/login`, {
    headers: { origin: WEB, "x-ayin-auth-transport": "bearer" },
    data: { email: "account-mfa-enroll@account-mfa.e2e.test", password },
  });
  const oldSession = (await second.json()).sessionToken as string;
  let statusReads = 0;
  page.on("request", (request) => {
    if (request.url() === `${API}/auth/mfa/status` && request.method() === "GET") statusReads += 1;
  });
  await page.goto("/account");
  const region = page.getByRole("region", { name: "Two-step verification", exact: true });
  await expect(region.getByText("Two-step verification is off", { exact: true })).toBeVisible();
  expect(statusReads).toBe(1);
  await region.getByRole("button", { name: "Set up two-step verification", exact: true }).click();
  await region.getByLabel("Current password", { exact: true }).fill(password);
  await region.getByRole("button", { name: "Continue to setup", exact: true }).click();
  await expect(region.getByAltText("Two-step verification", { exact: true })).toBeVisible();
  await region.getByText("Cannot scan the QR code?", { exact: true }).click();
  const secret = (await region.locator("details code").textContent())!.trim();
  await region
    .getByLabel("Authentication code", { exact: true })
    .fill(generateTotpCode(secret, totpCounter()));
  const confirmResponse = page.waitForResponse(`${API}/auth/mfa/enrollment/verify-authenticated`);
  await region.getByRole("button", { name: "Enable MFA", exact: true }).click();
  expect((await confirmResponse).headers()["cache-control"]).toContain("no-store");
  const list = region.getByLabel("Save your recovery codes", { exact: true });
  await expect(list.locator("li")).toHaveCount(10);
  const oldCodes = await list.locator("li").allTextContents();
  await expect(region.locator("details code")).toHaveCount(0);
  expect(
    (
      await request.get(`${API}/auth/me`, { headers: { authorization: `Bearer ${oldSession}` } })
    ).status(),
  ).toBe(401);
  await expect(page.getByText("No other active sessions.", { exact: true })).toBeVisible();
  await region.getByRole("button", { name: "I have saved these codes", exact: true }).click();
  await region.getByRole("button", { name: "Replace recovery codes", exact: true }).click();
  await expect(region.getByText(/All existing recovery codes will stop working/)).toBeVisible();
  await region.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    db("account-mfa-evidence", { accountId }).audits.filter(
      (row: { action: string }) => row.action === "auth.mfa_recovery_codes_regenerated",
    ),
  ).toHaveLength(0);
  await region.getByRole("button", { name: "Replace recovery codes", exact: true }).click();
  await region.getByLabel("Current password", { exact: true }).fill(password);
  await region
    .getByLabel("Authentication code", { exact: true })
    .fill(generateTotpCode(secret, totpCounter() + 1n));
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  let replacements = 0;
  await page.route(`${API}/auth/mfa/recovery-codes/regenerate`, async (route) => {
    replacements += 1;
    await ready;
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  const replaceResponse = page.waitForResponse(`${API}/auth/mfa/recovery-codes/regenerate`);
  await region.getByRole("button", { name: "Confirm replacement", exact: true }).click();
  try {
    await expect(region.getByRole("button", { name: "Verifying…", exact: true })).toBeDisabled();
  } finally {
    release();
  }
  expect((await replaceResponse).headers()["cache-control"]).toContain("no-store");
  await expect(list.locator("li")).toHaveCount(10);
  expect(replacements).toBe(1);
  expect(await list.locator("li").allTextContents()).not.toEqual(oldCodes);
  await expect(region.getByText("10 recovery codes remaining", { exact: true })).toBeVisible();
  await page.route(`${API}/auth/mfa/status`, (route) =>
    route.fulfill({ status: 503, json: { error: { message: "Unavailable" } } }),
  );
  await region.getByRole("button", { name: "Refresh settings", exact: true }).click();
  await expect(region.getByText(/Verification settings could not be loaded/)).toBeVisible();
  await expect(list.locator("li")).toHaveCount(10);
  await page.unroute(`${API}/auth/mfa/status`);
  await region.getByRole("button", { name: "Retry settings", exact: true }).click();
  await expect(region.getByText("10 recovery codes remaining", { exact: true })).toBeVisible();
  expect(replacements).toBe(1);
  const login = await page.request.post(`${API}/auth/login`, {
    headers: { origin: WEB },
    data: { email: "account-mfa-enroll@account-mfa.e2e.test", password },
  });
  const rejected = await page.request.post(`${API}/auth/mfa/challenge`, {
    headers: { origin: WEB },
    data: { challengeToken: (await login.json()).challengeToken, recoveryCode: oldCodes[0] },
  });
  expect(rejected.status()).toBe(401);
  await page.goto("/");
  await page.goto("/account");
  await expect(region.getByText("Two-step verification is on", { exact: true })).toBeVisible();
  await expect(list).toHaveCount(0);
  const evidence = db("account-mfa-evidence", { accountId });
  expect(evidence.credential.status).toBe("ENABLED");
  expect(
    evidence.audits.filter((row: { action: string }) => row.action === "auth.mfa_enabled"),
  ).toHaveLength(1);
  expect(
    evidence.audits.filter(
      (row: { action: string }) => row.action === "auth.mfa_recovery_codes_regenerated",
    ),
  ).toHaveLength(1);
});

test("reviewed disable requires both factors and signs out every session", async ({
  page,
  request,
}) => {
  const accountId = await register(page, "account-mfa-disable");
  const enrolled = await enrollMfa(page.request);
  const login = await request.post(`${API}/auth/login`, {
    headers: { origin: WEB },
    data: { email: "account-mfa-disable@account-mfa.e2e.test", password },
  });
  const other = await request.post(`${API}/auth/mfa/challenge`, {
    headers: { origin: WEB, "x-ayin-auth-transport": "bearer" },
    data: {
      challengeToken: (await login.json()).challengeToken,
      recoveryCode: enrolled.recoveryCodes[0],
    },
  });
  expect(other.ok()).toBeTruthy();
  const token = (await other.json()).sessionToken;
  await page.goto("/account");
  const region = page.getByRole("region", { name: "Two-step verification", exact: true });
  await region.getByRole("button", { name: "Turn off two-step verification", exact: true }).click();
  await expect(region.getByText(/signs out every device, including this one/)).toBeVisible();
  await region.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(db("account-mfa-evidence", { accountId }).credential.status).toBe("ENABLED");
  await region.getByRole("button", { name: "Turn off two-step verification", exact: true }).click();
  await region.getByLabel("Current password", { exact: true }).fill(password);
  await region
    .getByLabel("Authentication code", { exact: true })
    .fill(generateTotpCode(enrolled.secret, totpCounter() + 1n));
  await region.getByRole("button", { name: "Confirm and sign out", exact: true }).click();
  await expect(page).toHaveURL("/login");
  expect((await page.request.get(`${API}/auth/mfa/status`)).status()).toBe(401);
  expect(
    (
      await request.get(`${API}/auth/me`, { headers: { authorization: `Bearer ${token}` } })
    ).status(),
  ).toBe(401);
  const evidence = db("account-mfa-evidence", { accountId });
  expect(evidence.credential).toBeNull();
  expect(evidence.activeSessions).toBe(0);
  expect(
    evidence.audits.filter((row: { action: string }) => row.action === "auth.mfa_disabled"),
  ).toHaveLength(1);
});

test("Arabic mobile account recovers failed status reads and honors administrator MFA policy", async ({
  page,
}) => {
  const accountId = await register(page, "account-mfa-admin");
  await enrollMfa(page.request);
  db("grant-admin", { accountId });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(
    `${API}/auth/mfa/status`,
    (route) => route.fulfill({ status: 503, json: { error: { message: "Unavailable" } } }),
    { times: 1 },
  );
  await page.goto("/ar/account");
  const region = page.getByRole("region", { name: "التحقق بخطوتين", exact: true });
  await expect(region.getByText(/تعذر تحميل إعدادات التحقق/)).toBeVisible();
  await region.getByRole("button", { name: "إعادة تحميل الإعدادات", exact: true }).click();
  await expect(region.getByText(/دورك الإداري يتطلب التحقق بخطوتين/)).toBeVisible();
  await expect(
    region.getByRole("button", { name: "إيقاف التحقق بخطوتين", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await region.getByRole("button", { name: "استبدال رموز الاسترداد", exact: true }).click();
  await expect(
    region.getByRole("heading", { name: "مراجعة تغيير الأمان", exact: true }),
  ).toBeFocused();
  await region.getByRole("button", { name: "إلغاء", exact: true }).click();
});

test("account switches clear setup secrets and require a fresh account workspace", async ({
  page,
}) => {
  await register(page, "account-mfa-before-switch");
  await page.goto("/account");
  const region = page.getByRole("region", { name: "Two-step verification", exact: true });
  await region.getByRole("button", { name: "Set up two-step verification", exact: true }).click();
  await region.getByLabel("Current password", { exact: true }).fill(password);
  await region.getByRole("button", { name: "Continue to setup", exact: true }).click();
  await expect(region.getByAltText("Two-step verification", { exact: true })).toBeVisible();
  await register(page, "account-mfa-after-switch");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(region.getByRole("button", { name: "Reload account", exact: true })).toBeVisible();
  await expect(region.getByAltText("Two-step verification", { exact: true })).toHaveCount(0);
  await expect(region.getByRole("button", { name: "Enable MFA", exact: true })).toHaveCount(0);
  await region.getByRole("button", { name: "Reload account", exact: true }).click();
  await expect(\n    page\n      .getByRole("region", { name: "Account identity" })\n      .getByText("account-mfa-after-switch", { exact: true }),\n  ).toBeVisible();
  await expect(region.getByText("Two-step verification is off", { exact: true })).toBeVisible();
});
