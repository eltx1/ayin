import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:3001";
const DB_HELPER = path.resolve(process.cwd(), "tests/e2e/db-helper.mjs");

function resetDatabase() {
  execFileSync(process.execPath, [DB_HELPER, "reset", "{}"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
}

test.beforeAll(resetDatabase);

test("Account privacy can download data and control a deletion request", async ({ page }) => {
  const email = "browser-privacy@e2e.ayin.test";
  const password = "strong-pass-123";
  const registration = await page.request.post(`${API}/auth/register`, {
    data: { name: "Browser Privacy", email, password },
    headers: { origin: "http://127.0.0.1:3000" },
  });
  expect(registration.ok()).toBeTruthy();

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Privacy & data" })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my data" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^ayin-data-export.*\.json$/);
  await expect(page.getByText("Your AYIN data export was prepared for download.")).toBeVisible();

  await page.getByLabel("Current password", { exact: true }).last().fill(password);
  await page.getByLabel("Type DELETE MY AYIN ACCOUNT").fill("DELETE MY AYIN ACCOUNT");
  await page.getByRole("button", { name: "Request account deletion" }).click();
  await expect(
    page.getByText("Account deletion requested. You can cancel during the grace period."),
  ).toBeVisible();
  await expect(page.getByText("REQUESTED", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel deletion" })).toBeVisible();

  await page.getByRole("button", { name: "Cancel deletion" }).click();
  await expect(page.getByText("Deletion request cancelled.")).toBeVisible();
  await expect(page.getByText("CANCELLED", { exact: true })).toBeVisible();
});
