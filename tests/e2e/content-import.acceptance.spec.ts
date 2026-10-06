import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";
import { generateTotpCode, totpCounter } from "../../apps/api/src/auth/totp.js";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
type Fixture = { accountId: string; channelId: string; channelName: string; recoveryCode: string };
type Evidence = {
  batches: Array<{
    id: string;
    items: Array<{
      id: string;
      status: string;
      videoId: string;
      video: { mediaProcessingJobs: Array<{ status: string }> };
    }>;
  }>;
  audits: Array<{ action: string; entityId: string }>;
};
function db<T>(command: string, data: object): T {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/content-import-fixture.mjs"), command, JSON.stringify(data)],
      { env: process.env, encoding: "utf8" },
    ),
  ) as T;
}
let fixture: Fixture | undefined;
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  fixture = undefined;
});
test.afterEach(() => {
  if (fixture) db("cleanup", fixture);
});
async function setup(page: Page, locale: "en" | "ar" = "en") {
  const registration = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: {
      name: "Native import operator",
      email: `native-import-${randomUUID()}@e2e.ayin.test`,
      password: "strong-pass-123",
    },
  });
  expect(registration.ok()).toBe(true);
  const accountId = (await registration.json()).user.account.id,
    mfa = await enrollMfa(page.request);
  fixture = {
    accountId,
    recoveryCode: mfa.recoveryCodes[0]!,
    ...db<{ channelId: string; channelName: string }>("seed", { accountId }),
  };
  const counts = {
    batches: 0,
    sessions: 0,
    completes: 0,
    confirms: 0,
    publishes: 0,
    rollbacks: 0,
    puts: 0,
  };
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const url = request.url();
    if (url.endsWith("/admin/content-seeding/batches")) counts.batches++;
    if (url.endsWith("/upload-session")) counts.sessions++;
    if (url.endsWith("/media/uploads/sessions/complete")) counts.completes++;
    if (url.endsWith("/confirm-upload")) counts.confirms++;
    if (/content-seeding\/items\/[^/]+\/publish$/.test(url)) counts.publishes++;
    if (url.endsWith("/rollback")) counts.rollbacks++;
  });
  await page.route("https://e2e-upload.invalid/**", async (route) => {
    if (route.request().method() === "PUT") {
      counts.puts++;
      expect(route.request().headers()["cookie"]).toBeUndefined();
    }
    await route.fulfill({
      status: route.request().method() === "OPTIONS" ? 204 : 200,
      body: "",
      headers: {
        "access-control-allow-origin": WEB,
        "access-control-allow-methods": "PUT,OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-expose-headers": "etag",
        etag: '"import-test-object"',
      },
    });
  });
  await page.goto(`/admin/content?lang=${locale}`);
  await expect(page.locator("[data-import-private]")).toBeVisible();
  await page.locator("#seed-channel").selectOption(fixture.channelId);
  await page
    .locator("#seed-source")
    .fill(locale === "ar" ? "مصدر أصلي مرخّص" : "Original licensed source");
  await page
    .locator("#seed-title")
    .fill(locale === "ar" ? "الفيلم الأصلي" : "Original import film");
  await page.locator("#seed-type").selectOption("DOCUMENTARY");
  await page.locator("#seed-rights").selectOption("LICENSED");
  await page
    .locator("#seed-evidence")
    .fill(
      locale === "ar"
        ? "ترخيص تجريبي موثّق للمحتوى الأصلي"
        : "Documented fixture license for original content",
    );
  await page
    .locator("#seed-file")
    .setInputFiles({ name: "original.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(1024) });
  return { data: fixture, counts, mfa };
}
async function upload(page: Page, locale: "en" | "ar" = "en") {
  const button = page.getByRole("button", {
    name: locale === "ar" ? "رفع للمراجعة" : "Upload for review",
    exact: true,
  });
  // Repeated native clicks in one task must not produce two root mutations.
  await button.evaluate((node) => {
    (node as HTMLButtonElement).click();
    (node as HTMLButtonElement).click();
  });
  await expect(page.locator("[data-seed-item]")).toHaveCount(1);
  return page.locator("[data-seed-item]");
}
function evidence(data: Fixture) {
  return db<Evidence>("evidence", data);
}
async function shots(page: Page, info: TestInfo, locale: string, state: string) {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.getByRole("main").getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`import-${locale}-${width}-${state}.png`),
      fullPage: true,
      style: "html{scroll-behavior:auto!important}",
    });
  }
}
for (const locale of ["en", "ar"] as const) {
  test(`native ${locale} original import processing to ready, explicit publication and committed read failure`, async ({
    page,
  }, info) => {
    const { data, counts } = await setup(page, locale);
    await shots(page, info, locale, "metadata");
    const row = await upload(page, locale);
    await expect(
      row.getByText(locale === "ar" ? "قيد المعالجة" : "Processing", { exact: true }),
    ).toBeVisible();
    expect(counts).toEqual({
      batches: 1,
      sessions: 1,
      completes: 1,
      confirms: 0,
      publishes: 0,
      rollbacks: 0,
      puts: 1,
    });
    await shots(page, info, locale, "processing");
    const before = evidence(data),
      original = before.batches[0]!,
      item = original.items[0]!;
    expect(item.video.mediaProcessingJobs[0]!.status).toBe("QUEUED");
    db("ready", { ...data, itemId: item.id });
    await page
      .getByRole("button", {
        name: locale === "ar" ? "تحديث الدفعة الأصلية" : "Refresh original batch",
        exact: true,
      })
      .click();
    const publish = row.getByRole("button", {
      name: locale === "ar" ? "نشر" : "Publish",
      exact: true,
    });
    await expect(publish).toBeEnabled();
    await publish.focus();
    await expect(publish).toBeFocused();
    await shots(page, info, locale, "ready");
    let published = false;
    await page.route(`${API}/admin/content-seeding/items/${item.id}/publish`, async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      published = true;
      await route.fulfill({ response });
    });
    await page.route(`${API}/admin/content-seeding/batches/${original.id}`, async (route) => {
      if (published)
        await route.fulfill({
          status: 503,
          json: { error: { code: "FIXTURE_READ_FAILURE", message: "Read failed after commit" } },
        });
      else await route.continue();
    });
    await publish.evaluate((node) => {
      (node as HTMLButtonElement).click();
      (node as HTMLButtonElement).click();
    });
    await expect(
      page.getByText(
        locale === "ar"
          ? "تم تأكيد نشر العنصر الأصلي."
          : "Publication was acknowledged for the original item.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      row.getByText(locale === "ar" ? "منشور" : "Published", { exact: true }),
    ).toBeVisible();
    await expect(
      row.getByRole("button", { name: locale === "ar" ? "نشر" : "Publish", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: locale === "ar" ? "التراجع عن الدفعة غير المنشورة" : "Roll back unpublished batch",
        exact: true,
      }),
    ).toHaveCount(0);
    const after = evidence(data);
    expect(after.batches).toHaveLength(1);
    expect(after.batches[0]!.id).toBe(original.id);
    expect(after.batches[0]!.items[0]!.status).toBe("PUBLISHED");
    expect(
      after.audits.filter((audit) => audit.action === "CONTENT_SEED_ITEM_PUBLISHED"),
    ).toHaveLength(1);
    expect(counts.publishes).toBe(1);
    expect(counts.confirms).toBe(0);
    expect(counts.puts).toBe(1);
    await shots(page, info, locale, "published-read-failed");
  });
}
test("lost upload completion acknowledgment recovers original worker status without byte or confirmation replay", async ({
  page,
}) => {
  const { data, counts } = await setup(page);
  await page.route(`${API}/media/uploads/sessions/complete`, async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("failed");
  });
  const row = await upload(page);
  await expect(page.getByText(/Upload outcome is unconfirmed/)).toBeVisible();
  const original = evidence(data).batches[0]!,
    item = original.items[0]!;
  await page.getByRole("button", { name: "Refresh original batch", exact: true }).click();
  await expect(row.getByText("Processing", { exact: true })).toBeVisible();
  db("ready", { ...data, itemId: item.id });
  await page.getByRole("button", { name: "Refresh original batch", exact: true }).click();
  await expect(row.getByRole("button", { name: "Publish", exact: true })).toBeEnabled();
  expect(counts.batches).toBe(1);
  expect(counts.sessions).toBe(1);
  expect(counts.completes).toBe(1);
  expect(counts.puts).toBe(1);
  expect(counts.confirms).toBe(0);
  expect(counts.publishes).toBe(0);
});
test("lost publish acknowledgment reads committed original publication exactly once", async ({
  page,
}) => {
  const { data, counts } = await setup(page),
    row = await upload(page);
  await expect(row.getByText("Processing", { exact: true })).toBeVisible();
  const original = evidence(data).batches[0]!,
    item = original.items[0]!;
  db("ready", { ...data, itemId: item.id });
  await page.getByRole("button", { name: "Refresh original batch", exact: true }).click();
  await page.route(`${API}/admin/content-seeding/items/${item.id}/publish`, async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("failed");
  });
  await row.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(row.getByText(/Publication outcome is unknown/)).toBeVisible();
  await expect(row.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Refresh original batch", exact: true }).click();
  await expect(row.getByText("Published", { exact: true })).toBeVisible();
  expect(counts.publishes).toBe(1);
  expect(
    evidence(data).audits.filter((audit) => audit.action === "CONTENT_SEED_ITEM_PUBLISHED"),
  ).toHaveLength(1);
});
test("failed processing uses existing recovery controls and cancelled rollback makes no write", async ({
  page,
}) => {
  const { data, counts } = await setup(page),
    row = await upload(page);
  await expect(row.getByText("Processing", { exact: true })).toBeVisible();
  const item = evidence(data).batches[0]!.items[0]!;
  db("failed", { ...data, itemId: item.id });
  await page.getByRole("button", { name: "Refresh original batch", exact: true }).click();
  await expect(row.getByText("Processing failed", { exact: true })).toBeVisible();
  await expect(
    row.getByRole("link", { name: "Open Media Processing", exact: true }),
  ).toHaveAttribute("href", "/admin/operations/media");
  await page.getByRole("button", { name: "Roll back unpublished batch", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  expect(counts.rollbacks).toBe(0);
  expect(evidence(data).batches[0]!.items[0]!.status).toBe("UPLOADING");
  await page.getByRole("button", { name: "Roll back unpublished batch", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Roll back batch", exact: true })
    .click();
  await expect(row.getByText("Rolled back", { exact: true })).toBeVisible();
  expect(counts.rollbacks).toBe(1);
});
test("delayed original read cannot expose private content after actor-role revocation", async ({
  page,
}) => {
  const { data, counts } = await setup(page),
    row = await upload(page);
  await expect(row.getByText("Processing", { exact: true })).toBeVisible();
  const original = evidence(data).batches[0]!;
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    received = new Promise<void>((resolve) => {
      entered = resolve;
    });
  await page.route(`${API}/admin/content-seeding/batches/${original.id}`, async (route) => {
    const response = await route.fetch();
    entered();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Refresh original batch", exact: true }).click();
  await received;
  db("revoke", data);
  release();
  await expect(page.locator("[data-import-private]")).toHaveCount(0);
  await expect(page.getByText("Original import film", { exact: true })).toHaveCount(0);
  expect(counts.batches).toBe(1);
  expect(counts.publishes).toBe(0);
});
test("hidden-page boundary scrubs captured native fields and cancels prior upload intent", async ({
  page,
}) => {
  const { counts } = await setup(page);
  const title = await page.locator("#seed-title").elementHandle(),
    source = await page.locator("#seed-evidence").elementHandle(),
    file = await page.locator("#seed-file").elementHandle();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  expect(
    await title!.evaluate((node) => ({
      value: (node as HTMLInputElement).value,
      defaultValue: (node as HTMLInputElement).defaultValue,
    })),
  ).toEqual({ value: "", defaultValue: "" });
  expect(await source!.evaluate((node) => (node as HTMLTextAreaElement).value)).toBe("");
  expect(await file!.evaluate((node) => (node as HTMLInputElement).files?.length)).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(page.locator("#seed-title")).toHaveValue("");
  expect(counts.batches).toBe(0);
});

test("step-up rejection retains the original target and requires an explicit upload retry", async ({
  page,
}) => {
  const { data, counts } = await setup(page);
  let rejected = false;
  await page.route(`${API}/admin/content-seeding/items/*/upload-session`, async (route) => {
    if (!rejected) {
      rejected = true;
      await route.fulfill({
        status: 403,
        json: { error: { code: "STEP_UP_REQUIRED", message: "Verify before upload" } },
      });
    } else await route.continue();
  });
  await upload(page);
  const dialog = page.getByRole("dialog", { name: "Confirm your identity", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continue original upload", exact: true }),
  ).toBeEnabled();
  const original = evidence(data).batches[0]!;
  expect(original.items[0]!.status).toBe("DRAFT");
  expect(counts.sessions).toBe(1);
  expect(counts.puts).toBe(0);
  expect(counts.batches).toBe(1);
  // The isolated actor's actual session is still freshly verified. The injected
  // rejection proves that closing verification cannot automatically replay it.
  await page.getByRole("button", { name: "Continue original upload", exact: true }).click();
  await expect(
    page.locator("[data-seed-item]").getByText("Processing", { exact: true }),
  ).toBeVisible();
  expect(evidence(data).batches[0]!.id).toBe(original.id);
  expect(counts.batches).toBe(1);
  expect(counts.sessions).toBe(2);
  expect(counts.puts).toBe(1);
  expect(counts.confirms).toBe(0);
});

test("bounded status timeout retains original identity and ignores its late response", async ({
  page,
}) => {
  const { data, counts } = await setup(page),
    row = await upload(page);
  await expect(row.getByText("Processing", { exact: true })).toBeVisible();
  const original = evidence(data).batches[0]!,
    item = original.items[0]!;
  await page.clock.install();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    received = new Promise<void>((resolve) => {
      entered = resolve;
    });
  await page.route(`${API}/admin/content-seeding/batches/${original.id}`, async (route) => {
    const response = await route.fetch();
    entered();
    await gate;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await page.getByRole("button", { name: "Refresh original batch", exact: true }).click();
  await received;
  await page.clock.fastForward(16000);
  await expect(page.getByText(/Current status could not be read/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh original batch", exact: true }),
  ).toBeEnabled();
  release();
  await page.unroute(`${API}/admin/content-seeding/batches/${original.id}`);
  db("ready", { ...data, itemId: item.id });
  await page.getByRole("button", { name: "Refresh original batch", exact: true }).click();
  await expect(row.getByRole("button", { name: "Publish", exact: true })).toBeEnabled();
  expect(evidence(data).batches[0]!.id).toBe(original.id);
  expect(counts.batches).toBe(1);
  expect(counts.puts).toBe(1);
  expect(counts.confirms).toBe(0);
  expect(counts.publishes).toBe(0);
});

test("upload completion authority rejection immediately conceals private import controls", async ({
  page,
}) => {
  const { data, counts } = await setup(page);
  await page.route(`${API}/media/uploads/sessions/complete`, async (route) => {
    db("revoke", data);
    await route.continue();
  });
  await page.getByRole("button", { name: "Upload for review", exact: true }).click();
  await expect(page.locator("[data-import-private]")).toHaveCount(0);
  await expect(page.getByText("Original import film", { exact: true })).toHaveCount(0);
  expect(counts.batches).toBe(1);
  expect(counts.completes).toBe(1);
  expect(counts.confirms).toBe(0);
  expect(counts.publishes).toBe(0);
});

test("verification expiry after byte upload finalizes only the original session after explicit review", async ({
  page,
}) => {
  const { data, counts, mfa } = await setup(page);
  // Age only the isolated test actor's assurance in memory. The real API guard
  // must reject completion; there is no fabricated completion/step-up response.
  await page.route("https://e2e-upload.invalid/**", async (route) => {
    if (route.request().method() === "PUT") {
      counts.puts++;
      const cookie = (await page.context().cookies()).find(
        (value) => value.name === "ayin_session",
      )!;
      const payload = JSON.parse(
        Buffer.from(cookie.value.split(".")[1]!, "base64url").toString("utf8"),
      );
      expect(payload.sub).toBe(data.accountId);
      payload.reauthAt = Math.floor(Date.now() / 1000) - 301;
      const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const signature = createHmac("sha256", "task-29-e2e-auth-secret-with-more-than-32-characters")
        .update(encoded)
        .digest("base64url");
      await page.context().addCookies([{ ...cookie, value: `v1.${encoded}.${signature}` }]);
    }
    await route.fulfill({
      status: route.request().method() === "OPTIONS" ? 204 : 200,
      body: "",
      headers: {
        "access-control-allow-origin": WEB,
        "access-control-allow-methods": "PUT,OPTIONS",
        "access-control-allow-headers": "content-type",
        etag: '"import-expiry-object"',
      },
    });
  });
  await upload(page);
  const dialog = page.getByRole("dialog", { name: "Confirm your identity", exact: true });
  await expect(dialog).toBeVisible();
  const original = evidence(data).batches[0]!,
    item = original.items[0]!;
  expect(counts.puts).toBe(1);
  expect(counts.completes).toBe(1);
  expect(item.status).toBe("UPLOADING");
  await dialog.getByLabel("Password", { exact: true }).fill("strong-pass-123");
  await dialog
    .getByLabel("Authenticator code", { exact: true })
    .fill(generateTotpCode(mfa.secret, totpCounter() + 1n));
  await dialog.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(counts.completes).toBe(1);
  expect(counts.puts).toBe(1);
  const finish = page.getByRole("button", { name: "Finish original upload", exact: true });
  await expect(finish).toBeEnabled();
  await finish.evaluate((node) => {
    (node as HTMLButtonElement).click();
    (node as HTMLButtonElement).click();
  });
  await expect(
    page.locator("[data-seed-item]").getByText("Processing", { exact: true }),
  ).toBeVisible();
  const after = evidence(data);
  expect(after.batches).toHaveLength(1);
  expect(after.batches[0]!.id).toBe(original.id);
  expect(after.batches[0]!.items[0]!.id).toBe(item.id);
  expect(counts.batches).toBe(1);
  expect(counts.sessions).toBe(1);
  expect(counts.puts).toBe(1);
  expect(counts.completes).toBe(2);
  expect(counts.confirms).toBe(0);
  expect(counts.publishes).toBe(0);
});

test("opaque multipart resume rejection conceals prior native fields before authority reread", async ({
  page,
}) => {
  const { data, counts } = await setup(page);
  await page.locator("#seed-file").evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array(64 * 1024 * 1024)], "multipart.mp4", { type: "video/mp4" }),
    );
    (element as HTMLInputElement).files = transfer.files;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  let resumes = 0;
  await page.route(`${API}/media/uploads/sessions/resume`, async (route) => {
    resumes++;
    db("revoke", data);
    await route.continue();
  });
  await page.getByRole("button", { name: "Upload for review", exact: true }).click();
  await expect.poll(() => resumes).toBe(1);
  await expect(page.locator("[data-import-private]")).toHaveCount(0);
  expect(counts.puts).toBe(0);
  expect(counts.completes).toBe(0);
  expect(counts.publishes).toBe(0);
});

test("rolling back after a definitive completion rejection clears the finalization continuation", async ({
  page,
}) => {
  const { counts } = await setup(page);
  await page.route(`${API}/media/uploads/sessions/complete`, (route) =>
    route.fulfill({
      status: 403,
      json: { error: { code: "STEP_UP_REQUIRED", message: "Controlled explicit rejection" } },
    }),
  );
  await upload(page);
  await page
    .getByRole("dialog", { name: "Confirm your identity", exact: true })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Finish original upload", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Refresh original batch", exact: true }).click();
  await page.getByRole("button", { name: "Roll back unpublished batch", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Roll back batch", exact: true })
    .click();
  await expect(
    page.locator("[data-seed-item]").getByText("Rolled back", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finish original upload", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Add another item", exact: true }).click();
  await expect(page.locator("#seed-title")).toHaveValue("");
  expect(counts.completes).toBe(1);
  expect(counts.rollbacks).toBe(1);
});

test("rollback also clears a rejected upload-session continuation before any bytes were sent", async ({
  page,
}) => {
  const { counts } = await setup(page);
  await page.route(`${API}/admin/content-seeding/items/*/upload-session`, (route) =>
    route.fulfill({
      status: 403,
      json: { error: { code: "STEP_UP_REQUIRED", message: "Controlled explicit rejection" } },
    }),
  );
  await upload(page);
  await page
    .getByRole("dialog", { name: "Confirm your identity", exact: true })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Continue original upload", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Refresh original batch", exact: true }).click();
  await page.getByRole("button", { name: "Roll back unpublished batch", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Roll back batch", exact: true })
    .click();
  await expect(
    page.locator("[data-seed-item]").getByText("Rolled back", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue original upload", exact: true }),
  ).toHaveCount(0);
  expect(counts.sessions).toBe(1);
  expect(counts.puts).toBe(0);
  expect(counts.completes).toBe(0);
  expect(counts.rollbacks).toBe(1);
});
