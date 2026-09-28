import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { enrollMfa } from "./mfa-helper.js";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
const helper = path.resolve("tests/e2e/db-helper.mjs");

function db(command: string, payload: Record<string, unknown> = {}) {
  execFileSync(process.execPath, [helper, command, JSON.stringify(payload)], { env: process.env });
}

test("workspace dialogs remain operable across mobile and desktop breakpoints", async ({
  page,
}, testInfo) => {
  db("reset");
  const response = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Navigation Resize Admin",
      email: "navigation-resize@e2e.ayin.test",
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  expect(response.ok()).toBe(true);
  const identity = (await response.json()) as { user: { account: { id: string } } };
  await enrollMfa(page.request);
  db("grant-admin", { accountId: identity.user.account.id });

  const workspaces = [
    {
      name: "studio",
      route: "/studio/content?lang=en",
      trigger: "Open Studio navigation",
      close: "Close navigation",
      aria: "Creator Studio",
      destination: "/studio/playlists",
    },
    {
      name: "admin",
      route: "/ar/admin/content?lang=ar",
      trigger: "فتح قائمة الإدارة",
      close: "إغلاق التنقّل",
      aria: "إدارة AYIN",
      destination: "/ar/admin/videos",
    },
  ];
  for (const workspace of workspaces) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(workspace.route);
    await page.getByRole("button", { name: workspace.trigger, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(`a[href="${workspace.destination}"]`)).toBeVisible();
    await dialog.getByRole("button", { name: workspace.close, exact: true }).focus();
    // Verify reverse as well as forward wrap; background links are never targets.
    for (const key of ["Shift+Tab", "Tab", "Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    // Hiding a modal's ancestor would hide the dialog while the page stays inert.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(dialog).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`navigation-${workspace.name}-open-after-resize.png`),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: workspace.close, exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const navigation = page.getByRole("navigation", { name: workspace.aria, exact: true });
    await expect(navigation).toHaveCount(1);
    await navigation.locator(`a[href="${workspace.destination}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${workspace.destination}$`));
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("main")).toBeVisible();
  }
});
