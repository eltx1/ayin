import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// This suite delays/aborts requests to verify pending guards and ambiguous writes.
// A newly controlling worker can bypass page.route even when the write succeeds.
// Scope isolation to this suite; PWA and other browser journeys keep workers enabled.
// https://playwright.dev/docs/network#missing-network-events-and-service-workers
test.use({ serviceWorkers: "block" });

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
async function register(page: Page, email: string) {
  const response = await page.request.post(`${API}/auth/register`, {
    data: { name: "Live creator", email, password: "strong-pass-123" },
    headers: { origin: WEB },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).user;
}
test.afterEach(() => db("reset-studio-live"));
test("Studio Live creates once, audits chat changes and enforces channel ownership", async ({
  page,
  browser,
}) => {
  db("reset");
  db("reset-studio-live");
  expect((await page.request.get(`${API}/studio/live`)).status()).toBe(401);
  const user = await register(page, "studio-live@e2e.ayin.test");
  await page.goto("/studio/live");
  await expect(
    page.getByText("No live sessions yet. Create your first session above.", { exact: true }),
  ).toBeVisible();
  const snapshot = await page.request.get(`${API}/studio/live`);
  expect(snapshot.headers()["cache-control"]).toContain("no-store");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let creates = 0;
  await page.route(`${API}/studio/live`, async (route) => {
    if (route.request().method() === "POST") {
      creates++;
      await pending;
    }
    await route.continue();
  });
  await page.getByLabel("Title", { exact: true }).fill("Creator live acceptance");
  await page.getByRole("button", { name: "Create live session", exact: true }).click();
  await expect.poll(() => creates).toBe(1);
  await expect(page.getByLabel("Title", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh sessions" })).toBeDisabled();
  release();
  await expect(
    page.getByRole("heading", { name: "Creator live acceptance", exact: true }),
  ).toBeVisible();
  expect(creates).toBe(1);
  await expect(page.getByRole("button", { name: "Set up encoder", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Disable live chat", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enable live chat", exact: true })).toBeVisible();
  const evidence = db("studio-live-evidence", {
    channelId: user.channel.id,
    accountId: user.account.id,
  });
  expect(evidence.streams).toHaveLength(1);
  expect(evidence.streams[0]).toMatchObject({ status: "DRAFT", chatEnabled: false });
  expect(evidence.audits).toEqual([{ action: "DISABLE_CHAT" }]);
  const other = await browser.newContext();
  await other.request.post(`${API}/auth/register`, {
    data: { name: "Other creator", email: "other-live@e2e.ayin.test", password: "strong-pass-123" },
    headers: { origin: WEB },
  });
  expect(
    (
      await other.request.patch(`${API}/studio/live/${evidence.streams[0].id}/chat`, {
        data: { enabled: true },
        headers: { origin: WEB },
      })
    ).status(),
  ).toBe(404);
  await other.close();
  await page.unroute(`${API}/studio/live`);
  await page.route(`${API}/studio/live`, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 503, json: { message: "Creation temporarily unavailable" } })
      : route.continue(),
  );
  await page.getByLabel("Title", { exact: true }).fill("Preserved live draft");
  await page.getByRole("button", { name: "Create live session", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "The result may be uncertain" }),
  ).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Preserved live draft");
  expect(
    db("studio-live-evidence", { channelId: user.channel.id, accountId: user.account.id }).streams,
  ).toHaveLength(1);
  await page.unroute(`${API}/studio/live`);
  await page.route(`${API}/studio/live`, (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Refresh sessions" }).click();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Creator live acceptance", exact: true }),
  ).not.toBeVisible();
  await page.unroute(`${API}/studio/live`);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Creator live acceptance", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().addCookies([{ name: "ayin_locale", value: "ar", url: WEB }]);
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole("heading", { name: "البث المباشر", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "تفعيل دردشة البث" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.context().clearCookies();
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  // Locale belongs to the canonical /ar/ URL even after cookies are cleared.
  await expect(page).toHaveURL(/\/ar\/studio\/live$/);
  await expect(page.getByRole("button", { name: "إعادة المحاولة", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "تسجيل الدخول", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "إنشاء جلسة بث", exact: true })).not.toBeVisible();
  expect((await page.request.get(`${API}/studio/live`)).status()).toBe(401);
});

test("Studio Live confirms rotation, retains received keys after refresh failure and never replays", async ({
  page,
}) => {
  db("reset");
  db("reset-studio-live");
  const user = await register(page, "studio-encoder@e2e.ayin.test");
  // Synthetic provider responses test UI contracts, not real provider or encoder acceptance.
  const stream = {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "encoder-fixture",
    title: "Encoder fixture",
    status: "READY",
    providerStreamId: "fixture-provider",
    scheduledStartAt: null,
    chatEnabled: true,
  };
  let failRead = false,
    failWrite = false,
    writes = 0;
  await page.route(`${API}/studio/live`, (route) =>
    failRead
      ? route.fulfill({ status: 503, json: { message: "Live list temporarily unavailable" } })
      : route.fulfill({
          json: {
            channel: user.channel,
            provider: { configured: true, productionEnabled: true },
            streams: [stream],
            nextCursor: null,
          },
        }),
  );
  await page.route(`${API}/studio/live/*/sync`, (route) =>
    route.fulfill({ json: { stream, evidence: { playable: false, state: "IDLE" } } }),
  );
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${API}/studio/live/*/rotate-key`, async (route) => {
    writes++;
    if (failWrite) {
      await route.abort("failed");
      return;
    }
    await pending;
    failRead = true;
    await route.fulfill({
      json: {
        stream,
        encoder: {
          rtmps: { serverUrl: "rtmps://fixture.invalid/app", streamKey: "fixture-key-".repeat(20) },
          srt: { url: "srt://fixture.invalid?passphrase=fixture-private" },
        },
      },
    });
  });
  await page.goto("/studio/live");
  await page.getByRole("button", { name: "Check live status", exact: true }).click();
  await expect(
    page.getByText(
      "The provider has not confirmed playable output. AYIN will only show Live after confirmation.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Rotate encoder credentials", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "Rotate encoder credentials", exact: true }).click();
  await dialog.getByRole("button", { name: "Rotate credentials", exact: true }).click();
  await expect.poll(() => writes).toBe(1);
  await expect(
    page.getByRole("button", { name: "Rotate encoder credentials", exact: true }),
  ).toBeDisabled();
  release();
  const credentials = page.getByRole("complementary", { name: "One-time encoder configuration" });
  await expect(credentials).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Live sessions could not be loaded" }),
  ).toBeVisible();
  await expect(credentials.getByText("fixture-key-".repeat(20), { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toContain("fixture-key");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  failRead = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Rotate encoder credentials", exact: true }),
  ).toBeEnabled();
  expect(writes).toBe(1);
  await expect(credentials).toBeVisible();
  await page.getByRole("button", { name: "Hide credentials", exact: true }).click();
  await expect(credentials).not.toBeVisible();
  failWrite = true;
  await page.getByRole("button", { name: "Rotate encoder credentials", exact: true }).click();
  await dialog.getByRole("button", { name: "Rotate credentials", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "The result may be uncertain" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Rotate encoder credentials", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Review sessions", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "I have reviewed the result", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "I have reviewed the result", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Rotate encoder credentials", exact: true }),
  ).toBeEnabled();
  expect(writes).toBe(2);
  await expect(credentials).not.toBeVisible();
  await page.context().addCookies([{ name: "ayin_locale", value: "ar", url: WEB }]);
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await page.getByRole("button", { name: "تدوير بيانات المرمّز", exact: true }).click();
  await expect(dialog).toHaveAttribute("dir", "rtl");
  const bounds = await dialog.boundingBox();
  expect(bounds?.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  expect(writes).toBe(2);
});

test("Creator Live retains a committed root after response loss and requires explicit review before another write", async ({
  page,
}, testInfo) => {
  db("reset");
  db("reset-studio-live");
  const user = await register(page, "creator-live-loss@e2e.ayin.test");
  let creates = 0,
    reads = 0;
  await page.route(`${API}/studio/live`, async (route) => {
    if (route.request().method() === "POST") {
      creates++;
      const saved = await route.fetch();
      expect(saved.ok()).toBe(true);
      await route.abort("failed");
    } else {
      reads++;
      await route.continue();
    }
  });
  await page.goto("/studio/live?lang=en");
  await expect(
    page.getByText("No live sessions yet. Create your first session above.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("Committed live root");
  const before = reads;
  await page.getByRole("button", { name: "Create live session", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("The result may be uncertain");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Committed live root");
  await expect(
    page.getByRole("button", { name: "Create live session", exact: true }),
  ).toBeDisabled();
  expect(reads).toBe(before);
  expect(creates).toBe(1);
  expect(
    db("studio-live-evidence", { channelId: user.channel.id, accountId: user.account.id }).streams,
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Review sessions", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Committed live root", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create live session", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "I have reviewed the result", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create live session", exact: true }),
  ).toBeEnabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Back to AYIN", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/live/);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Committed live root");
  expect(creates).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("design-creator-live-loss-390-en.png"),
    fullPage: true,
  });
});

for (const locale of ["en", "ar"] as const)
  test(`Creator Live reads every owned database page and recovers stalled reads ${locale}`, async ({
    page,
  }, testInfo) => {
    db("reset");
    db("reset-studio-live");
    const user = await register(page, `creator-live-paging-${locale}@e2e.ayin.test`);
    for (let index = 0; index < 25; index++) {
      const response = await page.request.post(`${API}/studio/live`, {
        headers: { origin: WEB },
        data: { title: `Paged live ${index}` },
      });
      expect(response.ok()).toBe(true);
    }
    const ar = locale === "ar";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(ar ? "/ar/studio/live" : "/studio/live?lang=en");
    const main = page.getByRole("main");
    await expect(main.locator("article")).toHaveCount(20);
    await main.getByRole("button", { name: ar ? "التالي" : "Next", exact: true }).click();
    await expect(main.locator("article")).toHaveCount(5);
    await main.getByRole("button", { name: ar ? "السابق" : "Previous", exact: true }).click();
    await expect(main.locator("article")).toHaveCount(20);
    expect(
      db("studio-live-evidence", { channelId: user.channel.id, accountId: user.account.id })
        .streams,
    ).toHaveLength(25);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath(`design-creator-live-390-${locale}.png`),
      fullPage: true,
    });
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`${API}/studio/live`, async (route) => {
      await held;
      await route.abort("failed").catch(() => {});
    });
    await main
      .getByRole("button", { name: ar ? "تحديث الجلسات" : "Refresh sessions", exact: true })
      .click();
    await expect(main.getByRole("alert")).toContainText(
      ar ? "تعذر تحميل جلسات البث" : "Live sessions could not be loaded",
      { timeout: 20_000 },
    );
    await expect(main.locator("article")).toHaveCount(0);
    release();
    await page.unroute(`${API}/studio/live`);
    await main.getByRole("button", { name: ar ? "إعادة المحاولة" : "Retry", exact: true }).click();
    await expect(main.locator("article")).toHaveCount(20);
    await expect(main.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
