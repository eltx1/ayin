import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

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

test.beforeEach(() => db("reset"));

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
  await expect(page.getByAltText("Secure your admin account")).toBeVisible();

  await page.getByText("Cannot scan the QR code?").click();
  const secret = (await page.locator("details code").textContent())?.trim();
  expect(secret).toBeTruthy();
  await page.getByLabel("Authentication code").fill(generateTotpCode(secret!, totpCounter()));
  await page.getByRole("button", { name: "Enable MFA" }).click();
  await expect(page.getByRole("heading", { name: "Save your recovery codes" })).toBeVisible();
  await expect(page.getByLabel("Save your recovery codes").locator("li")).toHaveCount(10);
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

  await page.goto("/admin/operations");
  await expect(
    page.getByRole("heading", { name: "Capacity, reliability & unit economics" }),
  ).toBeVisible();
  await expect(page.getByText("Provider invoices fetched:")).toBeVisible();
});

async function prepareAdmin(page: Page) {
  const registration = await page.request.post(`${API}/auth/register`, {
    data: { name: "Browser MFA Admin", email, password },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBeTruthy();
  const identity = await registration.json();
  db("grant-admin", { accountId: identity.user.account.id });
  await page.request.post(`${API}/auth/logout`, { headers: { origin: WEB } });
  await page.goto("/login");
}

async function signIn(page: Page) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("recovers when enrollment commits but its response is lost, then permits admin sign-in", async ({
  page,
}) => {
  await prepareAdmin(page);
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Secure your admin account" })).toBeVisible();
  await page.getByText("Cannot scan the QR code?").click();
  const secret = (await page.locator("details code").textContent())!.trim();
  let completions = 0;
  await page.route(`${API}/auth/mfa/enrollment/verify`, async (route) => {
    const response = await route.fetch();
    if (++completions === 1) {
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else {
      expect(response.status()).toBe(401);
      await route.fulfill({ response });
    }
  });
  await page
    .getByLabel("Authentication code", { exact: true })
    .fill(generateTotpCode(secret, totpCounter()));
  await page.getByRole("button", { name: "Enable MFA" }).click();
  await expect(page.getByRole("alert")).toContainText("server response could not be confirmed");
  await page
    .getByLabel("Authentication code", { exact: true })
    .fill(generateTotpCode(secret, totpCounter()));
  await page.getByRole("button", { name: "Enable MFA" }).click();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("expired or was already completed");
  await expect(page.locator("details code")).toHaveCount(0);
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

test("failed enrollment start stays on the password form and can be retried", async ({ page }) => {
  await prepareAdmin(page);
  await page.route(
    `${API}/auth/mfa/enrollment/start`,
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Temporary setup failure" } }),
      }),
    { times: 1 },
  );
  await signIn(page);
  await expect(page.getByRole("alert")).toHaveText("Temporary setup failure");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Authentication or recovery code")).toHaveCount(0);
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Secure your admin account" })).toBeVisible();
  await page.getByRole("button", { name: "Start sign-in again" }).click();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.locator("details code")).toHaveCount(0);
});

test("expires stale enrollment on mobile resume and keeps incorrect codes retryable", async ({
  page,
}) => {
  await prepareAdmin(page);
  await page.route(`${API}/auth/mfa/enrollment/start`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });
  });
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Secure your admin account" })).toBeVisible();
  await page.route(`${API}/auth/mfa/enrollment/verify`, (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "UNAUTHORIZED", message: "The authentication code is invalid." },
      }),
    }),
  );
  await page.getByLabel("Authentication code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Enable MFA" }).click();
  await expect(page.getByRole("alert")).toHaveText("The authentication code is invalid.");
  await expect(page.getByRole("heading", { name: "Secure your admin account" })).toBeVisible();
  await page.clock.setFixedTime(Date.now() + 120_000);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("expired or was already completed");
  await expect(page.locator("details code")).toHaveCount(0);
});
