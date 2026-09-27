import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
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
    page.getByRole("alert").filter({ hasText: "Creation temporarily unavailable" }),
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
  await page.reload();
  await expect(page.getByRole("heading", { name: "البث المباشر", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "تفعيل دردشة البث" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.context().clearCookies();
  await page.reload();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create live session", exact: true }),
  ).not.toBeVisible();
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
          },
        }),
  );
  await page.route(`${API}/studio/live/*/sync`, (route) =>
    route.fulfill({ json: { evidence: { playable: false, state: "CONNECTING" } } }),
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
    page.getByRole("alert").filter({ hasText: "Live list temporarily unavailable" }),
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
  ).toBeEnabled();
  expect(writes).toBe(2);
  await expect(credentials).not.toBeVisible();
  await page.context().addCookies([{ name: "ayin_locale", value: "ar", url: WEB }]);
  await page.reload();
  await page.getByRole("button", { name: "تدوير بيانات المرمّز", exact: true }).click();
  await expect(dialog).toHaveAttribute("dir", "rtl");
  const bounds = await dialog.boundingBox();
  expect(bounds?.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  expect(writes).toBe(2);
});
