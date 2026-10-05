import { execFileSync } from "node:child_process";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000",
  password = "strong-pass-123";
const section = (page: Page) => page.locator('[aria-labelledby="privacy-data-title"]');
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
    throw Error("Requires isolated local ayin_e2e");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
async function register(page: Page, suffix: string) {
  const response = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: {
      name: "Actual privacy owner",
      email: `privacy-recovery-${suffix}@e2e.ayin.test`,
      password,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).user.account.id as string;
}
async function initial(page: Page, locale = "en") {
  await page.goto("/account?lang=" + locale);
  await expect(section(page).locator('input[name="password"]')).toBeVisible();
}
async function fill(page: Page) {
  await section(page).locator('input[name="password"]').fill(password);
  await section(page).locator('input[name="confirmation"]').fill("DELETE MY AYIN ACCOUNT");
}
async function requestDirect(page: Page) {
  expect(
    (
      await page.request.post(API + "/privacy/deletion", {
        headers: { origin: WEB },
        data: { password, confirmation: "DELETE MY AYIN ACCOUNT" },
      })
    ).status(),
  ).toBe(202);
}
for (const locale of ["en", "ar"] as const)
  test(
    "Actual privacy request/cancel ACK survives unavailable reads and explicit recovery " + locale,
    async ({ page }, info) => {
      await register(page, locale);
      await initial(page, locale);
      const workspace = section(page),
        copy = (en: string, ar: string) => (locale === "ar" ? ar : en);
      await fill(page);
      let failRead = false,
        reads = 0,
        requests = 0,
        cancellations = 0;
      await page.route(API + "/privacy/deletion", async (route) => {
        if (route.request().method() === "POST") {
          requests++;
          const response = await route.fetch();
          expect(response.status()).toBe(202);
          expect((await response.json()).state).toBe("REQUESTED");
          failRead = true;
          await route.fulfill({ response });
        } else {
          reads++;
          if (failRead)
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: '{"error":{"message":"Controlled unavailable privacy status"}}',
            });
          else await route.continue();
        }
      });
      await workspace.locator("form").evaluate((form: HTMLFormElement) => {
        form.requestSubmit();
        form.requestSubmit();
      });
      await expect(workspace.getByRole("status")).toContainText(
        copy("Account deletion requested", "طلب حذف"),
      );
      await expect(workspace.getByRole("alert")).toContainText(
        copy("operation was confirmed", "تم تأكيد العملية"),
      );
      expect(requests).toBe(1);
      expect(reads).toBe(1);
      await expect(
        workspace.getByRole("button", {
          name: copy("Download my data", "تنزيل بياناتي"),
          exact: true,
        }),
      ).toBeDisabled();
      await expect(workspace.locator("form")).toHaveCount(0);
      expect((await (await page.request.get(API + "/privacy/deletion")).json()).request.state).toBe(
        "REQUESTED",
      );
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        const box = await workspace.boundingBox();
        if (!box) throw Error("Missing privacy workspace");
        const height = Math.max(844, Math.ceil(box.height) + 240);
        await page.setViewportSize({ width, height });
        await workspace.evaluate((node) =>
          node.scrollIntoView({ behavior: "instant", block: "center" }),
        );
        await expect
          .poll(async () => {
            const b = await workspace.boundingBox();
            return Boolean(b && b.y >= 80 && b.y + b.height <= height - 80);
          })
          .toBe(true);
        await info.attach(`account-privacy-${locale}-${width}-recovery`, {
          body: await workspace.screenshot({
            path: info.outputPath(`design-account-privacy-${locale}-${width}-recovery.png`),
          }),
          contentType: "image/png",
        });
      }
      failRead = false;
      await workspace
        .getByRole("button", {
          name: copy("Read privacy status", "قراءة حالة الخصوصية"),
          exact: true,
        })
        .click();
      await expect(
        workspace.getByRole("button", {
          name: copy("Cancel deletion", "إلغاء طلب الحذف"),
          exact: true,
        }),
      ).toBeVisible();
      expect(requests).toBe(1);
      expect(reads).toBe(2);
      await page.route(API + "/privacy/deletion/cancel", async (route) => {
        cancellations++;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        expect(await response.json()).toEqual({ cancelled: true });
        failRead = true;
        await route.fulfill({ response });
      });
      await workspace
        .getByRole("button", { name: copy("Cancel deletion", "إلغاء طلب الحذف"), exact: true })
        .click();
      await expect(workspace.getByRole("status")).toContainText(
        copy("Deletion request cancelled", "تم إلغاء طلب الحذف"),
      );
      await expect(workspace.getByRole("alert")).toContainText(
        copy("operation was confirmed", "تم تأكيد العملية"),
      );
      expect(cancellations).toBe(1);
      expect(reads).toBe(3);
      const actual = (await (await page.request.get(API + "/privacy/deletion")).json()).request;
      expect(actual.state).toBe("CANCELLED");
      expect(actual.cancelledAt).not.toBeNull();
      failRead = false;
      await workspace
        .getByRole("button", {
          name: copy("Read privacy status", "قراءة حالة الخصوصية"),
          exact: true,
        })
        .click();
      await expect(workspace.getByRole("alert")).toHaveCount(0);
      await expect(
        workspace.locator("strong", { hasText: copy("Deletion cancelled", "تم الإلغاء") }),
      ).toBeVisible();
      expect(cancellations).toBe(1);
      expect(requests).toBe(1);
      expect(reads).toBe(4);
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        const box = await workspace.boundingBox();
        if (!box) throw Error("Missing current privacy facts");
        const height = Math.max(844, Math.ceil(box.height) + 240);
        await page.setViewportSize({ width, height });
        await workspace.evaluate((node) =>
          node.scrollIntoView({ behavior: "instant", block: "center" }),
        );
        await expect
          .poll(async () => {
            const b = await workspace.boundingBox();
            return Boolean(b && b.y >= 80 && b.y + b.height <= height - 80);
          })
          .toBe(true);
        await info.attach(`account-privacy-${locale}-${width}-record`, {
          body: await workspace.screenshot({
            path: info.outputPath(`design-account-privacy-${locale}-${width}-record.png`),
          }),
          contentType: "image/png",
        });
      }
    },
  );
