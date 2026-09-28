import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { generateTotpCode, totpCounter } from "../../apps/api/src/auth/totp.js";
import { enrollMfa } from "./mfa-helper";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
function db(command: string, payload: Record<string, unknown> = {}) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/db-helper.mjs"), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
test.afterEach(() => db("reset-merchandising-workspace"));
test("merchandising retries once, preserves unrelated drafts, requires step-up and audits only the reviewed save", async ({
  page,
}) => {
  db("reset");
  db("reset-merchandising-workspace");
  const { rows } = db("seed-merchandising-workspace");
  const registration = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Merchandising operator",
      email: "merch-workspace@e2e.ayin.test",
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBeTruthy();
  const { user } = await registration.json();
  const { secret } = await enrollMfa(page.request);
  db("grant-operator-role", { accountId: user.account.id, role: "OPERATIONS" });
  const cookie = (await page.context().cookies()).find((item) => item.value.startsWith("v1."))!;
  const payload = JSON.parse(Buffer.from(cookie.value.split(".")[1], "base64url").toString());
  payload.reauthAt = Math.floor(Date.now() / 1000) - 600;
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", "task-29-e2e-auth-secret-with-more-than-32-characters")
    .update(encoded)
    .digest("base64url");
  await page.context().addCookies([{ ...cookie, value: `v1.${encoded}.${signature}` }]);
  const snapshotUrl = `${API}/admin/product-controls`;
  let reads = 0,
    writes = 0;
  page.on("request", (request) => {
    if (request.url() === snapshotUrl && request.method() === "GET") reads++;
    if (request.url().includes("/admin/product-controls/") && request.method() !== "GET") writes++;
  });
  await page.route(snapshotUrl, (route) =>
    route.fulfill({ status: 503, json: { message: "Temporary snapshot failure" } }),
  );
  await page.goto("/admin/product-controls");
  await expect(
    page.getByRole("alert").filter({ hasText: "Product controls could not be loaded." }),
  ).toBeVisible();
  await expect(page.getByText("Loading product controls…", { exact: true })).not.toBeVisible();
  expect(reads).toBe(1);
  await page.unroute(snapshotUrl);
  await page.getByRole("button", { name: "Retry product controls", exact: true }).click();
  const regions = page.getByRole("region", { name: "Regional merchandising", exact: true });
  await expect(regions).toBeVisible();
  expect(reads).toBe(2);
  expect((await page.request.get(snapshotUrl)).headers()["cache-control"]).toBe(
    "private, no-store",
  );
  const title = page.getByLabel("e2e-merch-one title", { exact: true });
  const other = page.getByLabel("e2e-merch-two title", { exact: true });
  const target = regions.getByLabel("e2e-merch-one target regions", { exact: true });
  await title.fill("Preserved same-row draft");
  await other.fill("Preserved other-row draft");
  const announcement = page.getByPlaceholder("Platform announcement", { exact: true });
  await announcement.fill("Preserved global draft");
  await page.getByLabel("Audit reason", { exact: true }).fill("Review DE and JP targeting");
  const save = target
    .locator("xpath=ancestor::tr")
    .getByRole("button", { name: "Save regions", exact: true });
  await target.fill("invalid");
  await save.click();
  await expect(page.getByRole("alert")).toHaveText(
    "Use up to 64 two-letter country codes, separated by commas or spaces.",
  );
  expect(writes).toBe(0);
  await target.fill("de, jp, de");
  await target.focus();
  await page.keyboard.press("Tab");
  await expect(save).toBeFocused();
  await page.keyboard.press("Enter");
  const verification = page.getByRole("dialog", { name: "Confirm your identity", exact: true });
  await expect(verification).toBeVisible();
  expect(db("merchandising-evidence", { accountId: user.account.id }).audits).toHaveLength(0);
  await verification.getByLabel("Password", { exact: true }).fill("strong-pass-123");
  await verification
    .getByLabel("Authenticator code")
    .fill(generateTotpCode(secret, totpCounter() + 1n));
  await verification.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(verification).not.toBeVisible();
  expect(writes).toBe(1);
  await expect(target).toHaveValue("de, jp, de");
  await expect(title).toHaveValue("Preserved same-row draft");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${snapshotUrl}/home-rows/${rows[0].id}`, async (route) => {
    await pending;
    await route.continue();
  });
  await save.click();
  await expect(target).toBeDisabled();
  await expect(title).toBeDisabled();
  await expect(save).toBeDisabled();
  release();
  await expect(
    page.getByRole("status").filter({ hasText: "Regional targets saved." }),
  ).toBeVisible();
  await expect(target).toHaveValue("DE, JP");
  await expect(title).toHaveValue("Preserved same-row draft");
  await expect(other).toHaveValue("Preserved other-row draft");
  await expect(announcement).toHaveValue("Preserved global draft");
  expect(reads).toBe(2);
  expect(writes).toBe(2);
  const evidence = db("merchandising-evidence", { accountId: user.account.id });
  expect(evidence.rows[0].title).toBe("e2e-merch-one");
  expect(
    evidence.rows[0].regionTargets.map((item: { regionCode: string }) => item.regionCode).sort(),
  ).toEqual(["DE", "JP"]);
  expect(evidence.audits).toHaveLength(1);
  expect(evidence.audits[0].reason).toBe("Review DE and JP targeting");
  await page.unroute(`${snapshotUrl}/home-rows/${rows[0].id}`);
  await page.route(`${snapshotUrl}/home-rows/${rows[0].id}`, (route) => route.abort("failed"));
  await target.fill("BR");
  await save.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(target).toHaveValue("BR");
  await expect(other).toHaveValue("Preserved other-row draft");
  expect(db("merchandising-evidence", { accountId: user.account.id }).audits).toHaveLength(1);
});

test("merchandising exposes Arabic recovery and empty states without unauthorized controls", async ({
  page,
}) => {
  db("reset");
  db("reset-merchandising-workspace");
  const registration = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Regional operator",
      email: "merch-ar@e2e.ayin.test",
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  const { user } = await registration.json();
  await enrollMfa(page.request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar/admin/product-controls");
  await expect(
    page.getByRole("alert").filter({ hasText: "تعذر تحميل إعدادات المنتج." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "عرض المحتوى حسب المنطقة", exact: true }),
  ).not.toBeVisible();
  expect((await page.request.get(`${API}/admin/product-controls`)).status()).toBe(403);
  db("grant-operator-role", { accountId: user.account.id, role: "OPERATIONS" });
  // Synthetic empty rows isolate the UI state without deleting the seeded catalog configuration.
  await page.route(`${API}/admin/product-controls`, async (route) => {
    const response = await route.fetch();
    const snapshot = await response.json();
    await route.fulfill({ response, json: { ...snapshot, rows: [] } });
  });
  await page.getByRole("button", { name: "إعادة تحميل إعدادات المنتج", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "عرض المحتوى حسب المنطقة", exact: true })
      .getByText("لا توجد صفوف مُعدّة للصفحة الرئيسية.", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
