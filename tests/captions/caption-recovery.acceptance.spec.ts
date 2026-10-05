import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
const bytes = Buffer.from("WEBVTT\n\n00:00.000 --> 00:01.000\nActual browser caption bytes\n");
const fixture = { name: "original-en.vtt", mimeType: "text/vtt", buffer: bytes };
const failure = {
  status: 503,
  headers: { "access-control-allow-origin": WEB, "access-control-allow-credentials": "true" },
  json: { error: { code: "TEST_FAILURE" } },
};
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  const db = new URL(process.env.TEST_DATABASE_URL ?? "https://invalid.test");
  if (process.env.APP_ENV !== "test" || db.hostname !== "127.0.0.1" || db.pathname !== "/ayin_e2e")
    throw new Error("Caption fixtures require isolated local test DB");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
async function seed(page: Page) {
  const register = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: {
      name: "Caption creator",
      email: "caption-creator@e2e.ayin.test",
      password: "strong-pass-123",
    },
  });
  expect(register.ok()).toBe(true);
  const identity = await register.json();
  const response = await page.request.post(`${API}/creator/videos/drafts`, {
    headers: { origin: WEB },
    data: {
      channelId: identity.user.channel.id,
      title: "A quiet morning · صباح هادئ",
      sizeBytes: 1024,
      mimeType: "video/mp4",
      durationMs: 60_000,
    },
  });
  expect(response.ok()).toBe(true);
  return {
    videoId: (await response.json()).video.id as string,
    accountId: identity.user.account.id as string,
  };
}
async function open(page: Page, ar = false) {
  await page.goto(ar ? "/ar/studio/content?lang=ar" : "/studio/content?lang=en");
  await page
    .getByRole("button", { name: ar ? "تعديل الفيديو" : "Edit video", exact: true })
    .click();
  await page
    .getByRole("tab", { name: ar ? "الترجمة والتسميات" : "Captions & subtitles", exact: !ar })
    .click();
  await page
    .locator("summary")
    .filter({ hasText: ar ? "التسميات التوضيحية والترجمة" : "Captions & subtitles" })
    .click();
  await expect(
    page.getByRole("button", { name: ar ? "إضافة ترجمة" : "Add captions", exact: true }),
  ).toBeEnabled();
}
async function add(page: Page) {
  await page.getByRole("button", { name: "Add captions", exact: true }).click();
  await page.getByLabel("WebVTT caption file", { exact: true }).setInputFiles(fixture);
  await page.getByRole("button", { name: "Upload WebVTT", exact: true }).click();
}
async function tracks(page: Page, videoId: string) {
  const response = await page.request.get(`${API}/creator/studio/videos/${videoId}/captions`);
  expect(response.ok()).toBe(true);
  return (await response.json()).tracks as {
    id: string;
    label: string;
    enabled: boolean;
    status: string;
    replacing: boolean;
  }[];
}
async function noOverflow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}

