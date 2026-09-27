import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { generateTotpCode, totpCounter } from "../../apps/api/src/auth/totp.js";
import { enrollMfa } from "./mfa-helper";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
const password = "strong-pass-123";

function db(command: string, payload: Record<string, unknown> = {}) {
  execFileSync(
    process.execPath,
    [path.resolve("tests/e2e/db-helper.mjs"), command, JSON.stringify(payload)],
    { env: process.env },
  );
}

test("admin verification clears secrets, handles failure and verifies through the real MFA API", async ({
  page,
}) => {
  db("reset");
  const registration = await page.request.post(`${API}/auth/register`, {
    data: { name: "Verification Admin", email: "verification@e2e.ayin.test", password },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBeTruthy();
  const identity = (await registration.json()) as { user: { account: { id: string } } };
  const { secret } = await enrollMfa(page.request);
  db("grant-admin", { accountId: identity.user.account.id });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  const trigger = page.getByRole("button", { name: "Verify session", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Confirm your identity" });
  await expect(dialog.getByLabel("Password", { exact: true })).toBeFocused();
  await dialog.getByLabel("Password", { exact: true }).fill(password);
  await dialog.getByLabel("Authenticator code").fill("123456");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog.getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("Authenticator code")).toHaveValue("");
  await dialog.getByLabel("Password", { exact: true }).fill("incorrect-password");
  await dialog.getByLabel("Authenticator code").fill(generateTotpCode(secret, totpCounter() + 1n));
  await dialog.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Password", { exact: true })).toHaveValue("");
  await dialog.getByLabel("Password", { exact: true }).fill(password);
  await dialog.getByLabel("Authenticator code").fill(generateTotpCode(secret, totpCounter() + 1n));
  await dialog.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Session verified. Review and submit your action again." }),
  ).toBeVisible();

  await page.context().addCookies([{ name: "ayin_locale", value: "ar", url: WEB }]);
  await page.reload();
  await page.getByRole("button", { name: "إعادة التحقق", exact: true }).click();
  const arabicDialog = page.getByRole("dialog", { name: "تأكيد هويتك" });
  await expect(arabicDialog).toHaveAttribute("dir", "rtl");
  await expect(arabicDialog.getByLabel("رمز تطبيق المصادقة")).toHaveAttribute("dir", "ltr");
  const bounds = await arabicDialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await arabicDialog.getByRole("button", { name: "إلغاء", exact: true }).click();
});
