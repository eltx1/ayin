import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { generateTotpCode, totpCounter } from "../../apps/api/src/auth/totp.js";
import { enrollMfa } from "./mfa-helper";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
const password = "strong-pass-123";
test.use({ serviceWorkers: "block" });
function requireIsolatedDatabase() {
  const url = new URL(
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "http://invalid",
  );
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
    throw new Error("Mobile acceptance requires isolated local ayin_e2e");
}
function db(command: string, payload: Record<string, unknown> = {}) {
  requireIsolatedDatabase();
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/db-helper.mjs"), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
function resetMobileConfiguration() {
  requireIsolatedDatabase();
  // Narrow fixture reset only in the same real test DB used by the existing E2E helpers.
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { createPrismaClient } from './packages/db/dist/index.js';
    const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error('Missing acceptance database');
    const db = createPrismaClient(url);
    try { await db.platformSetting.deleteMany({where: {namespace:'PLATFORM',key:'mobileRuntimeConfigV1'}}); }
    finally { await db.$disconnect(); }
  `,
    ],
    { env: process.env },
  );
}
test.afterEach(() => resetMobileConfiguration());

test("mobile administration keeps delivery off, verifies safe persisted settings and rejects non-admin access", async ({
  page,
}) => {
  db("reset");
  resetMobileConfiguration();
  expect((await page.request.get(API + "/admin/mobile/config")).status()).toBe(401);
  const registration = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: { name: "Mobile acceptance owner", email: "mobile-admin@e2e.ayin.test", password },
  });
  expect(registration.ok()).toBe(true);
  const { user } = await registration.json();
  expect((await page.request.get(API + "/admin/mobile/config")).status()).toBe(403);
  await page.goto("/admin/mobile?lang=en");
  await page.getByRole("button", { name: "Read settings and readiness", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Advertising and analytics", exact: true }),
  ).not.toBeVisible();
  const { secret } = await enrollMfa(page.request);
  db("grant-operator-role", { accountId: user.account.id, role: "SUPERADMIN" });
  await page.goto("/admin/mobile?lang=en");
  await page.getByRole("button", { name: "Verify session", exact: true }).click();
  const verification = page.getByRole("dialog", { name: "Confirm your identity" });
  await verification.getByLabel("Password", { exact: true }).fill(password);
  await verification
    .getByLabel("Authenticator code")
    .fill(generateTotpCode(secret, totpCounter() + 1n));
  await verification.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(verification).not.toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Session verified. Review and submit your action again." }),
  ).toBeVisible();

  const readiness = await page.request.get(API + "/admin/mobile/status");
  expect(readiness.ok()).toBe(true);
  expect(await readiness.json()).toMatchObject({
    credentialsConfigured: false,
    workerEnabled: false,
    transport: "fcm-http-v1",
  });
  await page.getByRole("button", { name: "Read settings and readiness", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Advertising and analytics", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Enable app ads", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("Test ads only", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Enable notifications", { exact: true })).not.toBeChecked();
  await expect(
    page.getByLabel("Permit optional analytics (requires user consent)", { exact: true }),
  ).not.toBeChecked();
  await expect(page.getByRole("button", { name: /broadcast|send to all/i })).toHaveCount(0);
  const before = await (await page.request.get(API + "/admin/mobile/config")).json();
  expect(before.ads.platforms).toMatchObject({
    android: { enabled: false },
    ios: { enabled: false },
  });
  await page.getByRole("link", { name: "App ads", exact: true }).click();
  await page.getByRole("button", { name: "Read settings and readiness", exact: true }).click();
  await page
    .getByRole("button", { name: "Use Google Ad Manager test units (android)", exact: true })
    .click();
  await expect(page.getByLabel("android bannerUnitId", { exact: true })).toHaveValue(
    "/21775744923/example/adaptive-banner",
  );
  await expect(page.getByLabel("Enable app ads", { exact: true })).not.toBeChecked();
  const reason = "Local mobile release acceptance; all delivery remains disabled";
  await page.getByLabel("requestTimeoutMs", { exact: true }).fill("12000");
  await page.getByLabel("Reason for the change / notification", { exact: true }).fill(reason);
  await page.getByLabel("android bannerUnitId", { exact: true }).fill("https://example.com/vast");
  await expect(
    page.getByRole("button", { name: "Save configuration", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("android bannerUnitId", { exact: true })
    .fill("/21775744923/example/adaptive-banner");
  const saveResponse = page.waitForResponse(
    (response) =>
      response.url() === API + "/admin/mobile/config" && response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save configuration", exact: true }).click();
  expect((await saveResponse).status()).toBe(200);
  await expect(
    page.getByRole("status").filter({ hasText: "Configuration saved and read back." }),
  ).toBeVisible();
  const after = await (await page.request.get(API + "/admin/mobile/config")).json();
  expect(after).toEqual({
    ...before,
    ads: {
      ...before.ads,
      requestTimeoutMs: 12000,
      platforms: {
        ...before.ads.platforms,
        android: {
          ...before.ads.platforms.android,
          bannerUnitId: "/21775744923/example/adaptive-banner",
          interstitialUnitId: "/21775744923/example/interstitial",
        },
      },
    },
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Verify session", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Read settings and readiness", exact: true }).click();
  await expect(page.getByLabel("requestTimeoutMs", { exact: true })).toHaveValue("12000");

  await expect(page.getByLabel("android bannerUnitId", { exact: true })).toHaveValue(
    "/21775744923/example/adaptive-banner",
  );

  // Exercise the real local send endpoint with global delivery OFF. No provider request or
  // fabricated FCM success is involved, and only this controlled account is targeted.
  await page.getByLabel("Reason for the change / notification", { exact: true }).fill(reason);
  await page.getByLabel("Account ID", { exact: true }).fill(user.account.id);
  await page.getByLabel("Title", { exact: true }).fill("Local acceptance only");
  await page
    .getByLabel("Message", { exact: true })
    .fill("Delivery must stay disabled in this test.");
  const rejectedPush = page.waitForResponse(
    (response) =>
      response.url() === API + "/admin/mobile/push" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send to this account", exact: true }).click();
  const rejection = await rejectedPush;
  expect(rejection.status()).toBe(503);
  expect(rejection.request().postDataJSON()).toMatchObject({
    accountId: user.account.id,
    destination: { kind: "notifications" },
    title: "Local acceptance only",
  });
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Request not confirmed. Read current settings before retrying." }),
  ).toBeVisible();
  expect(
    await (
      await page.request.get(API + "/admin/mobile/deliveries?accountId=" + user.account.id)
    ).json(),
  ).toEqual([]);
});
