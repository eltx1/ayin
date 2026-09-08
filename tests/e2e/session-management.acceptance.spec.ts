import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
const DB_HELPER = path.resolve(process.cwd(), "tests/e2e/db-helper.mjs");

function resetDatabase() {
  execFileSync(process.execPath, [DB_HELPER, "reset", "{}"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
}

test.beforeAll(resetDatabase);

test("Account security shows and revokes another active session", async ({ page, request }) => {
  const email = "browser-sessions@e2e.ayin.test";
  const password = "strong-pass-123";
  const registration = await page.request.post(`${API}/auth/register`, {
    data: { name: "Browser Sessions", email, password },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBeTruthy();

  const otherLogin = await request.post(`${API}/auth/login`, {
    data: { email, password },
    headers: { origin: WEB, "x-ayin-auth-transport": "bearer" },
  });
  expect(otherLogin.ok()).toBeTruthy();
  const otherToken = ((await otherLogin.json()) as { sessionToken: string }).sessionToken;

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Security & sessions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current session" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Other active sessions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke", exact: true })).toHaveCount(1);

  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(page.getByText("Session revoked.")).toBeVisible();
  await expect(page.getByText("No other active sessions.")).toBeVisible();

  const rejected = await request.get(`${API}/auth/me`, {
    headers: { authorization: `Bearer ${otherToken}` },
  });
  expect(rejected.status()).toBe(401);
});
