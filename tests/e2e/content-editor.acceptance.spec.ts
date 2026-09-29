import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, request, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
const endpoint = `${API}/creator/studio/content`;
// Only this intentionally intercepted network suite blocks workers.
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "https://invalid.test");
  if (
    process.env.APP_ENV !== "test" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.pathname !== "/ayin_e2e" ||
    (process.env.DATABASE_URL && process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
  )
    throw new Error("Content fixtures require the isolated local ayin_e2e database");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});

async function seed(page: Page) {
  const registration = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: {
      name: "Content Editor Creator",
      email: "content-editor@e2e.ayin.test",
      password: "strong-pass-123",
    },
  });
  expect(registration.ok()).toBe(true);
  const identity = await registration.json();
  const ids: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const response = await page.request.post(`${API}/creator/videos/drafts`, {
      headers: { origin: WEB },
      data: {
        channelId: identity.user.channel.id,
        title: `Editor video ${i}`,
        sizeBytes: 1024 * 1024,
        mimeType: "video/mp4",
        durationMs: 60_000,
      },
    });
    expect(response.ok()).toBe(true);
    ids.push((await response.json()).video.id);
  }
  return ids;
}

async function openFirst(page: Page, title = "Editor video 0") {
  await page
    .getByRole("row", { name: new RegExp(title) })
    .getByRole("button", { name: "Edit video" })
    .click();
  await expect(page.getByRole("region", { name: "Video editor", exact: true })).toBeVisible();
}
const failure = {
  status: 503,
  headers: { "access-control-allow-origin": WEB, "access-control-allow-credentials": "true" },
  json: { error: { message: "Isolated failure" } },
};
async function noOverflow(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}

test("one focused editor preserves drafts across accessible tabs and confirms before leaving", async ({
  page,
}, info) => {
  await seed(page);
  let captionReads = 0;
  await page.route(`${API}/creator/studio/videos/*/captions`, async (route) => {
    captionReads += 1;
    await route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/studio/content?lang=en");
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(4);
  await expect(page.locator("input[id='content-title']")).toHaveCount(0);
  expect(captionReads).toBe(0);
  await page.screenshot({ path: info.outputPath("design-content-list-1440.png"), fullPage: true });
  await openFirst(page);
  await expect(page.getByLabel("Title", { exact: true })).toHaveCount(1);
  await page.getByLabel("Title", { exact: true }).fill("Unsaved title");
  const details = page.getByRole("tab", { name: "Details", exact: true });
  await details.focus();
  await page.keyboard.press("ArrowRight");
  const advanced = page.getByRole("tab", { name: "Advanced metadata", exact: true });
  await expect(advanced).toBeFocused();
  await expect(details).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(advanced).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Advanced metadata" })).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Captions & subtitles", exact: true })).toBeFocused();
  await details.click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Unsaved title");
  expect(captionReads).toBe(0);
  await expect(page.getByRole("button", { name: "Remove video", exact: true })).toBeDisabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Back to videos" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Unsaved title");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator("aside a[href='/upload']").click();
  await expect(page).toHaveURL(/\/studio\/content\?lang=en$/);
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("design-content-editor-1440.png"),
    fullPage: true,
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Back to videos" }).click();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(4);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar/studio/content?lang=ar");
  await page
    .getByRole("row", { name: /Editor video 0/ })
    .getByRole("button", { name: "تعديل الفيديو" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const rtlDetails = page.getByRole("tab", { name: "التفاصيل", exact: true });
  await rtlDetails.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "البيانات المتقدمة", exact: true })).toBeFocused();
  await expect(rtlDetails).toHaveAttribute("aria-selected", "true");
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("design-content-editor-390-ar.png"),
    fullPage: true,
  });
});

