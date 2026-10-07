import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";
import { generateTotpCode, totpCounter } from "../../apps/api/src/auth/totp.js";

const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
function run(file: string, command: string, payload = {}) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve(`tests/e2e/${file}.mjs`), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
const fixture = (command: string, payload = {}) =>
  run("product-controls-fixture", command, payload);
async function setup(page: Page) {
  run("db-helper", "reset");
  fixture("reset");
  const registration = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Product operator",
      email: "product-controls@e2e.ayin.test",
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBeTruthy();
  const { user } = await registration.json();
  const { secret } = await enrollMfa(page.request);
  run("db-helper", "grant-operator-role", { accountId: user.account.id, role: "OPERATIONS" });
  return { ...fixture("seed"), accountId: user.account.id, secret };
}
test.afterEach(() => fixture("reset"));

for (const locale of ["en", "ar"] as const) {
  test(`product controls preserve keyboard focus when removing at the 100-category cap on ${locale}`, async ({
    page,
  }) => {
    const f = await setup(page);
    const ar = locale === "ar";
    await page.route(`${API}/admin/product-controls`, async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      const snapshot = await response.json();
      snapshot.controls.taxonomy = Array.from({ length: 100 }, (_, index) => ({
        key: `boundary-category-${index + 1}`,
        label: `Category ${index + 1}`,
        enabled: true,
      }));
      await route.fulfill({ response, json: snapshot });
    });
    await page.goto(`${ar ? "/ar" : ""}/admin/product-controls`);
    const taxonomy = page.getByRole("region", { name: ar ? "التصنيفات" : "Taxonomy", exact: true });
    const add = taxonomy.getByRole("button", {
      name: ar ? "إضافة تصنيف" : "Add category",
      exact: true,
    });
    const last = taxonomy.getByRole("group", {
      name: ar ? "التصنيف 100" : "Category 100",
      exact: true,
    });
    const remove = last.getByRole("button", {
      name: ar ? "إزالة التصنيف 100" : "Remove category 100",
      exact: true,
    });
    await expect(add).toBeDisabled();
    await remove.focus();
    await page.keyboard.press("Enter");
    await expect(taxonomy.getByRole("group")).toHaveCount(99);
    await expect(add).toBeEnabled();
    await expect(add).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(taxonomy.getByRole("group")).toHaveCount(100);
    await expect(last.getByRole("textbox")).toBeFocused();
    await expect(add).toBeDisabled();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(remove).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(add).toBeFocused();
    expect(fixture("evidence", f).audits).toHaveLength(0);
  });

  test(`product controls retain multilingual drafts and save exact settings on ${locale} mobile`, async ({
    page,
  }, testInfo) => {
    const f = await setup(page);
    const ar = locale === "ar";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${ar ? "/ar" : ""}/admin/product-controls`);
    const taxonomy = page.getByRole("region", { name: ar ? "التصنيفات" : "Taxonomy", exact: true });
    const first = taxonomy.getByRole("group", {
      name: ar ? "التصنيف 1" : "Category 1",
      exact: true,
    });
    const category = first.getByLabel(ar ? "اسم التصنيف" : "Category label", { exact: true });
    await expect(category).toHaveValue("قصص، ثقافة");
    await expect(
      first.getByLabel(ar ? "التصنيف مفعّل" : "Category enabled", { exact: true }),
    ).not.toBeChecked();
    await category.fill("");
    await expect(first).toContainText("stories-original");
    await category.fill("  حكايات عربية، وثقافة  ");
    const announcement = page.getByLabel(ar ? "نص الإعلان" : "Announcement text", { exact: true });
    await announcement.fill("مرحبًا بكم في AYIN");
    await page.getByLabel(ar ? "إظهار الإعلان" : "Show announcement", { exact: true }).check();
    await page
      .getByLabel(ar ? "رابط الإعلان (اختياري)" : "Announcement link (optional)", { exact: true })
      .fill("/tv");
    const mobile = page.getByLabel(ar ? "التنقل على الهاتف" : "Mobile navigation", { exact: true });
    await expect(mobile).not.toBeChecked();
    await mobile.check();
    const regionForm = page.getByRole("form", { name: f.row.title, exact: true });
    const regions = regionForm.getByRole("textbox");
    await regions.fill("de، jp، de");
    await regions.press("Enter");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: ar ? "تم حفظ المناطق" : "Regional targets saved." }),
    ).toBeVisible();
    await expect(regions).toHaveValue("DE, JP");
    await expect(category).toHaveValue("  حكايات عربية، وثقافة  ");
    await expect(announcement).toHaveValue("مرحبًا بكم في AYIN");
    expect(fixture("evidence", f).audits).toHaveLength(0);
    await taxonomy
      .getByRole("button", { name: ar ? "إضافة تصنيف" : "Add category", exact: true })
      .click();
    const third = taxonomy.getByRole("group", {
      name: ar ? "التصنيف 3" : "Category 3",
      exact: true,
    });
    await expect(third.getByRole("textbox")).toBeFocused();
    await third.getByRole("textbox").fill("الفنون");
    // Continue from the inserted field using native keyboard order, then repeat
    // Add/Remove to prove focus follows the committed row rather than Category 1.
    await page.keyboard.press("Tab");
    await expect(
      third.getByRole("checkbox", { name: ar ? "التصنيف مفعّل" : "Category enabled" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      third.getByRole("button", { name: ar ? "إزالة التصنيف 3" : "Remove category 3" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    const addCategory = taxonomy.getByRole("button", {
      name: ar ? "إضافة تصنيف" : "Add category",
      exact: true,
    });
    await expect(addCategory).toBeFocused();
    await page.keyboard.press("Enter");
    const fourth = taxonomy.getByRole("group", {
      name: ar ? "التصنيف 4" : "Category 4",
      exact: true,
    });
    await expect(fourth.getByRole("textbox")).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(
      fourth.getByRole("button", { name: ar ? "إزالة التصنيف 4" : "Remove category 4" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(fourth).toHaveCount(0);
    await expect(addCategory).toBeFocused();
    await expect(third.getByRole("textbox")).toHaveValue("الفنون");
    await page
      .getByRole("button", {
        name: ar ? "حفظ الإعدادات العامة" : "Save global controls",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("status").filter({
        hasText: ar ? "تم تحديث إعدادات المنتج العامة." : "Global product controls updated.",
      }),
    ).toBeVisible();
    const evidence = fixture("evidence", f);
    expect(evidence.controls.taxonomy).toEqual([
      { key: "stories-original", label: "حكايات عربية، وثقافة", enabled: false },
      f.controls.taxonomy[1],
      { key: "category-1", label: "الفنون", enabled: true },
    ]);
    expect(evidence.controls.announcement).toEqual({
      enabled: true,
      text: "مرحبًا بكم في AYIN",
      href: "/tv",
    });
    expect(evidence.controls.deviceVisibility).toEqual({ web: true, mobile: true, tv: true });
    expect(evidence.audits).toHaveLength(1);
    expect(
      evidence.row.regionTargets.map((item: { regionCode: string }) => item.regionCode).sort(),
    ).toEqual(["DE", "JP"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await taxonomy.screenshot({ path: testInfo.outputPath(`taxonomy-${locale}-mobile.png`) });
    await regionForm.screenshot({ path: testInfo.outputPath(`regions-${locale}-mobile.png`) });
  });
}

test("global step-up keeps every draft and requires a fresh reviewed save", async ({ page }) => {
  const f = await setup(page);
  const cookie = (await page.context().cookies()).find((item) => item.value.startsWith("v1."))!;
  const payload = JSON.parse(Buffer.from(cookie.value.split(".")[1]!, "base64url").toString());
  payload.reauthAt = Math.floor(Date.now() / 1000) - 600;
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", "task-29-e2e-auth-secret-with-more-than-32-characters")
    .update(encoded)
    .digest("base64url");
  await page.context().addCookies([{ ...cookie, value: `v1.${encoded}.${signature}` }]);
  await page.goto("/admin/product-controls");
  const announcement = page.getByLabel("Announcement text", { exact: true });
  await announcement.fill("Review this retained draft");
  const label = page
    .getByRole("group", { name: "Category 1", exact: true })
    .getByLabel("Category label", { exact: true });
  await label.fill("مسودة محفوظة");
  const save = page.getByRole("button", { name: "Save global controls", exact: true });
  await save.click();
  const dialog = page.getByRole("dialog", { name: "Confirm your identity", exact: true });
  await expect(dialog).toBeVisible();
  expect(fixture("evidence", f).audits).toHaveLength(0);
  await dialog.getByLabel("Password", { exact: true }).fill("strong-pass-123");
  await dialog
    .getByLabel("Authenticator code")
    .fill(generateTotpCode(f.secret, totpCounter() + 1n));
  await dialog.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(announcement).toHaveValue("Review this retained draft");
  await expect(label).toHaveValue("مسودة محفوظة");
  expect(fixture("evidence", f).audits).toHaveLength(0);
  await save.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Global product controls updated." }),
  ).toBeVisible();
  expect(fixture("evidence", f).audits).toHaveLength(1);
});

test("generic 400 and malformed 2xx after a real commit remain unconfirmed without replay", async ({
  page,
}) => {
  const f = await setup(page);
  await page.goto("/admin/product-controls");
  const announcement = page.getByLabel("Announcement text", { exact: true });
  const save = page.getByRole("button", { name: "Save global controls", exact: true });
  let writes = 0;
  for (const status of [400, 200]) {
    await announcement.fill(`Unconfirmed result ${status}`);
    await page.route(`${API}/admin/product-controls/global`, async (route) => {
      writes++;
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.fulfill({
        status,
        json:
          status === 400
            ? { error: { code: "UNKNOWN", message: "Response replaced after commit" } }
            : { ok: true },
      });
    });
    await save.click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "The change could not be confirmed. Your draft is preserved." }),
    ).toBeVisible();
    await expect(announcement).toHaveValue(`Unconfirmed result ${status}`);
    await expect(
      page.getByRole("status").filter({ hasText: "Global product controls updated." }),
    ).toHaveCount(0);
    expect(fixture("evidence", f).audits).toHaveLength(writes);
    expect(fixture("evidence", f).controls.announcement.text).toBe(`Unconfirmed result ${status}`);
    await page.unroute(`${API}/admin/product-controls/global`);
  }
  expect(writes).toBe(2);
});

test("revoked scope conceals non-merchandising drafts before any write", async ({ page }) => {
  const f = await setup(page);
  await page.goto("/admin/product-controls");
  await page.getByLabel("Announcement text", { exact: true }).fill("Private pending announcement");
  const label = page
    .getByRole("group", { name: "Category 1", exact: true })
    .getByLabel("Category label", { exact: true });
  await label.fill("تصنيف خاص غير محفوظ");
  fixture("revoke", f);
  await page.getByRole("button", { name: "Save global controls", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Product controls could not be loaded." }),
  ).toBeVisible();
  await expect(page.getByLabel("Announcement text", { exact: true })).toHaveCount(0);
  await expect(page.getByText("تصنيف خاص غير محفوظ", { exact: true })).toHaveCount(0);
  expect(fixture("evidence", f).audits).toHaveLength(0);
});

test("invalid fields block writes and only explicit removal deletes a taxonomy entry", async ({
  page,
}) => {
  const f = await setup(page);
  await page.goto("/admin/product-controls");
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().endsWith("/admin/product-controls/global"))
      writes++;
  });
  const save = page.getByRole("button", { name: "Save global controls", exact: true });
  const announcement = page.getByLabel("Announcement text", { exact: true });
  await page.getByLabel("Show announcement", { exact: true }).check();
  await save.click();
  await expect(announcement).toBeFocused();
  await announcement.fill("Reviewed announcement");
  const link = page.getByLabel("Announcement link (optional)", { exact: true });
  await link.fill("//external.example");
  await save.click();
  await expect(link).toBeFocused();
  await expect(link).toHaveAttribute("aria-invalid", "true");
  await link.fill("/tv");
  const first = page.getByRole("group", { name: "Category 1", exact: true });
  const label = first.getByLabel("Category label", { exact: true });
  await label.fill("");
  await save.click();
  await expect(label).toBeFocused();
  await expect(first).toContainText("stories-original");
  expect(fixture("evidence", f).controls.taxonomy).toEqual(f.controls.taxonomy);
  expect(writes).toBe(0);
  await label.fill("New label, same identifier");
  await page.getByRole("button", { name: "Remove category 2", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add category", exact: true })).toBeFocused();
  await save.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Global product controls updated." }),
  ).toBeVisible();
  expect(fixture("evidence", f).controls.taxonomy).toEqual([
    { key: "stories-original", label: "New label, same identifier", enabled: false },
  ]);
  expect(writes).toBe(1);
});
