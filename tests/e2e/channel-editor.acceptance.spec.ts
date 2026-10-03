import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
    throw Error("Requires isolated local ayin_e2e");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
async function register(page: Page, email: string) {
  const result = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: { name: "Channel Creator", email, password: "strong-pass-123" },
  });
  expect(result.ok()).toBe(true);
  return (await result.json()).user;
}
for (const locale of ["en", "ar"] as const)
  test(`owned channel identity and accessible images save real metadata ${locale}`, async ({
    page,
  }, testInfo) => {
    const user = await register(page, `channel-editor-${locale}@e2e.ayin.test`),
      ar = locale === "ar";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(ar ? "/ar/studio/channel" : "/studio/channel?lang=en");
    const main = page.getByRole("main"),
      name = main.getByLabel(ar ? "اسم القناة" : "Channel name", { exact: true });
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(
      ar ? "إعدادات القناة" : "Channel settings",
    );
    await expect(name).toHaveValue(user.channel.name);
    await name.fill(ar ? "قناة عين المحفوظة" : "Saved Ayin channel");
    await main
      .getByLabel(ar ? "المعرّف" : "Handle", { exact: true })
      .fill(`saved-channel-${locale}`);
    await main
      .getByLabel(ar ? "نبذة" : "About", { exact: true })
      .fill("Actual saved channel description");
    await main
      .getByRole("button", { name: ar ? "حفظ القناة" : "Save channel", exact: true })
      .click();
    await expect(main.getByRole("status")).toContainText(
      ar ? "حُفظت تغييرات القناة" : "Channel changes saved",
    );
    const actual = await (
      await page.request.get(`${API}/creator/channels/${user.channel.id}`)
    ).json();
    expect(actual.channel.handle).toBe(`saved-channel-${locale}`);
    expect(actual.channel.description).toBe("Actual saved channel description");
    const redirect = await (
      await page.request.get(`${API}/public/channels/${user.channel.handle}`)
    ).json();
    expect(redirect.canonicalHandle).toBe(`saved-channel-${locale}`);
    const avatar = main.getByLabel(ar ? "الصورة الشخصية" : "Avatar", { exact: false });
    await avatar.focus();
    await expect(avatar).toBeFocused();
    await avatar.setInputFiles({
      name: "unsafe.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from("<svg/>"),
    });
    await expect(main.getByRole("status")).toContainText(ar ? "اختر JPG" : "Choose JPG");
    await expect(
      main.getByRole("button", {
        name: ar ? "رفع الصورة المختارة" : "Upload selected image",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`design-channel-editor-390-${locale}.png`),
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(ar ? "/ar/channel/edit" : "/channel/edit?lang=en");
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByLabel(ar ? "اسم القناة" : "Channel name", { exact: true })).toHaveValue(
      actual.channel.name,
    );
    await page.screenshot({
      path: testInfo.outputPath(`design-channel-editor-1440-${locale}.png`),
      fullPage: true,
    });
  });
test("committed metadata loss retains draft and requires explicit read review without replay", async ({
  page,
}) => {
  const user = await register(page, "channel-loss@e2e.ayin.test"),
    endpoint = `${API}/creator/channels/${user.channel.id}`;
  let reads = 0,
    writes = 0;
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "GET") {
      reads++;
      await route.continue();
      return;
    }
    if (route.request().method() === "PATCH") {
      writes++;
      const committed = await route.fetch();
      expect(committed.ok()).toBe(true);
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await page.goto("/studio/channel?lang=en");
  const main = page.getByRole("main"),
    name = main.getByLabel("Channel name", { exact: true }),
    save = main.getByRole("button", { name: "Save channel", exact: true });
  await expect(name).toHaveValue(user.channel.name);
  const before = reads;
  await name.fill("Committed identity");
  await save.click();
  await expect(main.getByRole("alert")).toContainText("The change may already have been saved");
  await expect(name).toHaveValue("Committed identity");
  await expect(save).toBeDisabled();
  expect(writes).toBe(1);
  expect(reads).toBe(before);
  await main.getByRole("button", { name: "Review current channel", exact: true }).click();
  await expect(main.getByRole("region", { name: "Current saved identity" })).toContainText(
    "Committed identity",
  );
  await expect(save).toBeDisabled();
  expect(writes).toBe(1);
  await main.getByRole("button", { name: "I have reviewed the result", exact: true }).click();
  await name.fill("Unsent retained draft");
  await expect(save).toBeEnabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Back to AYIN", exact: true }).click();
  await expect(name).toHaveValue("Unsent retained draft");
  expect(writes).toBe(1);
});
test("bounded read failure hides server snapshots and uncertain asset completion is not replayed", async ({
  page,
}) => {
  const user = await register(page, "channel-image@e2e.ayin.test"),
    endpoint = `${API}/creator/channels/${user.channel.id}`;
  let authorizations = 0,
    completions = 0,
    puts = 0,
    known = "";
  await page.route(`${endpoint}/assets/authorize`, async (route) => {
    authorizations++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    known = (await response.json()).assetId;
    await route.fulfill({ response });
  });
  await page.route("https://e2e-upload.invalid/**", async (route) => {
    puts++;
    expect(route.request().method()).toBe("PUT");
    expect(route.request().headers().cookie).toBeUndefined();
    await route.fulfill({ status: 200, headers: { "access-control-allow-origin": WEB } });
  });
  await page.route(`${endpoint}/assets/complete`, async (route) => {
    completions++;
    expect(route.request().postDataJSON().assetId).toBe(known);
    await route.continue();
  });
  await page.goto("/studio/channel?lang=en");
  const main = page.getByRole("main");
  await expect(main.getByLabel("Channel name", { exact: true })).toHaveValue(user.channel.name);
  await main
    .getByLabel("Avatar", { exact: false })
    .setInputFiles({ name: "retained.png", mimeType: "image/png", buffer: Buffer.alloc(1024) });
  await main.getByRole("button", { name: "Upload selected image", exact: true }).click();
  // The existing isolated adapter reports video/mp4 object metadata, so the real completion rejects PNG. This tests a partial upload, not production storage success.
  await expect(main.getByRole("alert")).toContainText("The change may already have been saved");
  expect(authorizations).toBe(1);
  expect(puts).toBe(1);
  expect(completions).toBe(1);
  await expect(main.getByText("retained.png", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Review current channel", exact: true }).click();
  await expect(
    main.getByText("The selected image has not been confirmed as applied.", { exact: false }),
  ).toBeVisible();
  expect(authorizations).toBe(1);
  expect(completions).toBe(1);
  await page.route(endpoint, async (route) => {
    await route.fulfill({
      status: 503,
      json: { error: { message: "operator diagnostic must not leak" } },
    });
  });
  await main.getByRole("button", { name: "Refresh channel", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("Your channel could not be loaded");
  await expect(main.getByRole("region", { name: "Current saved identity" })).toHaveCount(0);
  await expect(main.getByText("operator diagnostic must not leak", { exact: false })).toHaveCount(
    0,
  );
});
