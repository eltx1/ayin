import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { generateTotpCode, totpCounter } from "../../apps/api/src/auth/totp.js";
import { enrollMfa } from "./mfa-helper";

const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000",
  password = "strong-pass-123";
test.use({ serviceWorkers: "block" });
function db(command: string, payload: Record<string, unknown> = {}) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/db-helper.mjs"), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (
    process.env.APP_ENV !== "test" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.pathname !== "/ayin_e2e"
  )
    throw Error("Requires isolated test database");
  db("reset");
});
const mfa = (page: Page) =>
  page.getByRole("region", { name: "Two-step verification", exact: true });
const recovery = (page: Page) => page.getByRole("region", { name: "Account review", exact: true });
async function prepare(page: Page, label: string) {
  const email = label + "@mfa-disable-recovery.e2e.test";
  const response = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: { name: label, email, password },
  });
  expect(response.status()).toBe(201);
  const accountId = (await response.json()).user.account.id as string;
  const enrollment = await enrollMfa(page.request);
  await page.goto("/account");
  await expect(mfa(page).getByText("Two-step verification is on", { exact: true })).toBeVisible();
  await mfa(page)
    .getByRole("button", { name: "Turn off two-step verification", exact: true })
    .click();
  await mfa(page).getByLabel("Current password", { exact: true }).fill(password);
  await mfa(page)
    .getByLabel("Authentication code", { exact: true })
    .fill(generateTotpCode(enrollment.secret, totpCounter() + 1n));
  return { accountId, email };
}
const confirm = (page: Page) =>
  mfa(page).getByRole("button", { name: "Confirm and sign out", exact: true }).click();
const disableAudits = (accountId: string) =>
  db("account-mfa-evidence", { accountId }).audits.filter(
    (row: { action: string }) => row.action === "auth.mfa_disabled",
  );