test("Lost actual deletion response never replays and requires explicit current status", async ({
  page,
}) => {
  await register(page, "lost");
  await initial(page);
  await fill(page);
  let writes = 0,
    reads = 0;
  page.on("request", (r) => {
    if (r.url() === API + "/privacy/deletion" && r.method() === "GET") reads++;
  });
  await page.route(API + "/privacy/deletion", async (route) => {
    if (route.request().method() === "GET") {
      await route.continue();
      return;
    }
    writes++;
    const actual = await route.fetch();
    expect(actual.status()).toBe(202);
    await route.abort();
  });
  await section(page)
    .getByRole("button", { name: "Request account deletion", exact: true })
    .click();
  await expect(section(page).getByRole("alert")).toContainText("response was not confirmed");
  await expect(section(page).getByRole("status")).toHaveCount(0);
  expect(writes).toBe(1);
  expect(reads).toBe(0);
  await expect(section(page).locator("form")).toHaveCount(0);
  expect((await (await page.request.get(API + "/privacy/deletion")).json()).request.state).toBe(
    "REQUESTED",
  );
  await section(page).getByRole("button", { name: "Read privacy status", exact: true }).click();
  await expect(
    section(page).getByRole("button", { name: "Cancel deletion", exact: true }),
  ).toBeVisible();
  expect(writes).toBe(1);
  expect(reads).toBe(1);
});
test("Malformed actual cancellation ACK cannot invent a timestamp or replay", async ({ page }) => {
  await register(page, "malformed");
  await requestDirect(page);
  await page.goto("/account");
  const button = section(page).getByRole("button", { name: "Cancel deletion", exact: true });
  await expect(button).toBeVisible();
  let writes = 0;
  await page.route(API + "/privacy/deletion/cancel", async (route) => {
    writes++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"cancelled":false}',
    });
  });
  await button.click();
  await expect(section(page).getByRole("alert")).toContainText("response was not confirmed");
  await expect(section(page).getByRole("status")).toHaveCount(0);
  expect(writes).toBe(1);
  const actual = (await (await page.request.get(API + "/privacy/deletion")).json()).request;
  expect(actual.state).toBe("CANCELLED");
  expect(actual.cancelledAt).not.toBeNull();
  await section(page).getByRole("button", { name: "Read privacy status", exact: true }).click();
  await expect(section(page).locator("strong", { hasText: "Deletion cancelled" })).toBeVisible();
  expect(writes).toBe(1);
});
test("Same-password account switch creates zero wrong-account deletion requests", async ({
  page,
}) => {
  await register(page, "scope-a");
  await initial(page);
  await fill(page);
  await register(page, "scope-b");
  let writes = 0;
  page.on("request", (r) => {
    if (r.url() === API + "/privacy/deletion" && r.method() === "POST") writes++;
  });
  await section(page)
    .getByRole("button", { name: "Request account deletion", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Account review", exact: true })).toBeVisible();
  await expect(section(page).locator("[data-private-account-privacy]")).toBeHidden();
  expect(writes).toBe(0);
  expect((await (await page.request.get(API + "/privacy/deletion")).json()).request).toBeNull();
  await page.getByRole("button", { name: "Read current account", exact: true }).click();
  await expect(section(page).locator('[name="password"]')).toHaveValue("");
  expect(writes).toBe(0);
});
test("Actual export read followed by account switch never downloads the old account file", async ({
  page,
}) => {
  const a = await register(page, "export-a");
  await initial(page);
  let swapped = false,
    b: string | undefined,
    downloads = 0;
  page.on("download", () => {
    downloads++;
  });
  await page.route(API + "/privacy/export", async (route) => {
    if (swapped) {
      await route.continue();
      return;
    }
    swapped = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect((await response.json()).account.id).toBe(a);
    b = await register(page, "export-b");
    await route.fulfill({ response });
  });
  await section(page).getByRole("button", { name: "Download my data", exact: true }).click();
  await expect(page.getByRole("region", { name: "Account review", exact: true })).toBeVisible();
  await expect(section(page).locator("[data-private-account-privacy]")).toBeHidden();
  expect(downloads).toBe(0);
  await page.getByRole("button", { name: "Read current account", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await section(page).getByRole("button", { name: "Download my data", exact: true }).click();
  const download = await downloadPromise,
    file = await download.path();
  if (!file) throw Error("Missing actual downloaded export");
  expect(JSON.parse(await readFile(file, "utf8")).account.id).toBe(b);
  expect(downloads).toBe(1);
});
test("Controlled oversized privacy export produces no partial download or false success", async ({
  page,
}) => {
  await register(page, "oversized");
  await initial(page);
  let downloads = 0;
  page.on("download", () => {
    downloads++;
  });
  await page.route(API + "/privacy/export", async (route) => {
    const actual = await route.fetch();
    expect(actual.status()).toBe(200);
    const body = "x".repeat(10 * 1024 * 1024 + 1);
    await route.fulfill({
      response: actual,
      body,
      headers: { ...actual.headers(), "content-length": String(body.length) },
    });
  });
  await section(page).getByRole("button", { name: "Download my data", exact: true }).click();
  await expect(section(page).getByRole("alert")).toContainText("10 MB");
  await expect(section(page).getByRole("status")).toHaveCount(0);
  expect(downloads).toBe(0);
});
test("Controlled privacy pagehide hides before secret reset and pageshow requires manual review", async ({
  page,
}) => {
  await register(page, "freeze");
  await initial(page);
  await fill(page);
  let reads = 0,
    writes = 0;
  page.on("request", (r) => {
    if (r.url() === API + "/privacy/deletion") {
      if (r.method() === "GET") reads++;
      else writes++;
    }
  });
  const first = await page.evaluate(() => {
    const body = document.querySelector<HTMLElement>("[data-private-account-privacy]"),
      descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "hidden");
    if (!body || !descriptor?.set || !descriptor.get) throw Error("Missing native privacy body");
    let observed: { draftPresent: boolean; visible: boolean } | undefined;
    Object.defineProperty(body, "hidden", {
      configurable: true,
      get() {
        return descriptor.get?.call(body);
      },
      set(value: boolean) {
        descriptor.set?.call(body, value);
        if (value && observed === undefined)
          observed = {
            draftPresent:
              body.querySelector<HTMLInputElement>('[name="password"]')?.value ===
              "strong-pass-123",
            visible: body.checkVisibility(),
          };
      },
    });
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    return observed;
  });
  expect(first).toEqual({ draftPresent: true, visible: false });
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
  );
  await expect(section(page).locator("[data-private-account-privacy]")).toBeHidden();
  expect(reads).toBe(0);
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "Read current account", exact: true }).click();
  await expect(section(page).locator('[name="password"]')).toHaveValue("");
  await expect(section(page).locator('[name="confirmation"]')).toHaveValue("");
  expect(reads).toBe(1);
  expect(writes).toBe(0);
});
