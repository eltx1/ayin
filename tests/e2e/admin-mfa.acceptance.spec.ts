import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { generateTotpCode, totpCounter } from "../../apps/api/src/auth/totp.js";

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

test.beforeAll(() => db("reset"));

test("administrator password login requires TOTP enrollment and subsequent MFA challenge", async ({
  page,
}) => {
  const registration = await page.request.post(`${API}/auth/register`, {
    data: { name: "Browser MFA Admin", email, password },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBeTruthy();
  const identity = (await registration.json()) as { user: { account: { id: string } } };
  db("grant-admin", { accountId: identity.user.account.id });
  await page.request.post(`${API}/auth/logout`, { headers: { origin: WEB } });

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Secure your admin account" })).toBeVisible();
  await expect(page.getByAltText("AYIN authenticator setup QR code")).toBeVisible();

  await page.getByText("Cannot scan the QR code?").click();
  const secret = (await page.locator("details code").textContent())?.trim();
  expect(secret).toBeTruthy();
  await page.getByLabel("Authentication code").fill(generateTotpCode(secret!, totpCounter()));
  await page.getByRole("button", { name: "Enable MFA" }).click();
  await expect(page.getByRole("heading", { name: "Save your recovery codes" })).toBeVisible();
  await expect(page.getByLabel("Recovery codes").locator("li")).toHaveCount(10);
  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(page).toHaveURL("/");

  await page.getByRole("button", { name: "Log out" }).click();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
  await page
    .getByLabel("Authentication or recovery code")
    .fill(generateTotpCode(secret!, totpCounter() + 1n));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL("/");
});
