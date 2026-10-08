import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
const API = "http://127.0.0.1:3001",
  PROVIDER = "http://127.0.0.1:3012",
  WEB = "http://127.0.0.1:3000";
const key = "ayin.upload-recovery.v1";
const file = {
  name: "recovery.mp4",
  mimeType: "video/mp4",
  buffer: Buffer.from("synthetic source bytes"),
};
const text = (locale: string, en: string, ar: string) => (locale === "ar" ? ar : en);
const region = (page: Page, locale = "en") =>
  page.getByRole("region", {
    name: text(locale, "Recoverable uploads", "الرفع القابل للاستئناف"),
    exact: true,
  });
const button = (page: Page, name: string) =>
  region(page).getByRole("button", { name, exact: true });
async function stats(page: Page) {
  return (await page.request.get(`${PROVIDER}/stats`)).json();
}
async function setup(page: Page, locale = "en", email = `recovery-${Date.now()}@e2e.ayin.test`) {
  const result = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: {
      name: "Synthetic recovery owner",
      email,
      password: "strong-pass-123",
    },
  });
  expect(result.ok()).toBe(true);
  const identity = (await result.json()).user as {
    account: { id: string };
    profile: { id: string };
  };
  await page.route("https://recovery-provider.invalid/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": WEB,
          "access-control-allow-methods": "PUT,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
      return;
    }
    const forwarded = await page.request.put(PROVIDER + new URL(route.request().url()).pathname, {
      data: route.request().postDataBuffer()!,
      headers: { "content-type": "application/octet-stream" },
    });
    await route.fulfill({
      status: forwarded.status(),
      body: await forwarded.text(),
      headers: { "access-control-allow-origin": WEB },
    });
  });
  await page.goto(`/upload?lang=${locale}`);
  await region(page, locale).locator("summary").click();
  await region(page, locale)
    .getByRole("button", {
      name: text(locale, "Check saved upload", "التحقق من الرفع المحفوظ"),
      exact: true,
    })
    .click();
  await expect(
    region(page, locale).getByText(
      text(
        locale,
        "Choose a video to prepare a recoverable upload.",
        "اختر فيديو لإعداد رفع قابل للاستئناف.",
      ),
      { exact: true },
    ),
  ).toBeVisible();
  return identity;
}
async function choose(page: Page, selected = file) {
  await region(page).getByLabel("Choose original video").setInputFiles(selected);
  await expect(button(page, "Check saved upload")).toBeEnabled();
  await expect(region(page).getByText(selected.name, { exact: true })).toBeVisible();
}
async function create(page: Page, selected = file) {
  await choose(page, selected);
  await button(page, "Save draft").click();
  await expect(button(page, "Check saved upload")).toBeEnabled();
}
async function inspect(page: Page) {
  await button(page, "Check saved upload").click();
  await expect(button(page, "Check saved upload")).toBeEnabled();
}
async function reopen(page: Page) {
  await page.reload();
  await region(page).locator("summary").click();
  await button(page, "Check saved upload").click();
  await expect(button(page, "Check saved upload")).toBeEnabled();
}
test.beforeEach(async ({ page }) => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "http://invalid");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
    throw Error("Isolated recovery test database required");
  expect((await page.request.post(`${PROVIDER}/control`, { data: { reset: true } })).ok()).toBe(
    true,
  );
});