test("an invalid HTTP 200 disable acknowledgment freezes the whole account without claiming logout or replaying", async ({
  page,
}) => {
  const { accountId } = await prepare(page, "mfa-invalid-ack");
  const sibling = page.locator('[name="newPassword"]');
  await sibling.fill("private-sibling-draft-456");
  const captured = await sibling.elementHandle();
  if (!captured) throw Error("Missing actual sibling password input");
  let writes = 0;
  await page.route(API + "/auth/mfa/disable", async (route) => {
    writes++;
    expect(route.request().headers()["x-ayin-expected-account"]).toBe(accountId);
    expect(route.request().postDataJSON().expectedAccountId).toBe(accountId);
    await route.fulfill({ status: 200, json: {} });
  });
  await confirm(page);
  await expect(recovery(page)).toBeVisible();
  await expect(page.locator("[data-private-account-workspace]")).toHaveCount(0);
  await expect(page).toHaveURL("/account");
  expect(
    await captured.evaluate((node) => {
      if (!(node instanceof HTMLInputElement)) throw Error("Expected a password input");
      return { value: node.value, defaultValue: node.defaultValue };
    }),
  ).toEqual({ value: "", defaultValue: "" });
  expect(db("account-mfa-evidence", { accountId }).credential.status).toBe("ENABLED");
  expect(disableAudits(accountId)).toHaveLength(0);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(recovery(page)).toBeVisible();
  await recovery(page).getByRole("button", { name: "Read current account", exact: true }).click();
  await expect(mfa(page).getByText("Two-step verification is on", { exact: true })).toBeVisible();
  await expect(
    mfa(page).getByRole("button", { name: "Confirm and sign out", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('[name="newPassword"]')).toHaveValue("");
  expect(writes).toBe(1);
  expect(disableAudits(accountId)).toHaveLength(0);
});

test("a committed disable with a lost HTTP 500 response conceals the account and recovers by reads without replay", async ({
  page,
}) => {
  const { accountId, email } = await prepare(page, "mfa-lost-committed-disable");
  let writes = 0;
  await page.route(API + "/auth/mfa/disable", async (route) => {
    writes++;
    expect(route.request().headers()["x-ayin-expected-account"]).toBe(accountId);
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ disabled: true });
    await route.fulfill({
      response,
      status: 500,
      json: { error: { code: "UNAVAILABLE", message: "Controlled lost response" } },
    });
  });
  await confirm(page);
  await expect(recovery(page)).toBeVisible();
  await expect(page.locator("[data-private-account-workspace]")).toHaveCount(0);
  await expect(page).toHaveURL("/account");
  expect(db("account-mfa-evidence", { accountId })).toMatchObject({
    credential: null,
    activeSessions: 0,
  });
  expect(disableAudits(accountId)).toHaveLength(1);
  expect((await page.request.get(API + "/auth/me")).status()).toBe(401);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await recovery(page).getByRole("button", { name: "Read current account", exact: true }).click();
  await expect(recovery(page)).toBeVisible();
  await expect(
    recovery(page).getByRole("button", { name: "Read current account", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("[data-private-account-workspace]")).toHaveCount(0);
  const login = await page.request.post(API + "/auth/login", {
    headers: { origin: WEB },
    data: { email, password },
  });
  expect(login.status()).toBe(200);
  await recovery(page).getByRole("button", { name: "Read current account", exact: true }).click();
  await expect(mfa(page).getByText("Two-step verification is off", { exact: true })).toBeVisible();
  expect(writes).toBe(1);
  expect(disableAudits(accountId)).toHaveLength(1);
});

test("a rejected disable factor remains retryable only after a fresh protected account status read", async ({
  page,
}) => {
  const { accountId } = await prepare(page, "mfa-disable-rejected-factor");
  await mfa(page).getByLabel("Current password", { exact: true }).fill("incorrect-password-456");
  let writes = 0,
    rejected = false,
    reviewedStatus = 0;
  await page.route(API + "/auth/mfa/disable", async (route) => {
    writes++;
    const response = await route.fetch();
    expect(response.status()).toBe(401);
    rejected = true;
    await route.fulfill({ response });
  });
  await page.route(API + "/auth/mfa/status", async (route) => {
    if (rejected) {
      reviewedStatus++;
      expect(route.request().headers()["x-ayin-expected-account"]).toBe(accountId);
    }
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.fulfill({ response });
  });
  await confirm(page);
  await expect(mfa(page).getByRole("alert")).toBeVisible();
  await expect(
    mfa(page).getByRole("button", { name: "Confirm and sign out", exact: true }),
  ).toBeEnabled();
  await expect(mfa(page).getByLabel("Current password", { exact: true })).toHaveValue("");
  await expect(mfa(page).getByLabel("Authentication code", { exact: true })).toHaveValue("");
  expect(reviewedStatus).toBeGreaterThanOrEqual(1);
  expect(writes).toBe(1);
  expect(db("account-mfa-evidence", { accountId }).credential.status).toBe("ENABLED");
  expect(disableAudits(accountId)).toHaveLength(0);
});

test("an actual mid-flow administrator policy rejection refreshes status and removes the invalid disable form", async ({
  page,
}) => {
  const { accountId } = await prepare(page, "mfa-disable-policy-change");
  // The user opened the review while disabling was allowed. The server policy changes now.
  db("grant-admin", { accountId });
  let writes = 0,
    rejected = false,
    reviewedStatus = 0;
  await page.route(API + "/auth/mfa/disable", async (route) => {
    writes++;
    expect(route.request().headers()["x-ayin-expected-account"]).toBe(accountId);
    const response = await route.fetch();
    expect(response.status()).toBe(409);
    expect((await response.json()).error.code).toBe("MFA_REQUIRED_BY_POLICY");
    rejected = true;
    await route.fulfill({ response });
  });
  await page.route(API + "/auth/mfa/status", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (rejected) {
      reviewedStatus++;
      expect(route.request().headers()["x-ayin-expected-account"]).toBe(accountId);
      expect(await response.json()).toMatchObject({ accountId, enabled: true, required: true });
    }
    await route.fulfill({ response });
  });
  await confirm(page);
  await expect(mfa(page).getByRole("alert")).toContainText("administrator role requires");
  await expect(
    mfa(page).getByRole("button", { name: "Confirm and sign out", exact: true }),
  ).toHaveCount(0);
  await expect(
    mfa(page).getByRole("button", { name: "Turn off two-step verification", exact: true }),
  ).toHaveCount(0);
  await expect(mfa(page).getByText("Two-step verification is on", { exact: true })).toBeVisible();
  await expect(
    mfa(page).getByRole("button", { name: "Replace recovery codes", exact: true }),
  ).toBeEnabled();
  expect(reviewedStatus).toBeGreaterThanOrEqual(1);
  expect(writes).toBe(1);
  expect(db("account-mfa-evidence", { accountId }).credential.status).toBe("ENABLED");
  expect(disableAudits(accountId)).toHaveLength(0);
});