test("saved changes are not reported as failed when refresh fails and lost writes are never replayed", async ({
  page,
}) => {
  const [videoId] = await seed(page);
  let failGet = true;
  let writes = 0;
  let loseResponse = false;
  let unlock: (() => void) | undefined;
  let writing: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const started = new Promise<void>((resolve) => {
    writing = resolve;
  });
  await page.route(`${endpoint}*`, async (route) => {
    if (failGet) return route.fulfill(failure);
    await route.continue();
  });
  await page.goto("/studio/content?lang=en");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("could not be loaded");
  await expect(page.getByText("No videos match these filters.")).toHaveCount(0);
  failGet = false;
  await page.getByRole("button", { name: "Reload videos" }).click();
  await openFirst(page);
  await page.route(`${API}/creator/studio/videos/${videoId}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    writes += 1;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (loseResponse) return route.abort("failed");
    writing?.();
    await held;
    await route.fulfill({ response });
  });
  await page.getByLabel("Title", { exact: true }).fill("Saved first title");
  const save = page.getByRole("button", { name: "Save changes", exact: true });
  await save.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await started;
  await expect(page.getByLabel("Title", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Back to videos" })).toBeDisabled();
  expect(writes).toBe(1);
  failGet = true;
  unlock?.();
  await expect(
    page.getByText("Your changes were saved. The library is being refreshed."),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("could not be loaded");
  expect(writes).toBe(1);
  failGet = false;
  await page.getByRole("button", { name: "Reload videos" }).click();
  await openFirst(page, "Saved first title");
  loseResponse = true;
  await page.getByLabel("Title", { exact: true }).fill("Saved despite response loss");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "could not confirm the complete update",
  );
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Saved despite response loss",
  );
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
  expect(writes).toBe(2);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Back to videos" }).click();
  await expect(page.getByRole("row", { name: /Saved despite response loss/ })).toBeVisible();
  expect(writes).toBe(2);
});

test("caption activity stays scoped to one editor and removal keeps server ownership", async ({
  page,
}) => {
  const [videoId] = await seed(page);
  let reads = 0;
  let unlock: (() => void) | undefined;
  let writing: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const started = new Promise<void>((resolve) => {
    writing = resolve;
  });
  await page.route(`${API}/creator/studio/videos/${videoId}/captions`, async (route) => {
    reads += 1;
    writing?.();
    await held;
    await route.continue();
  });
  await page.goto("/studio/content?lang=en");
  await openFirst(page);
  await page.getByRole("tab", { name: "Captions & subtitles", exact: true }).click();
  await page.getByRole("tabpanel", { name: "Captions & subtitles" }).locator("summary").click();
  await started;
  await expect(page.getByRole("button", { name: "Back to videos" })).toBeDisabled();
  unlock?.();
  await expect(page.getByText("No caption tracks yet.")).toBeVisible();
  expect(reads).toBe(1);
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByRole("tab", { name: "Captions & subtitles", exact: true }).click();
  expect(reads).toBe(1);
  const other = await request.newContext({ baseURL: API, extraHTTPHeaders: { origin: WEB } });
  try {
    const response = await other.post("/auth/register", {
      data: {
        name: "Other Creator",
        email: "other-content@e2e.ayin.test",
        password: "strong-pass-123",
      },
    });
    expect(response.ok()).toBe(true);
    expect(
      (
        await other.patch(`/creator/studio/videos/${videoId}`, { data: { title: "Forbidden" } })
      ).status(),
    ).toBe(404);
    expect((await other.delete(`/creator/studio/videos/${videoId}`)).status()).toBe(404);
  } finally {
    await other.dispose();
  }
  let deletes = 0;
  await page.route(`${API}/creator/studio/videos/${videoId}`, async (route) => {
    if (route.request().method() === "DELETE") deletes += 1;
    await route.continue();
  });
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Remove video", exact: true }).click();
  expect(deletes).toBe(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Remove video", exact: true }).click();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(3);
  expect(deletes).toBe(1);
  await page.getByLabel("Status", { exact: true }).selectOption("REMOVED");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await openFirst(page);
  await expect(page.getByText("This video is removed and cannot be edited here.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove video", exact: true })).toBeDisabled();
});
