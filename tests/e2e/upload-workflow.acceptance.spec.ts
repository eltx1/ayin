import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
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
  const url = new URL(
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "http://invalid",
  );
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("ayin_e2e"))
    throw new Error("Upload workflow requires isolated local ayin_e2e");
  db("reset");
});
async function setup(page: Page, locale = "en") {
  const registration = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: {
      name: "Workflow creator",
      email: "upload-workflow@e2e.ayin.test",
      password: "strong-pass-123",
    },
  });
  expect(registration.ok()).toBe(true);
  await page.route("https://e2e-upload.invalid/**", (route) =>
    route.fulfill({
      status: route.request().method() === "OPTIONS" ? 204 : 200,
      body: "",
      headers: {
        "access-control-allow-origin": WEB,
        "access-control-allow-methods": "PUT,OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-expose-headers": "etag",
        etag: '"workflow-object"',
      },
    }),
  );
  await page.goto(`${locale === "ar" ? "/ar" : ""}/upload?lang=${locale}`);
  const picker = page.locator('input[type="file"][accept^="video/"]');
  // The streamed server tree and hydrated tree can briefly overlap. Require
  // one actual picker before exercising it; never select the first duplicate.
  await expect(picker).toHaveCount(1);
  await expect(picker).toBeEnabled();
}
async function uploadReady(page: Page, locale = "en") {
  const draftResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith("/creator/videos/drafts"),
  );
  await page
    .locator('input[type="file"][accept^="video/"]')
    .setInputFiles({ name: "workflow.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(1024) });
  const draft = await (await draftResponse).json();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await expect
    .poll(() => db("find-video", { channelId: draft.video.channelId }).id)
    .toBe(draft.video.id);
  db("mark-media-ready", { videoId: draft.video.id });
  await expect(
    page.getByRole("button", {
      name: locale === "ar" ? "نشر الفيديو" : "Publish video",
      exact: true,
    }),
  ).toBeEnabled();
  return draft.video as { id: string; channelId: string };
}
for (const locale of ["en", "ar"]) {
  test(`owned upload serializes save/publish and keeps localized controls in ${locale}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, locale);
    const { id, channelId } = await uploadReady(page, locale);
    let patches = 0,
      publishes = 0,
      thumbnails = 0;
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url().endsWith(`/creator/videos/${id}`))
        patches++;
      if (request.method() === "POST" && request.url().endsWith(`/creator/videos/${id}/publish`))
        publishes++;
      if (request.url().includes("/thumbnail/authorize")) thumbnails++;
    });
    const title = page.getByLabel(locale === "ar" ? "العنوان" : "Title", { exact: true });
    await title.fill("Saved workflow title");
    await title.blur();
    expect(patches).toBe(0);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`${API}/creator/videos/${id}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await gate;
      await route.fulfill({ response });
    });
    const save = page.getByRole("button", {
      name: locale === "ar" ? "حفظ التفاصيل" : "Save details",
      exact: true,
    });
    const publish = page.getByRole("button", {
      name: locale === "ar" ? "نشر الفيديو" : "Publish video",
      exact: true,
    });
    try {
      await save.evaluate((button) => {
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
      });
      await expect(save).toBeDisabled();
      await expect(publish).toBeDisabled();
      await expect(title).toBeDisabled();
      await expect.poll(() => patches).toBe(1);
      expect(publishes).toBe(0);
    } finally {
      release();
    }
    await expect(
      page.getByText(locale === "ar" ? "تم حفظ تفاصيل الفيديو." : "Video details saved.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByText(locale === "ar" ? "إعدادات إضافية" : "Advanced settings", { exact: true })
      .click();
    await page
      .locator('input[type="file"][accept^="image/"]')
      .setInputFiles({ name: "bad.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
    await expect(
      page.getByText(
        locale === "ar"
          ? "اختر صورة JPG أو PNG بحجم لا يتجاوز ٥ ميجابايت."
          : "Choose a JPG or PNG thumbnail up to 5 MB.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(thumbnails).toBe(0);
    await title.fill("Published workflow title");
    const cancelNavigation = (dialog: import("@playwright/test").Dialog) => dialog.dismiss();
    page.once("dialog", cancelNavigation);
    await page
      .getByRole("link", {
        name:
          locale === "ar"
            ? "مراجعة الفيديوهات المحفوظة في الاستوديو"
            : "Review saved uploads in Studio",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/upload/);
    await expect(title).toHaveValue("Published workflow title");
    await expect(page.getByRole("main")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`design-upload-workflow-390-${locale}.png`),
      fullPage: true,
    });
    await publish.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect(page).toHaveURL(locale === "ar" ? /\/ar\/watch\// : /\/watch\//);
    expect(publishes).toBe(1);
    expect(patches).toBe(1);
    expect(db("find-video", { channelId }).status).toBe("PUBLISHED");
  });
}
test("a committed root response loss retains the file without creating another draft", async ({
  page,
}) => {
  await setup(page);
  let roots = 0,
    savedId = "",
    savedChannel = "";
  await page.route(`${API}/creator/videos/drafts`, async (route) => {
    roots++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const draft = (await response.json()).video;
    savedId = draft.id;
    savedChannel = draft.channelId;
    await route.abort("failed");
  });
  await page
    .locator('input[type="file"][accept^="video/"]')
    .setInputFiles({ name: "workflow.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(1024) });
  await expect(
    page.getByText(
      "Upload could not be confirmed. Review your saved uploads in Studio before starting again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator('input[type="file"][accept^="video/"]')).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Review saved uploads in Studio", exact: true }),
  ).toHaveAttribute("href", "/studio/content");
  expect(roots).toBe(1);
  expect(db("find-video", { channelId: savedChannel }).id).toBe(savedId);
});
test("a foreign publication acknowledgment leaves the committed video reviewable without replay", async ({
  page,
}) => {
  await setup(page);
  const { id, channelId } = await uploadReady(page);
  let publishes = 0;
  await page.route(`${API}/creator/videos/${id}/publish`, async (route) => {
    publishes++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, video: { ...body.video, id: "22222222-2222-4222-8222-222222222222" } },
    });
  });
  const publish = page.getByRole("button", { name: "Publish video", exact: true });
  await publish.click();
  await expect(
    page.getByText(
      "Publication could not be confirmed. Review this video's status in Studio before publishing again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(publish).toBeDisabled();
  await expect(page).toHaveURL(/\/upload/);
  expect(publishes).toBe(1);
  expect(db("find-video", { channelId }).status).toBe("PUBLISHED");
});
