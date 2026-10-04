import { simulatedMultipartParts } from "./multipart-fixture.js";
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

async function seed(page: Page, publishFirst = false) {
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
        sizeBytes: publishFirst && i === 0 ? 70 * 1024 * 1024 : 1024 * 1024,
        mimeType: "video/mp4",
        durationMs: 60_000,
      },
    });
    expect(response.ok()).toBe(true);
    const draft = await response.json();
    ids.push(draft.video.id);
    if (publishFirst && i === 0) {
      const headers = { origin: WEB };
      const complete = await page.request.post(`${API}/media/uploads/sessions/complete`, {
        headers,
        data: {
          sessionToken: draft.uploadSession.sessionToken,
          parts: simulatedMultipartParts(
            70 * 1024 * 1024,
            draft.uploadSession.partSizeBytes,
            draft.uploadSession.partCount,
          ),
        },
      });
      expect(complete.ok()).toBe(true);
      expect(
        (
          await page.request.post(`${API}/creator/videos/${draft.video.id}/upload-complete`, {
            headers,
            data: {},
          })
        ).ok(),
      ).toBe(true);
      // Mirror the established, separately tested worker finalization fixture.
      execFileSync(
        process.execPath,
        [
          path.resolve("tests/e2e/db-helper.mjs"),
          "mark-media-ready",
          JSON.stringify({ videoId: draft.video.id }),
        ],
        { env: process.env },
      );
      expect(
        (
          await page.request.post(`${API}/creator/videos/${draft.video.id}/publish`, {
            headers,
            data: { rightsConfirmed: true, title: `Editor video ${i}` },
          })
        ).ok(),
      ).toBe(true);
    }
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
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Editor video 0");
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
  await page.getByRole("button", { name: "Back to videos" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Unsaved title");
  const currentUrl = page.url();
  await page.locator("aside a[href='/upload']").click();
  const leaveDialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(leaveDialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    leaveDialog.getByRole("button", { name: "Discard changes and leave" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(leaveDialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.screenshot({ path: info.outputPath("design-confirm-leave-1440.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(leaveDialog).not.toBeVisible();
  await expect(page.locator("aside a[href='/upload']")).toBeFocused();
  await expect(page).toHaveURL(currentUrl);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Unsaved title");
  await noOverflow(page);
  const disabledRemove = page.getByRole("button", { name: "Remove video", exact: true });
  await expect(disabledRemove).toHaveText("Remove video");
  await disabledRemove.scrollIntoViewIfNeeded();
  await disabledRemove.screenshot({
    path: info.outputPath("design-content-disabled-action.png"),
    animations: "disabled",
  });
  await page.screenshot({
    path: info.outputPath("design-content-editor-1440.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Back to videos" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Discard changes and leave", exact: true })
    .click();
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
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  const tablist = page.getByRole("tablist", { name: "محرر الفيديو" });
  const tabBounds = await tablist.evaluate((element) => {
    const parent = element.getBoundingClientRect();
    return {
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
      left: parent.left,
      right: parent.right,
      tabs: Array.from(element.querySelectorAll('[role="tab"]')).map((tab) => {
        const rect = tab.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
          scrollWidth: tab.scrollWidth,
          clientWidth: tab.clientWidth,
        };
      }),
    };
  });
  expect(tabBounds.scrollWidth).toBeLessThanOrEqual(tabBounds.width + 1);
  expect(tabBounds.tabs).toHaveLength(3);
  for (const tab of tabBounds.tabs) {
    expect(tab.width).toBeGreaterThanOrEqual(44);
    expect(tab.height).toBeGreaterThanOrEqual(44);
    expect(tab.left).toBeGreaterThanOrEqual(tabBounds.left - 1);
    expect(tab.right).toBeLessThanOrEqual(tabBounds.right + 1);
    expect(tab.scrollWidth).toBeLessThanOrEqual(tab.clientWidth + 1);
  }
  await noOverflow(page);
  await page.screenshot({
    path: info.outputPath("design-content-editor-390-ar.png"),
    fullPage: true,
  });
  await page.getByLabel("العنوان", { exact: true }).fill("تعديل لم يُحفظ بعد");
  const back = page.getByRole("button", { name: "العودة إلى الفيديوهات" });
  await back.click();
  const rtlDialog = page.getByRole("dialog", { name: "هل تريد التخلي عن التغييرات؟" });
  await expect(rtlDialog).toHaveAttribute("dir", "rtl");
  await expect(rtlDialog.getByRole("button", { name: "إلغاء", exact: true })).toBeFocused();
  await noOverflow(page);
  const dialogBounds = await rtlDialog.evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
    controls: Array.from(element.querySelectorAll("button")).map((button) => ({
      width: button.getBoundingClientRect().width,
      height: button.getBoundingClientRect().height,
      client: button.clientWidth,
      scroll: button.scrollWidth,
    })),
  }));
  expect(dialogBounds.scroll).toBeLessThanOrEqual(dialogBounds.client + 1);
  for (const button of dialogBounds.controls) {
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.scroll).toBeLessThanOrEqual(button.client + 1);
  }
  await page.screenshot({
    path: info.outputPath("design-confirm-leave-390-ar.png"),
    fullPage: true,
  });
  const handled = await page.evaluate(() => {
    const event = new CustomEvent("ayin:native-remote", {
      detail: { key: "BACK" },
      cancelable: true,
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(handled).toBe(true);
  await expect(rtlDialog).not.toBeVisible();
  await expect(page.getByLabel("العنوان", { exact: true })).toHaveValue("تعديل لم يُحفظ بعد");
  await expect(back).toBeFocused();
  // A confirmation above workspace navigation owns Back; the underlying dialog
  // must stay open and the original draft must survive both cancellations.
  await page.getByRole("button", { name: "فتح قائمة الاستوديو" }).click();
  const navigation = page.getByRole("dialog");
  await navigation.locator("a[href='/ar/studio']").click();
  await expect(rtlDialog).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("ayin:native-remote", {
        detail: { key: "BACK" },
        cancelable: true,
      }),
    ),
  );
  await expect(rtlDialog).not.toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("العنوان", { exact: true })).toHaveValue("تعديل لم يُحفظ بعد");
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
  await page.getByRole("button", { name: "Back to videos" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Discard changes and leave", exact: true })
    .click();
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
  await page.getByRole("button", { name: "Remove video", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  expect(deletes).toBe(0);
  await page.getByRole("button", { name: "Remove video", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove video", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(3);
  expect(deletes).toBe(1);
  await page.getByLabel("Status", { exact: true }).selectOption("REMOVED");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await openFirst(page);
  await expect(page.getByText("This video is removed and cannot be edited here.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove video", exact: true })).toBeDisabled();
});

test("unpublish and caption removal send valid JSON while origin checks stay enforced", async ({
  page,
}) => {
  const [videoId] = await seed(page, true);
  const headers = { origin: WEB };
  const foreignOrigin = await page.request.post(
    `${API}/creator/studio/videos/${videoId}/unpublish`,
    {
      headers: { origin: "https://not-ayin.invalid" },
      data: {},
    },
  );
  expect(foreignOrigin.status()).toBe(403);
  const original = await page.request.get(endpoint);
  expect(
    (await original.json()).videos.find((video: { id: string }) => video.id === videoId).status,
  ).toBe("PUBLISHED");
  let unpublishes = 0;
  await page.route(`${API}/creator/studio/videos/${videoId}/unpublish`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    unpublishes += 1;
    expect(route.request().headers()["content-type"]).toBe("application/json");
    expect(route.request().postData()).toBe("{}");
    await route.continue();
  });
  await page.goto("/studio/content?lang=en");
  await openFirst(page);
  await page.getByRole("button", { name: "Unpublish", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  expect(unpublishes).toBe(0);
  await page.getByRole("button", { name: "Unpublish", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Unpublish", exact: true }).click();
  await expect(page.getByRole("row", { name: /Editor video 0/ })).toContainText("Draft");
  expect(unpublishes).toBe(1);
  const list = await page.request.get(endpoint);
  expect(
    (await list.json()).videos.find((video: { id: string }) => video.id === videoId),
  ).toMatchObject({
    status: "DRAFT",
    publishedAt: null,
  });

  // The isolated E2E storage adapter supplies its bounded WebVTT object; this is
  // not a claim of real R2 transport or a production-caption mutation.
  const prepared = await page.request.post(
    `${API}/creator/studio/videos/${videoId}/captions/uploads`,
    {
      headers,
      data: {
        fileName: "english.vtt",
        sizeBytes: Buffer.byteLength("WEBVTT\n\n00:00.000 --> 00:01.000\nAYIN caption test\n"),
        mimeType: "text/vtt",
        languageCode: "en",
        label: "English test",
        kind: "SUBTITLES",
        default: false,
      },
    },
  );
  expect(prepared.ok()).toBe(true);
  const trackId = (await prepared.json()).trackId;
  expect(
    (
      await page.request.post(
        `${API}/creator/studio/videos/${videoId}/captions/${trackId}/finalize`,
        {
          headers,
          data: {},
        },
      )
    ).ok(),
  ).toBe(true);
  await openFirst(page);
  await page.getByRole("tab", { name: "Captions & subtitles", exact: true }).click();
  const captions = page.getByRole("tabpanel", { name: "Captions & subtitles" });
  await captions.locator("summary").click();
  await expect(captions.getByText("English test", { exact: true })).toBeVisible();
  let removals = 0;
  await page.route(`${API}/creator/studio/videos/${videoId}/captions/${trackId}`, async (route) => {
    if (route.request().method() === "DELETE") {
      removals += 1;
      expect(route.request().postData()).toBe("{}");
    }
    await route.continue();
  });
  await captions.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(captions.getByText("No caption tracks yet.")).toBeVisible();
  expect(removals).toBe(1);
});

test("confirmed navigation leaves once without saving or replaying link handlers", async ({
  page,
}) => {
  await seed(page);
  let writes = 0;
  await page.route(`${API}/creator/studio/videos/*`, async (route) => {
    if (["PATCH", "DELETE", "POST"].includes(route.request().method())) writes += 1;
    await route.continue();
  });
  await page.goto("/studio/content?lang=en");
  await openFirst(page);
  await page.getByLabel("Title", { exact: true }).fill("Do not send this draft");
  const before = page.url();
  await page.locator("aside a[href='/upload']").click();
  const confirmation = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(confirmation).toBeVisible();
  await expect(page).toHaveURL(before);
  expect(writes).toBe(0);
  await confirmation
    .getByRole("button", { name: "Discard changes and leave" })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page).toHaveURL(/\/upload$/);
  await expect(page.getByRole("heading", { name: "Upload a video" })).toBeVisible();
  expect(writes).toBe(0);
});
