import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { generateTotpCode, totpCounter } from "../../apps/api/src/auth/totp.js";
import { enrollMfa } from "./mfa-helper";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
const DB_HELPER = path.resolve(process.cwd(), "tests/e2e/db-helper.mjs");
const email = "browser-mfa-admin@e2e.ayin.test";
const password = "strong-pass-123";

function db(command: string, payload: Record<string, unknown> = {}) {
  execFileSync(process.execPath, [DB_HELPER, command, JSON.stringify(payload)], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
}

test.beforeEach(() => db("reset"));

async function prepareAdmin(page: Page, enabled = false) {
  const registration = await page.request.post(`${API}/auth/register`, {
    data: { name: "Browser MFA Admin", email, password },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBeTruthy();
  const identity = await registration.json();
  db("grant-admin", { accountId: identity.user.account.id });
  const factor = enabled ? await enrollMfa(page.request) : undefined;
  await page.request.post(`${API}/auth/logout`, { headers: { origin: WEB } });
  await page.goto("/login");
  return factor;
}

async function signIn(page: Page) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("administrator signs in without forced setup and can explicitly enable MFA from account settings", async ({
  page,
}) => {
  await prepareAdmin(page);
  await signIn(page);
  await expect(page).toHaveURL("/");
  await page.goto("/admin/operations");
  await expect(
    page.getByRole("heading", { name: "Capacity, reliability & unit economics" }),
  ).toBeVisible();
  await page.goto("/account");
  const region = page.getByRole("region", { name: "Two-step verification", exact: true });
  await expect(
    region.getByText(/Two-step verification is optional, including for administrators/),
  ).toBeVisible();
  await region.getByRole("button", { name: "Set up two-step verification", exact: true }).click();
  await region.getByLabel("Current password", { exact: true }).fill(password);
  await region.getByRole("button", { name: "Continue to setup", exact: true }).click();
  await region.getByText("Cannot scan the QR code?").click();
  const secret = (await region.locator("details code").textContent())!.trim();
  await region
    .getByLabel("Authentication code", { exact: true })
    .fill(generateTotpCode(secret, totpCounter()));
  await region.getByRole("button", { name: "Enable MFA", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Save your recovery codes" })).toBeVisible();
  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(
    region.getByRole("button", { name: "Turn off two-step verification", exact: true }),
  ).toBeVisible();

  await page.request.post(`${API}/auth/logout`, { headers: { origin: WEB } });
  await page.goto("/login");
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
  await page
    .getByLabel("Authentication or recovery code")
    .fill(generateTotpCode(secret, totpCounter() + 1n));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/admin/operations");
  await expect(
    page.getByRole("heading", { name: "Capacity, reliability & unit economics" }),
  ).toBeVisible();
});

test("administrator can abandon optional enrollment and still sign in normally", async ({
  page,
}) => {
  await prepareAdmin(page);
  await signIn(page);
  await expect(page).toHaveURL("/");
  await page.goto("/account");
  const region = page.getByRole("region", { name: "Two-step verification", exact: true });
  await region.getByRole("button", { name: "Set up two-step verification", exact: true }).click();
  await region.getByLabel("Current password", { exact: true }).fill(password);
  await region.getByRole("button", { name: "Continue to setup", exact: true }).click();
  await expect(region.getByLabel("Authentication code", { exact: true })).toBeVisible();
  await region.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.request.post(`${API}/auth/logout`, { headers: { origin: WEB } });
  await page.goto("/login");
  await signIn(page);
  await expect(page).toHaveURL("/");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
});

test("enabled MFA keeps incorrect codes retryable and accepts the next valid code", async ({
  page,
}) => {
  const factor = await prepareAdmin(page, true);
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
  await page
    .getByLabel("Authentication or recovery code")
    .fill(generateTotpCode(factor!.secret, totpCounter() - 5n));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.locator('form [role="alert"]')).toContainText("invalid");
  await expect(page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
  await page
    .getByLabel("Authentication or recovery code")
    .fill(generateTotpCode(factor!.secret, totpCounter() + 1n));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL("/");
});

test("expires an enabled MFA challenge on mobile resume and offers a fresh sign-in", async ({
  page,
}) => {
  await prepareAdmin(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`${API}/auth/login`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });
  });
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
  await page.clock.setFixedTime(Date.now() + 120_000);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.locator('form [role="alert"]')).toContainText(
    "expired or was already completed",
  );
  await expect(page.getByLabel("Authentication or recovery code")).toHaveCount(0);
});