test("full-byte worker rejects same-metadata middle-byte substitution, then resumes actual multipart bytes after reload", async ({
  page,
}, info) => {
  await setup(page);
  const bytes = Buffer.alloc(10 * 1024 * 1024 + 137);
  for (let n = 0; n < bytes.length; n++) bytes[n] = (n * 31 + (n >>> 8) + 17) & 255;
  const original = { ...file, buffer: bytes };
  let workers = 0;
  page.on("worker", () => workers++);
  await create(page, original);
  await inspect(page);
  let heldRead = false;
  let releaseRead!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  await page.route("**/media/uploads/sessions/*/inspection", async (route) => {
    const response = await route.fetch();
    const snapshot = await response.json();
    if (
      !heldRead &&
      snapshot.observation?.kind === "PARTS_OBSERVED" &&
      snapshot.observation.parts.length === 1
    ) {
      heldRead = true;
      await held;
      await route.fulfill({ response }).catch(() => undefined);
    } else await route.fulfill({ response });
  });
  await button(page, "Continue upload").click();
  await expect.poll(() => heldRead).toBe(true);
  await button(page, "Stop").click();
  releaseRead();
  await expect(button(page, "Check saved upload")).toBeEnabled();
  await page.unroute("**/media/uploads/sessions/*/inspection");
  expect((await stats(page)).puts).toBe(1);
  await reopen(page);
  expect(await region(page).getByLabel("Choose original video").inputValue()).toBe("");
  await expect(button(page, "Continue upload")).toBeDisabled();
  const changed = Buffer.from(bytes);
  changed[6 * 1024 * 1024 + 721]! ^= 1;
  await choose(page, { ...original, buffer: changed });
  await inspect(page);
  await button(page, "Continue upload").click();
  await expect(
    region(page).getByText(
      "This is not the original file. Select the exact original file and inspect again.",
      { exact: true },
    ),
  ).toBeVisible();
  expect((await stats(page)).authorizations).toBe(1);
  await choose(page, original);
  await inspect(page);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await region(page)
      .getByRole("heading", { name: "Saved upload", exact: true })
      .evaluate((heading) =>
        window.scrollTo({
          top: heading.getBoundingClientRect().top + scrollY - 100,
          behavior: "instant",
        }),
      );
    await page.screenshot({ path: info.outputPath(`recovery-active-en-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
  await button(page, "Continue upload").click();
  await expect.poll(async () => (await stats(page)).puts).toBe(3);
  await expect(button(page, "Finish upload")).toBeEnabled();
  await button(page, "Finish upload").click();
  await expect(
    region(page).getByText(/Upload accepted. AYIN is checking and preparing/),
  ).toBeVisible();
  expect(await stats(page)).toMatchObject({
    allocations: 1,
    authorizations: 3,
    puts: 3,
    completes: 1,
    sessions: 1,
    queued: 1,
    published: 0,
  });
  expect(workers).toBe(3);
  const persisted = await page.evaluate((key) => localStorage.getItem(key), key);
  for (const forbidden of [
    "recovery-provider",
    "rootSha256",
    "fileIdentity",
    "providerUploadId",
    "sessionToken",
    file.name,
  ])
    expect(persisted).not.toContain(forbidden);
});

test("lost CREATE is recovered through GET after reload with no duplicate allocation", async ({
  page,
}) => {
  await setup(page);
  let creates = 0;
  await page.route(
    `${API}/creator/videos/recoverable-drafts`,
    async (route) => {
      creates++;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    },
    { times: 1 },
  );
  await choose(page);
  await button(page, "Save draft").click();
  await expect(region(page).getByText(/We could not confirm the last step/)).toBeVisible();
  await reopen(page);
  await inspect(page);
  await expect(
    region(page).getByRole("heading", { name: "Saved upload", exact: true }),
  ).toBeVisible();
  await expect(button(page, "Continue upload")).toBeDisabled();
  expect(creates).toBe(1);
  expect(await stats(page)).toMatchObject({ sessions: 1, authorizations: 0, puts: 0 });
});

test("lost AUTHORIZE is read without grant replay; a later explicit authorization uses a fresh request", async ({
  page,
}) => {
  await setup(page);
  await create(page);
  await inspect(page);
  const requestIds: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/authorize"))
      requestIds.push(request.postDataJSON().requestId);
  });
  await page.route(
    "**/media/uploads/sessions/*/authorize",
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    },
    { times: 1 },
  );
  await button(page, "Continue upload").click();
  await expect(region(page).getByText(/We could not confirm the last step/)).toBeVisible();
  await reopen(page);
  await inspect(page);
  expect(await stats(page)).toMatchObject({ authorizations: 1, puts: 0 });
  await choose(page);
  await button(page, "Continue upload").click();
  await expect.poll(async () => (await stats(page)).puts).toBe(1);
  expect(requestIds).toHaveLength(2);
  expect(requestIds[0]).not.toBe(requestIds[1]);
});

test("lost provider PUT response is inspected and completed without replaying bytes", async ({
  page,
}) => {
  await setup(page);
  await create(page);
  await inspect(page);
  await page.route("https://recovery-provider.invalid/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": WEB,
          "access-control-allow-methods": "PUT,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
      return;
    }
    const stored = await page.request.put(PROVIDER + new URL(route.request().url()).pathname, {
      data: route.request().postDataBuffer()!,
      headers: { "content-type": "application/octet-stream" },
    });
    expect(stored.ok()).toBe(true);
    await route.abort("failed");
  });
  await button(page, "Continue upload").click();
  await expect(region(page).getByText(/We could not confirm the last step/)).toBeVisible();
  await inspect(page);
  await button(page, "Continue upload").click();
  await expect(button(page, "Finish upload")).toBeEnabled();
  await button(page, "Finish upload").click();
  await expect(
    region(page).getByText(/Upload accepted. AYIN is checking and preparing/),
  ).toBeVisible();
  expect(await stats(page)).toMatchObject({ authorizations: 1, puts: 1, queued: 1, published: 0 });
});

test("lost COMPLETE is recovered after reload without another provider completion or integrity job", async ({
  page,
}) => {
  await setup(page);
  await create(page);
  await inspect(page);
  await button(page, "Continue upload").click();
  await expect.poll(async () => (await stats(page)).puts).toBe(1);
  await expect(button(page, "Check saved upload")).toBeEnabled();
  await inspect(page);
  await page.route(
    "**/media/uploads/sessions/*/complete",
    async (route) => {
      const accepted = await route.fetch();
      expect(accepted.status()).toBe(201);
      await route.abort("failed");
    },
    { times: 1 },
  );
  await button(page, "Finish upload").click();
  await expect(region(page).getByText(/We could not confirm the last step/)).toBeVisible();
  await reopen(page);
  await inspect(page);
  await expect(
    region(page).getByText(/Upload accepted. AYIN is checking and preparing/),
  ).toBeVisible();
  expect(await stats(page)).toMatchObject({
    sessions: 1,
    authorizations: 1,
    puts: 1,
    queued: 1,
    published: 0,
  });
});

for (const locale of ["en", "ar"])
  test(`explicit completion verification recovers stored multipart bytes without another completion or upload ${locale}`, async ({
    page,
  }, info) => {
    await setup(page, locale);
    const workspace = region(page, locale);
    const action = (en: string, ar: string) =>
      workspace.getByRole("button", { name: text(locale, en, ar), exact: true });
    const check = action("Check saved upload", "التحقق من الرفع المحفوظ");
    const verify = action("Verify upload completion", "التحقق من اكتمال الرفع");
    const writes: { url: string; body: Record<string, unknown> | null }[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/media/uploads/sessions/"))
        writes.push({ url: request.url(), body: request.postDataJSON() });
    });
    const original = { ...file, buffer: Buffer.alloc(5 * 1024 * 1024 + 137, 19) };
    await workspace
      .getByLabel(text(locale, "Choose original video", "اختيار الفيديو الأصلي"))
      .setInputFiles(original);
    await expect(action("Save draft", "حفظ المسودة")).toBeEnabled();
    await action("Save draft", "حفظ المسودة").click();
    await expect(check).toBeEnabled();
    await action("Continue upload", "متابعة الرفع").click();
    await expect(action("Finish upload", "إنهاء الرفع")).toBeEnabled();
    expect(
      (
        await page.request.post(`${PROVIDER}/control`, {
          data: { failCompleteAfterStore: true },
        })
      ).ok(),
    ).toBe(true);
    await action("Finish upload", "إنهاء الرفع").click();
    await expect(verify).toBeEnabled();
    const before = await stats(page);
    expect(before).toMatchObject({
      allocations: 1,
      authorizations: 2,
      puts: 2,
      completes: 1,
      queued: 0,
      published: 0,
    });
    const savedBefore = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
    expect(savedBefore.pending.kind).toBe("COMPLETE");
    expect(savedBefore.session.state).toBe("UNRESOLVED");
    for (let count = 0; count < 2; count++) {
      await check.click();
      await expect(verify).toBeEnabled();
    }
    expect(writes.filter((write) => write.url.endsWith("/reconcile"))).toHaveLength(0);
    expect(await stats(page)).toEqual(before);
    await page.request.post(`${PROVIDER}/control`, { data: { supported: false } });
    await check.click();
    await expect(check).toBeEnabled();
    await expect(verify).toHaveCount(0);
    await page.request.post(`${PROVIDER}/control`, { data: { supported: true } });
    await page.reload();
    await workspace.locator("summary").click();
    await check.click();
    await expect(verify).toBeEnabled();
    expect(
      await workspace
        .getByLabel(text(locale, "Choose original video", "اختيار الفيديو الأصلي"))
        .inputValue(),
    ).toBe("");
    await expect(action("Continue upload", "متابعة الرفع")).toBeDisabled();
    await expect(action("Finish upload", "إنهاء الرفع")).toBeDisabled();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await verify.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`recovery-verify-${locale}-${width}.png`) });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    }
    await verify.click();
    await expect(
      workspace.getByText(
        text(
          locale,
          "Upload accepted. AYIN is checking and preparing your video. Follow its progress in Studio before publishing.",
          "تم قبول الرفع. يتحقق AYIN من الفيديو ويجهزه. تابع تقدمه في الاستوديو قبل النشر.",
        ),
        { exact: true },
      ),
    ).toBeVisible();
    await expect(verify).toHaveCount(0);
    const reconciliations = writes.filter((write) => write.url.endsWith("/reconcile"));
    expect(reconciliations).toEqual([
      {
        url: `${API}/media/uploads/sessions/${savedBefore.session.sessionId}/operations/${savedBefore.pending.requestId}/reconcile`,
        body: { expectedRevision: savedBefore.session.revision },
      },
    ]);
    expect(writes.filter((write) => write.url.endsWith("/complete"))).toHaveLength(1);
    expect(await stats(page)).toMatchObject({
      allocations: 1,
      authorizations: 2,
      puts: 2,
      completes: 1,
      sessions: 1,
      queued: 1,
      published: 0,
    });
    const savedAfter = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
    expect(savedAfter.pending).toBeNull();
    expect(savedAfter.session.state).toBe("COMPLETED");
    await check.click();
    await expect(check).toBeEnabled();
    expect(writes.filter((write) => write.url.endsWith("/reconcile"))).toHaveLength(1);
    expect((await stats(page)).queued).toBe(1);
  });

test("lost completion-verification response is resolved by a read without repeating verification or provider completion", async ({
  page,
}) => {
  await setup(page);
  await create(page, { ...file, buffer: Buffer.alloc(5 * 1024 * 1024 + 137, 23) });
  await button(page, "Continue upload").click();
  await expect(button(page, "Finish upload")).toBeEnabled();
  await page.request.post(`${PROVIDER}/control`, { data: { failCompleteAfterStore: true } });
  await button(page, "Finish upload").click();
  await expect(button(page, "Verify upload completion")).toBeEnabled();
  let verifications = 0;
  await page.route("**/media/uploads/sessions/*/operations/*/reconcile", async (route) => {
    verifications++;
    const accepted = await route.fetch();
    expect(accepted.status()).toBe(201);
    expect(await accepted.json()).toMatchObject({
      session: { state: "COMPLETED" },
      operation: { status: "SUCCEEDED", replayed: true },
    });
    await route.abort("failed");
  });
  await button(page, "Verify upload completion").click();
  await expect(region(page).getByText(/We could not confirm the last step/)).toBeVisible();
  const pending = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).pending, key);
  expect(pending.kind).toBe("COMPLETE");
  await expect(button(page, "Finish upload")).toBeDisabled();
  await reopen(page);
  await expect(
    region(page).getByText(/Upload accepted. AYIN is checking and preparing/),
  ).toBeVisible();
  await expect(button(page, "Verify upload completion")).toHaveCount(0);
  expect(verifications).toBe(1);
  expect(await stats(page)).toMatchObject({
    allocations: 1,
    authorizations: 2,
    puts: 2,
    completes: 1,
    sessions: 1,
    queued: 1,
    published: 0,
  });
});

test("UNKNOWN is not replayed and explicit cancellation reports pending settlement", async ({
  page,
}) => {
  await setup(page);
  await create(page);
  await inspect(page);
  await page.request.post(`${PROVIDER}/control`, { data: { failAuthorize: true } });
  await button(page, "Continue upload").click();
  await expect(region(page).getByText(/We could not confirm the last step/)).toBeVisible();
  await inspect(page);
  await inspect(page);
  await expect(button(page, "Continue upload")).toBeDisabled();
  expect(await stats(page)).toMatchObject({ authorizations: 1, puts: 0 });
  await button(page, "Cancel upload").click();
  await expect(
    region(page).getByText("Upload canceled. Cleanup is pending.", { exact: true }),
  ).toBeVisible();
  await region(page).getByText("Upload details", { exact: true }).click();
  await expect(region(page).getByText(/Older upload links may still work/)).toBeVisible();
  expect((await stats(page)).cleanup).toBeGreaterThan(0);
  expect((await stats(page)).authorizations).toBe(1);
});

test("same-account new login invalidates old in-memory authority and saved details", async ({
  page,
}) => {
  const email = `session-${Date.now()}@e2e.ayin.test`;
  await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: { name: "Session owner", email, password: "strong-pass-123" },
  });
  await page.goto("/upload");
  await region(page).locator("summary").click();
  await button(page, "Check saved upload").click();
  await create(page);
  await inspect(page);
  const before = await stats(page);
  await page.request.post(`${API}/auth/login`, {
    headers: { origin: WEB },
    data: { email, password: "strong-pass-123" },
  });
  await button(page, "Continue upload").click();
  await expect(region(page).getByText(/Your account or access changed/)).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
  expect((await stats(page)).authorizations).toBe(before.authorizations);
});

for (const change of ["account", "profile"] as const)
  test(`viewer ${change} suspension hides recovery facts immediately and clears the old scoped marker`, async ({
    page,
  }) => {
    const identity = await setup(page, "en", `progress-recovery-${Date.now()}@example.test`);
    await create(page);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).not.toBeNull();
    if (change === "account") {
      const next = await page.request.post(`${API}/auth/register`, {
        headers: { origin: WEB },
        data: {
          name: "Other recovery viewer",
          email: `other-recovery-${Date.now()}@e2e.ayin.test`,
          password: "strong-pass-123",
        },
      });
      expect(next.ok()).toBe(true);
    } else {
      execFileSync(
        process.execPath,
        [
          path.resolve("tests/e2e/player-progress-fixture.mjs"),
          "default-profile",
          JSON.stringify({ accountId: identity.account.id }),
        ],
        { env: process.env },
      );
    }
    expect(
      await region(page).evaluate((element, change) => {
        window.dispatchEvent(
          change === "account"
            ? new Event("blur")
            : new PageTransitionEvent("pageshow", { persisted: true }),
        );
        return !element.querySelector("[data-private-viewer-identity]")?.checkVisibility();
      }, change),
    ).toBe(true);
    await expect(region(page).getByText(file.name, { exact: true })).toHaveCount(0);
    if (change === "account") await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
    await expect(button(page, "Check saved upload")).toBeEnabled();
    await button(page, "Check saved upload").click();
    await expect(
      region(page).getByText("Choose a video to prepare a recoverable upload.", { exact: true }),
    ).toBeVisible();
    expect(await stats(page)).toMatchObject({ sessions: 1, authorizations: 0, puts: 0 });
  });

test("viewer suspension terminates an actual file worker and ignores its held late messages", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as unknown as {
      recoveryWorkerEvents: (() => void)[];
      recoveryWorkerStops: number;
    };
    state.recoveryWorkerEvents = [];
    state.recoveryWorkerStops = 0;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        let handler: ((event: MessageEvent) => void) | null = null;
        Object.defineProperty(this, "onmessage", {
          configurable: true,
          get: () => handler,
          set: (next: (event: MessageEvent) => void) => {
            handler = next;
          },
        });
        this.addEventListener("message", (event) => {
          const captured = handler;
          state.recoveryWorkerEvents.push(() => captured?.(event));
        });
      }
      terminate() {
        state.recoveryWorkerStops++;
        super.terminate();
      }
    };
  });
  await setup(page);
  await region(page).getByLabel("Choose original video").setInputFiles(file);
  await page.waitForFunction(
    () =>
      (window as unknown as { recoveryWorkerEvents: unknown[] }).recoveryWorkerEvents.length > 0,
  );
  expect(
    await region(page).evaluate((element) => {
      window.dispatchEvent(new Event("blur"));
      const state = window as unknown as {
        recoveryWorkerEvents: (() => void)[];
        recoveryWorkerStops: number;
      };
      for (const deliver of state.recoveryWorkerEvents) deliver();
      return (
        state.recoveryWorkerStops === 1 &&
        !element.querySelector("[data-private-viewer-identity]")?.checkVisibility()
      );
    }),
  ).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(button(page, "Check saved upload")).toBeEnabled();
  await expect(region(page).getByText(file.name, { exact: true })).toHaveCount(0);
  expect(await stats(page)).toMatchObject({ sessions: 0, authorizations: 0, puts: 0 });
});

test("storage failure blocks creation before a request and pagehide erases visible private facts", async ({
  page,
}) => {
  await setup(page);
  await choose(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException("Synthetic storage failure", "QuotaExceededError");
    };
  });
  await button(page, "Save draft").click();
  await expect(region(page).getByText(/We could not confirm the last step/)).toBeVisible();
  expect((await stats(page)).sessions).toBe(0);
  expect(
    await region(page).evaluate((element) => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      return !element.querySelector('input[type="file"]')?.checkVisibility();
    }),
  ).toBe(true);
});

for (const locale of ["en", "ar"])
  test(`unsupported admission preserves standard upload and accessible mobile/RTL recovery disclosure ${locale}`, async ({
    page,
  }, info) => {
    await setup(page, locale);
    await page.request.post(`${PROVIDER}/control`, { data: { supported: false } });
    await region(page, locale)
      .getByRole("button", {
        name: text(locale, "Check saved upload", "التحقق من الرفع المحفوظ"),
        exact: true,
      })
      .click();
    await expect(
      region(page, locale).getByRole("button", {
        name: text(locale, "Save draft", "حفظ المسودة"),
        exact: true,
      }),
    ).toBeDisabled();
    await expect(page.locator('input[type="file"][accept^="video/"]')).toBeEnabled();
    expect((await stats(page)).sessions).toBe(0);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await region(page, locale)
        .getByRole("heading", { level: 2 })
        .evaluate((heading) => {
          window.scrollTo({
            top: heading.getBoundingClientRect().top + scrollY - 100,
            behavior: "instant",
          });
        });
      const studio = region(page, locale).getByRole("link", {
        name: text(locale, "Review in Studio", "المراجعة في الاستوديو"),
        exact: true,
      });
      expect(
        await studio.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return (
            document
              .elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
              ?.closest("a") === element
          );
        }),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`recovery-unsupported-${locale}-${width}.png`),
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    }
    const disclosure = region(page, locale).locator("summary");
    await disclosure.focus();
    await page.keyboard.press("Enter");
    await expect(
      region(page, locale).getByRole("button", {
        name: text(locale, "Check saved upload", "التحقق من الرفع المحفوظ"),
        exact: true,
      }),
    ).toBeHidden();
  });