test("real direct bytes, native replacement input, confirmation and EN/AR 390/1440 layouts", async ({
  page,
}, info) => {
  const { videoId } = await seed(page);
  const before = await (await page.request.get("http://127.0.0.1:3002/stats")).json();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await add(page);
  await expect(page.getByText("Caption change saved.", { exact: true })).toBeVisible();
  expect((await tracks(page, videoId))[0]?.status).toBe("READY");
  const after = await (await page.request.get("http://127.0.0.1:3002/stats")).json();
  expect(after.put).toBe(before.put + 1);
  expect(after.head).toBeGreaterThan(before.head);
  expect(after.read).toBeGreaterThan(before.read);
  await page.getByRole("button", { name: "Replace file", exact: true }).click();
  const input = page.getByLabel("Replacement WebVTT file", { exact: true });
  await input.focus();
  await expect(input).toBeFocused();
  await expect(input).toBeVisible();
  await input.setInputFiles({
    ...fixture,
    name: "replacement.vtt",
    buffer: Buffer.from("WEBVTT\n\n00:00.000 --> 00:02.000\nReplacement actual bytes\n"),
  });
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByRole("tab", { name: "Captions & subtitles", exact: true }).click();
  await expect(input).toHaveValue(/replacement.vtt$/);
  await page.getByRole("button", { name: "Upload replacement", exact: true }).click();
  await expect(page.getByRole("button", { name: "Replace file", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Remove track", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  expect(await tracks(page, videoId)).toHaveLength(1);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`captions-en-${width}.png`), fullPage: true });
  }
  await open(page, true);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`captions-ar-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "إزالة المسار", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "إزالة المسار", exact: true }).click();
  await expect(page.getByText("لا توجد مسارات ترجمة بعد.", { exact: true })).toBeVisible();
  expect(await tracks(page, videoId)).toHaveLength(0);
});

test("lost finalization acknowledgement freezes original target/file until explicit read and review", async ({
  page,
}, info) => {
  const { videoId } = await seed(page);
  await open(page);
  let creates = 0,
    finalizes = 0;
  await page.route(`${API}/creator/studio/videos/${videoId}/captions/uploads`, async (route) => {
    creates++;
    await route.continue();
  });
  await page.route(`${API}/creator/studio/videos/${videoId}/captions/*/finalize`, async (route) => {
    finalizes++;
    const result = await route.fetch();
    expect(result.ok()).toBe(true);
    await route.abort("failed");
  });
  await add(page);
  await expect(page.getByText(/This change was not confirmed/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload replacement", exact: true }),
  ).toBeDisabled();
  expect((await tracks(page, videoId))[0]?.status).toBe("READY");
  expect(creates).toBe(1);
  expect(finalizes).toBe(1);
  await expect(page.getByRole("button", { name: "Back to videos" })).toBeDisabled();
  await page.getByRole("button", { name: "Read current tracks", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "I’ve reviewed the current tracks" }),
  ).toBeVisible();
  await expect(page.getByLabel("Replacement WebVTT file")).toHaveValue(/original-en.vtt$/);
  expect(creates).toBe(1);
  expect(finalizes).toBe(1);
  await page.screenshot({ path: info.outputPath("captions-lost-ack-review.png"), fullPage: true });
  await page.getByRole("button", { name: "I’ve reviewed the current tracks" }).click();
  await expect(page.getByRole("button", { name: "Upload replacement", exact: true })).toBeEnabled();
  expect(creates).toBe(1);
  expect(finalizes).toBe(1);
  await page.getByRole("button", { name: "Discard caption draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Replace file", exact: true })).toBeEnabled();
});

test("validated write remains saved after failed GET, and malformed reads never become empty success", async ({
  page,
}) => {
  const { videoId } = await seed(page);
  await open(page);
  await add(page);
  await expect(page.getByText("Caption change saved.", { exact: true })).toBeVisible();
  const url = `${API}/creator/studio/videos/${videoId}/captions`;
  await page.route(url, (route) => route.fulfill(failure));
  await page.getByLabel("Available to viewers", { exact: true }).click();
  await expect(
    page.getByText(/Your change was saved. The updated list could not be read/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove track", exact: true, includeHidden: true }),
  ).toHaveCount(0);
  await page.unroute(url);
  expect((await tracks(page, videoId))[0]?.enabled).toBe(false);
  await page.route(url, (route) =>
    route.fulfill({ ...failure, status: 200, json: { tracks: {} } }),
  );
  await page.getByRole("button", { name: "Verify original account", exact: true }).click();
  await expect(page.getByText(/The original account could not be verified/)).toBeVisible();
  await expect(page.getByText("No caption tracks yet.", { exact: true })).toHaveCount(0);
  await page.unroute(url);
  await page.getByRole("button", { name: "Verify original account", exact: true }).click();
  await page.getByRole("button", { name: "I’ve reviewed the current tracks" }).click();
  await expect(page.getByLabel("Available to viewers", { exact: true })).not.toBeChecked();
});

test("lost prepare acknowledgement reconciles to existing track without silent new upload", async ({
  page,
}) => {
  const { videoId } = await seed(page);
  await open(page);
  let creates = 0;
  await page.route(`${API}/creator/studio/videos/${videoId}/captions/uploads`, async (route) => {
    creates++;
    expect((await route.fetch()).ok()).toBe(true);
    await route.abort("failed");
  });
  await add(page);
  await expect(page.getByText(/This change was not confirmed/)).toBeVisible();
  await page.getByRole("button", { name: "Read current tracks", exact: true }).click();
  await page.getByRole("button", { name: "I’ve reviewed the current tracks" }).click();
  await expect(page.getByRole("button", { name: "Upload replacement", exact: true })).toBeEnabled();
  expect(creates).toBe(1);
  expect(await tracks(page, videoId)).toHaveLength(1);
  await page.getByRole("button", { name: "Upload replacement", exact: true }).click();
  await expect(page.getByText("Caption change saved.", { exact: true })).toBeVisible();
  expect(creates).toBe(1);
  expect((await tracks(page, videoId))[0]?.status).toBe("READY");
});

test("account switch prevents write, conceals native drafts and requires original account", async ({
  page,
  playwright,
}, info) => {
  const { videoId } = await seed(page);
  const originalCookies = await page.context().cookies();
  await open(page);
  await add(page);
  await expect(page.getByText("Caption change saved.", { exact: true })).toBeVisible();
  const other = await playwright.request.newContext();
  expect(
    (
      await other.post(`${API}/auth/register`, {
        headers: { origin: WEB },
        data: {
          name: "Other account",
          email: "caption-other@e2e.ayin.test",
          password: "strong-pass-123",
        },
      })
    ).ok(),
  ).toBe(true);
  const otherState = await other.storageState();
  await page.context().clearCookies();
  await page.context().addCookies(otherState.cookies);
  let writes = 0;
  await page.route(`${API}/creator/studio/videos/${videoId}/captions/*`, async (route) => {
    if (route.request().method() !== "GET" && route.request().method() !== "OPTIONS") writes++;
    await route.continue();
  });
  await page.getByLabel("Available to viewers", { exact: true }).click();
  await expect(page.getByText(/Captions are hidden/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "A quiet morning · صباح هادئ" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Remove track", exact: true })).toBeHidden();
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "Verify original account", exact: true }).click();
  await expect(page.getByText(/The original account could not be verified/)).toBeVisible();
  expect(writes).toBe(0);
  await page.screenshot({
    path: info.outputPath("captions-account-concealed.png"),
    fullPage: true,
  });
  await page.context().clearCookies();
  await page.context().addCookies(originalCookies);
  await page.getByRole("button", { name: "Verify original account", exact: true }).click();
  await page.getByRole("button", { name: "I’ve reviewed the current tracks" }).click();
  expect((await tracks(page, videoId))[0]?.enabled).toBe(true);
  await page.getByRole("button", { name: "Replace file", exact: true }).click();
  await page.getByLabel("Replacement WebVTT file").setInputFiles(fixture);
  const synchronouslyHidden = await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    return [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')].every(
      (input) => input.getClientRects().length === 0 && input.value === "",
    );
  });
  expect(synchronouslyHidden).toBe(true);
  await expect(page.getByText(/Captions are hidden/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "A quiet morning · صباح هادئ" })).toBeHidden();
  await page.getByRole("button", { name: "Verify original account", exact: true }).click();
  await expect(page.getByLabel("Replacement WebVTT file")).toHaveValue("");
  await expect(page.getByText("original-en.vtt", { exact: true })).toBeVisible();
  expect(writes).toBe(0);
  await other.dispose();
});

test("lost direct PUT acknowledgement preserves file and target, duplicate submit never creates twice", async ({
  page,
}) => {
  const { videoId } = await seed(page);
  await open(page);
  let creates = 0,
    finalizes = 0,
    puts = 0;
  await page.route(`${API}/creator/studio/videos/${videoId}/captions/uploads`, async (route) => {
    creates++;
    await route.continue();
  });
  await page.route(`${API}/creator/studio/videos/${videoId}/captions/*/finalize`, async (route) => {
    finalizes++;
    await route.continue();
  });
  await page.route("http://127.0.0.1:3002/object?*", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    puts++;
    expect((await route.fetch()).ok()).toBe(true);
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Add captions", exact: true }).click();
  await page.getByLabel("WebVTT caption file", { exact: true }).setInputFiles(fixture);
  await page
    .getByRole("button", { name: "Upload WebVTT", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page.getByText(/This change was not confirmed/)).toBeVisible();
  expect(creates).toBe(1);
  expect(puts).toBe(1);
  expect(finalizes).toBe(0);
  expect((await tracks(page, videoId))[0]?.status).toBe("PENDING");
  await expect(page.getByRole("button", { name: "Back to videos", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Read current tracks", exact: true }).click();
  await page.getByRole("button", { name: "I’ve reviewed the current tracks" }).click();
  await expect(page.getByLabel("Replacement WebVTT file", { exact: true })).toHaveValue(
    /original-en.vtt$/,
  );
  expect(creates).toBe(1);
  expect(puts).toBe(1);
  expect(finalizes).toBe(0);
});

for (const failureKind of ["network", "account mismatch"] as const) {
  test(`validated PATCH stays saved but conceals after trailing identity ${failureKind}`, async ({
    page,
    playwright,
  }, info) => {
    const { videoId } = await seed(page);
    await open(page);
    await add(page);
    await expect(page.getByText("Caption change saved.", { exact: true })).toBeVisible();
    const originalCookies = await page.context().cookies();
    const other = await playwright.request.newContext();
    expect(
      (
        await other.post(`${API}/auth/register`, {
          headers: { origin: WEB },
          data: {
            name: "Other caption reviewer",
            email: "post-ack-other@e2e.ayin.test",
            password: "strong-pass-123",
          },
        })
      ).ok(),
    ).toBe(true);
    const otherCookies = (await other.storageState()).cookies;
    let acknowledged = false,
      writes = 0;
    await page.route(`${API}/auth/me`, async (route) => {
      if (acknowledged && failureKind === "network") await route.abort("failed");
      else await route.continue();
    });
    await page.route(`${API}/creator/studio/videos/${videoId}/captions/*`, async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      writes++;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      acknowledged = true;
      if (failureKind === "account mismatch") {
        await page.context().clearCookies();
        await page.context().addCookies(otherCookies);
      }
      await route.fulfill({ response });
    });
    await page.getByLabel("Available to viewers", { exact: true }).click();
    await expect(page.getByText(/Captions are hidden/)).toBeVisible();
    await expect(page.getByText("Caption change saved.", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "A quiet morning · صباح هادئ" })).toBeHidden();
    await expect(
      page.getByText("A quiet morning · صباح هادئ", { exact: true }).last(),
    ).toBeHidden();
    await page.screenshot({
      path: info.outputPath(`captions-post-ack-${failureKind.replace(" ", "-")}.png`),
      fullPage: true,
    });
    expect(writes).toBe(1);
    await page.unroute(`${API}/auth/me`);
    await page.context().clearCookies();
    await page.context().addCookies(originalCookies);
    await page.getByRole("button", { name: "Verify original account", exact: true }).click();
    await page.getByRole("button", { name: "I’ve reviewed the current tracks" }).click();
    await expect(page.getByLabel("Available to viewers", { exact: true })).not.toBeChecked();
    expect(writes).toBe(1);
    await other.dispose();
  });
}

test("private retained native nodes stay scrubbed across React frames and after same-account restore", async ({
  page,
}) => {
  await seed(page);
  await open(page);
  await add(page);
  await expect(page.getByText("Caption change saved.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Private retained native title");
  await page
    .getByLabel("Description (optional)", { exact: true })
    .fill("Private retained description");
  await page.getByRole("tab", { name: "Captions & subtitles", exact: true }).click();
  await page.getByRole("button", { name: "Add captions", exact: true }).click();
  await page.getByLabel("WebVTT caption file", { exact: true }).setInputFiles(fixture);
  await page.locator("summary").filter({ hasText: "More options" }).click();
  await page.getByLabel("Track name (optional)", { exact: true }).fill("Private caption label");
  const retained = await page.evaluateHandle(() => [
    ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input:not([type]), input[type="text"], input[type="file"], textarea',
    ),
  ]);
  expect(
    await retained.evaluate((nodes) =>
      nodes.some(
        (node) => node.id === "content-title" && node.value === "Private retained native title",
      ),
    ),
  ).toBe(true);
  expect(await retained.evaluate((nodes) => nodes.length)).toBeGreaterThanOrEqual(5);
  const values = () =>
    retained.evaluate((nodes) =>
      nodes.map((node) => ({
        value: node.value,
        defaultValue: node.defaultValue,
        attribute: node.getAttribute("value"),
        hidden: node.getClientRects().length === 0,
        connected: node.isConnected,
      })),
    );
  const synchronous = await retained.evaluate((nodes) => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    return nodes.every(
      (node) =>
        node.value === "" &&
        node.defaultValue === "" &&
        !node.getAttribute("value") &&
        node.getClientRects().length === 0,
    );
  });
  expect(synchronous).toBe(true);
  expect(
    (await values()).every(
      (node) => node.value === "" && node.defaultValue === "" && !node.attribute && node.hidden,
    ),
  ).toBe(true);
  await expect(page.getByText(/Captions are hidden/)).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(
    (await values()).every(
      (node) => node.value === "" && node.defaultValue === "" && !node.attribute && node.hidden,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Verify original account", exact: true }).click();
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Private retained native title",
  );
  await expect(page.getByLabel("Description (optional)", { exact: true })).toHaveValue(
    "Private retained description",
  );
  expect(
    (await values()).every(
      (node) => node.value === "" && node.defaultValue === "" && !node.attribute && !node.connected,
    ),
  ).toBe(true);
  await page.getByRole("tab", { name: "Captions & subtitles", exact: true }).click();
  await page.locator("summary").filter({ hasText: "More options" }).click();
  await expect(page.getByLabel("Track name (optional)", { exact: true })).toHaveValue(
    "Private caption label",
  );
  await expect(page.getByLabel("WebVTT caption file", { exact: true })).toHaveValue("");
  await expect(page.getByText("original-en.vtt", { exact: true })).toBeVisible();
  await retained.dispose();
});

test("validated finalization conceals on trailing identity failure while keeping generic saved feedback", async ({
  page,
}) => {
  const { videoId } = await seed(page);
  await open(page);
  let acknowledged = false,
    finalizes = 0,
    creates = 0;
  await page.route(`${API}/auth/me`, async (route) => {
    if (acknowledged) await route.abort("failed");
    else await route.continue();
  });
  await page.route(`${API}/creator/studio/videos/${videoId}/captions/uploads`, async (route) => {
    creates++;
    await route.continue();
  });
  await page.route(`${API}/creator/studio/videos/${videoId}/captions/*/finalize`, async (route) => {
    finalizes++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    acknowledged = true;
    await route.fulfill({ response });
  });
  await add(page);
  await expect(page.getByText(/Captions are hidden/)).toBeVisible();
  await expect(page.getByText("Caption change saved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A quiet morning · صباح هادئ" })).toBeHidden();
  expect(creates).toBe(1);
  expect(finalizes).toBe(1);
  await page.unroute(`${API}/auth/me`);
  await page.getByRole("button", { name: "Verify original account", exact: true }).click();
  await page.getByRole("button", { name: "I’ve reviewed the current tracks" }).click();
  expect((await tracks(page, videoId))[0]?.status).toBe("READY");
  await expect(page.getByRole("button", { name: "Add captions", exact: true })).toBeEnabled();
  expect(creates).toBe(1);
  expect(finalizes).toBe(1);
});

for (const stage of [
  "before prepare",
  "after prepare",
  "before PUT",
  "after PUT",
  "replacement prepare",
  "replacement PUT",
] as const) {
  test(`failed identity ${stage} conceals with a stage-accurate outcome and never advances automatically`, async ({
    page,
  }, info) => {
    const { videoId } = await seed(page);
    await open(page);
    const replacement = stage.startsWith("replacement");
    if (replacement) {
      await add(page);
      await expect(page.getByText("Caption change saved.", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Replace file", exact: true }).click();
    } else await page.getByRole("button", { name: "Add captions", exact: true }).click();
    await page
      .getByLabel(replacement ? "Replacement WebVTT file" : "WebVTT caption file", { exact: true })
      .setInputFiles({ ...fixture, name: "private-stage-file.vtt" });
    let preparations = 0,
      puts = 0,
      finalizes = 0,
      preparedId = "",
      preparedAcknowledged = false,
      putAcknowledged = false,
      identityAfterPrepare = 0;
    await page.route(`${API}/auth/me`, async (route) => {
      if (preparedAcknowledged) identityAfterPrepare++;
      const fail =
        stage === "before prepare" ||
        ((stage === "after prepare" || stage === "replacement prepare") && preparedAcknowledged) ||
        (stage === "before PUT" && identityAfterPrepare >= 2) ||
        ((stage === "after PUT" || stage === "replacement PUT") && putAcknowledged);
      if (fail) await route.abort("failed");
      else await route.continue();
    });
    await page.route(`${API}/creator/studio/videos/${videoId}/captions/**`, async (route) => {
      if (route.request().method() === "POST" && route.request().url().endsWith("/uploads")) {
        preparations++;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        preparedId = (await response.json()).trackId;
        preparedAcknowledged = true;
        await route.fulfill({ response });
      } else {
        if (route.request().url().endsWith("/finalize")) finalizes++;
        await route.continue();
      }
    });
    await page.route("http://127.0.0.1:3002/object?*", async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      puts++;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      putAcknowledged = true;
      await route.fulfill({ response });
    });
    await page
      .getByRole("button", {
        name: replacement ? "Upload replacement" : "Upload WebVTT",
        exact: true,
      })
      .click();
    await expect(page.getByText(/Captions are hidden/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "A quiet morning · صباح هادئ" })).toBeHidden();
    await expect(page.getByText("private-stage-file.vtt", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Caption change saved.", { exact: true })).toHaveCount(0);
    const uploaded = stage === "after PUT" || stage === "replacement PUT";
    if (uploaded)
      await expect(
        page.getByText(/File uploaded, but the account could not be verified/),
      ).toBeVisible();
    else if (stage !== "before prepare")
      await expect(
        page.getByText(/Upload prepared, but the account could not be verified/),
      ).toBeVisible();
    expect(preparations).toBe(stage === "before prepare" ? 0 : 1);
    expect(puts).toBe(uploaded ? 1 : 0);
    expect(finalizes).toBe(0);
    if (stage === "replacement PUT")
      await page.screenshot({
        path: info.outputPath("captions-post-put-identity-concealed.png"),
        fullPage: true,
      });
    await page.unroute(`${API}/auth/me`);
    await page.getByRole("button", { name: "Verify original account", exact: true }).click();
    await page.getByRole("button", { name: "I’ve reviewed the current tracks" }).click();
    const current = await tracks(page, videoId);
    if (stage === "before prepare") expect(current).toHaveLength(0);
    else {
      expect(current).toHaveLength(1);
      expect(current[0]?.id).toBe(preparedId);
      expect(current[0]?.status).toBe(replacement ? "READY" : "PENDING");
      expect(current[0]?.replacing).toBe(true);
    }
    await expect(page.getByText("private-stage-file.vtt", { exact: true })).toBeVisible();
    expect(preparations).toBe(stage === "before prepare" ? 0 : 1);
    expect(puts).toBe(uploaded ? 1 : 0);
    expect(finalizes).toBe(0);
  });
}

test("a list read followed by identity failure never reveals its data", async ({ page }) => {
  const { videoId } = await seed(page);
  await open(page);
  let listAcknowledged = false,
    reads = 0;
  await page.route(`${API}/auth/me`, async (route) => {
    if (listAcknowledged) await route.abort("failed");
    else await route.continue();
  });
  await page.route(`${API}/creator/studio/videos/${videoId}/captions`, async (route) => {
    reads++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    listAcknowledged = true;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Read current tracks", exact: true }).click();
  await expect(page.getByText(/Captions are hidden/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "A quiet morning · صباح هادئ" })).toBeHidden();
  await expect(page.getByText("No caption tracks yet.", { exact: true })).toHaveCount(0);
  expect(reads).toBe(1);
  await page.unroute(`${API}/auth/me`);
  await page.getByRole("button", { name: "Verify original account", exact: true }).click();
  await page.getByRole("button", { name: "I’ve reviewed the current tracks" }).click();
  await expect(page.getByText("No caption tracks yet.", { exact: true })).toBeVisible();
  expect(reads).toBe(2);
});

test("an acknowledged removal followed by identity failure stays saved and never replays", async ({
  page,
}) => {
  const { videoId } = await seed(page);
  await open(page);
  await add(page);
  await expect(page.getByText("Caption change saved.", { exact: true })).toBeVisible();
  let removed = false,
    deletes = 0;
  await page.route(`${API}/auth/me`, async (route) => {
    if (removed) await route.abort("failed");
    else await route.continue();
  });
  await page.route(`${API}/creator/studio/videos/${videoId}/captions/*`, async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    deletes++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    removed = true;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Remove track", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove track", exact: true }).click();
  await expect(page.getByText(/Captions are hidden/)).toBeVisible();
  await expect(page.getByText("Caption change saved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A quiet morning · صباح هادئ" })).toBeHidden();
  expect(deletes).toBe(1);
  await page.unroute(`${API}/auth/me`);
  await page.getByRole("button", { name: "Verify original account", exact: true }).click();
  await page.getByRole("button", { name: "I’ve reviewed the current tracks" }).click();
  expect(await tracks(page, videoId)).toHaveLength(0);
  expect(deletes).toBe(1);
});
