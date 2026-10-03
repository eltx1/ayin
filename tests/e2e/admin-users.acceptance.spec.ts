import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
test.use({ serviceWorkers: "block" });
function db(command: string, payload: object) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/admin-users-fixture.mjs"), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
    throw Error("Requires isolated local ayin_e2e");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
async function register(context: APIRequestContext, email: string) {
  const response = await context.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: { name: "Actual account operator", email, password: "strong-pass-123" },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).user;
}
async function seed(page: Page, request: APIRequestContext, suffix: string) {
  const operator = await register(page.request, "users-operator-" + suffix + "@e2e.ayin.test");
  await enrollMfa(page.request);
  const target = await register(request, "users-target-" + suffix + "@e2e.ayin.test");
  return {
    operator,
    ...db("seed", { accountId: operator.account.id, targetId: target.account.id }),
  };
}
const rowFor = (page: Page, email: string) =>
  page
    .getByRole("main")
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: email, exact: true }) });
async function unlock(page: Page, ar = false) {
  const main = page.getByRole("main");
  await main
    .getByRole("button", {
      name: ar ? "قراءة الحساب الأصلي" : "Read original account",
      exact: true,
    })
    .click();
  const button = main.getByRole("button", {
    name: ar ? "راجعت الحالة؛ فعّل عملية أخرى" : "I reviewed; enable another operation",
    exact: true,
  });
  await expect(button).toBeEnabled();
  await button.click();
}
for (const locale of ["en", "ar"] as const)
  test(
    "Native accounts retain paged drafts and verify actual name, status and session decisions " +
      locale,
    async ({ page, request }, info) => {
      test.setTimeout(120000);
      const data = await seed(page, request, locale),
        ar = locale === "ar",
        copy = (en: string, arabic: string) => (ar ? arabic : en);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/admin/users?query=" + encodeURIComponent(data.query) + "&lang=" + locale);
      const main = page.getByRole("main"),
        row = rowFor(page, data.email),
        pager = main.getByRole("navigation", {
          name: copy("Account pages", "صفحات الحسابات"),
          exact: true,
        });
      await expect(main.getByRole("heading", { level: 1 })).toHaveText(
        copy("Users & accounts", "المستخدمون والحسابات"),
      );
      await expect(main.locator("article")).toHaveCount(25);
      await row
        .getByLabel(copy("New display name", "الاسم الظاهر الجديد"), { exact: true })
        .fill("Actual acknowledged account");
      await pager.getByRole("button", { name: copy("Next", "التالي"), exact: true }).click();
      await expect(main.locator("article")).toHaveCount(1);
      await pager.getByRole("button", { name: copy("Previous", "السابق"), exact: true }).click();
      await expect(
        row.getByLabel(copy("New display name", "الاسم الظاهر الجديد"), { exact: true }),
      ).toHaveValue("Actual acknowledged account");
      await row
        .locator("summary")
        .filter({ hasText: copy("Account access decisions", "قرارات وصول الحساب") })
        .click();
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        const heading = main.getByRole("heading", { level: 1 });
        await heading.scrollIntoViewIfNeeded();
        await expect(heading).toBeVisible();
        expect(
          await heading.evaluate((node) => {
            const bounds = node.getBoundingClientRect();
            return bounds.top >= 0 && bounds.bottom <= innerHeight;
          }),
        ).toBe(true);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        await page.screenshot({
          path: info.outputPath("design-admin-users-" + locale + "-" + width + "-heading.png"),
        });
        await row.screenshot({
          path: info.outputPath("design-admin-users-" + locale + "-" + width + "-record.png"),
        });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
      }
      let reads = 0,
        writes = 0;
      page.on("request", (request) => {
        if (
          !request.url().startsWith(API + "/admin/control/users") &&
          !request.url().startsWith(API + "/admin/operations/accounts/")
        )
          return;
        if (request.method() === "GET") reads++;
        else writes++;
      });
      await row
        .getByLabel(
          copy("Session revocation reason (8–500 characters)", "سبب إبطال الجلسات (٨–٥٠٠ حرف)"),
          { exact: true },
        )
        .fill("Retained independent session reason");
      await row
        .getByRole("button", { name: copy("Save display name", "حفظ الاسم الظاهر"), exact: true })
        .click();
      await expect(main.getByTestId("account-ack")).toContainText("Actual acknowledged account");
      expect(writes).toBe(1);
      expect(reads).toBe(0);
      expect(
        db("evidence", { accountId: data.operator.account.id, targetId: data.targetId }).audits,
      ).toEqual([{ action: "account.updated", reason: null }]);
      const beforeFailure = reads;
      await page.route(API + "/admin/control/users?**", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"message":"Controlled read failure"}',
        }),
      );
      await main
        .getByRole("button", {
          name: copy("Read account records", "قراءة سجلات الحسابات"),
          exact: true,
        })
        .click();
      await expect(main.locator("article")).toHaveCount(0);
      await expect(main.getByTestId("account-ack")).toContainText("Actual acknowledged account");
      expect(reads).toBe(beforeFailure + 1);
      expect(writes).toBe(1);
      await page.unroute(API + "/admin/control/users?**");
      await main
        .getByRole("button", {
          name: copy("Read account records", "قراءة سجلات الحسابات"),
          exact: true,
        })
        .click();
      await expect(row).toBeVisible();
      await unlock(page, ar);
      await row
        .locator("summary")
        .filter({ hasText: copy("Account access decisions", "قرارات وصول الحساب") })
        .click();
      await expect(
        row.getByLabel(
          copy("Session revocation reason (8–500 characters)", "سبب إبطال الجلسات (٨–٥٠٠ حرف)"),
          { exact: true },
        ),
      ).toHaveValue("Retained independent session reason");
      await row
        .getByLabel(
          copy("Account status reason (8–500 characters)", "سبب حالة الحساب (٨–٥٠٠ حرف)"),
          { exact: true },
        )
        .fill("Actual reviewed suspension");
      await row
        .getByRole("button", { name: copy("Suspend account", "إيقاف الحساب"), exact: true })
        .click();
      await expect(main.getByTestId("account-ack")).toContainText(copy("Suspended", "موقوف"));
      expect(writes).toBe(2);
      expect((await request.get(API + "/auth/me")).status()).toBe(401);
      await unlock(page, ar);
      await row
        .getByLabel(
          copy("Account status reason (8–500 characters)", "سبب حالة الحساب (٨–٥٠٠ حرف)"),
          { exact: true },
        )
        .fill("Actual reviewed reactivation");
      await row
        .getByRole("button", {
          name: copy("Reactivate account", "إعادة تنشيط الحساب"),
          exact: true,
        })
        .click();
      await expect(main.getByTestId("account-ack")).toContainText(copy("Active", "نشط"));
      expect(writes).toBe(3);
      await unlock(page, ar);
      const login = await request.post(API + "/auth/login", {
        headers: { origin: WEB },
        data: { email: data.email, password: "strong-pass-123" },
      });
      expect(login.ok()).toBe(true);
      expect((await request.get(API + "/auth/me")).status()).toBe(200);
      await row
        .getByRole("button", {
          name: copy("Revoke existing sessions", "إبطال الجلسات القائمة"),
          exact: true,
        })
        .click();
      await expect(main.getByTestId("account-ack")).toContainText(
        copy("Existing sessions revoked", "إبطال الجلسات القائمة"),
      );
      expect(writes).toBe(4);
      expect((await request.get(API + "/auth/me")).status()).toBe(401);
      const evidence = db("evidence", {
        accountId: data.operator.account.id,
        targetId: data.targetId,
      });
      expect(evidence.target).toMatchObject({
        displayName: "Actual acknowledged account",
        status: "ACTIVE",
        authVersion: 3,
      });
      expect(evidence.audits.map((a: { action: string }) => a.action).sort()).toEqual(
        [
          "account.updated",
          "account.status_updated",
          "account.status_updated",
          "account.sessions_revoked",
        ].sort(),
      );
      expect(
        evidence.sessions.every((s: { revokedAt: string | null }) => s.revokedAt !== null),
      ).toBe(true);
      const frozen = await page.evaluate(() => {
        const body = document.querySelector<HTMLElement>('[data-private-account-records="true"]');
        if (!body) throw Error("Expected private body");
        window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
        return body.checkVisibility();
      });
      expect(frozen).toBe(false);
      const beforeRestore = reads;
      await page.evaluate(() =>
        window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
      );
      await expect(main.locator('[data-private-account-records="true"]')).toBeHidden();
      expect(reads).toBe(beforeRestore);
      expect(writes).toBe(4);
      await main
        .getByRole("button", {
          name: copy("Read account records", "قراءة سجلات الحسابات"),
          exact: true,
        })
        .click();
      await expect(row).toBeVisible();
      expect(writes).toBe(4);
    },
  );

test("Lost actual committed account write requires original-target review without replay", async ({
  page,
  request,
}) => {
  const data = await seed(page, request, "lost");
  await page.goto("/admin/users?query=" + encodeURIComponent(data.query));
  const main = page.getByRole("main"),
    row = rowFor(page, data.email);
  await row.getByLabel("New display name", { exact: true }).fill("Actual committed lost name");
  let writes = 0;
  await page.route(API + "/admin/control/users/" + data.targetId, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    writes++;
    const actual = await route.fetch();
    expect(actual.status()).toBe(200);
    await route.abort();
  });
  await row.getByRole("button", { name: "Save display name", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("response was not confirmed");
  await expect(row.getByLabel("New display name", { exact: true })).toHaveValue(
    "Actual committed lost name",
  );
  await expect(row.getByRole("button", { name: "Save display name", exact: true })).toBeDisabled();
  await unlock(page);
  await expect(main.getByTestId("account-review")).toHaveCount(0);
  expect(writes).toBe(1);
  expect(
    db("evidence", { accountId: data.operator.account.id, targetId: data.targetId }).audits,
  ).toEqual([{ action: "account.updated", reason: null }]);
});
test("Explicit account step-up denial retains the original draft and does not replay", async ({
  page,
  request,
}) => {
  const data = await seed(page, request, "stepup");
  await page.goto("/admin/users?query=" + encodeURIComponent(data.query));
  const row = rowFor(page, data.email);
  await row.getByLabel("New display name", { exact: true }).fill("Retained step-up name");
  let writes = 0;
  await page.route(API + "/admin/control/users/" + data.targetId, (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    writes++;
    return route.fulfill({
      status: 403,
      contentType: "application/json",
      body: '{"error":{"code":"STEP_UP_REQUIRED"}}',
    });
  });
  await row.getByRole("button", { name: "Save display name", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row.getByLabel("New display name", { exact: true })).toHaveValue(
    "Retained step-up name",
  );
  await expect(row.getByRole("button", { name: "Save display name", exact: true })).toBeEnabled();
  expect(writes).toBe(1);
  expect(
    db("evidence", { accountId: data.operator.account.id, targetId: data.targetId }).audits,
  ).toEqual([]);
});
test("Finance account issues zero private account reads", async ({ page }) => {
  const operator = await register(page.request, "users-finance-denial@e2e.ayin.test");
  await enrollMfa(page.request);
  db("finance", { accountId: operator.account.id });
  let reads = 0;
  page.on("request", (request) => {
    if (request.url().startsWith(API + "/admin/control/users")) reads++;
  });
  await page.goto("/admin/users");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "authorized Operations account",
  );
  expect(reads).toBe(0);
  await expect(page.getByRole("main").locator("article")).toHaveCount(0);
});

test("A real stale account write retains its draft and original-target recovery never replays it", async ({
  page,
  request,
}) => {
  const data = await seed(page, request, "version");
  await page.goto("/admin/users?query=" + encodeURIComponent(data.query));
  const main = page.getByRole("main"),
    row = rowFor(page, data.email);
  await expect(row).toBeVisible();
  await row.getByLabel("New display name", { exact: true }).fill("Retained stale original name");
  const change = db("change-target", {
    accountId: data.operator.account.id,
    targetId: data.targetId,
  });
  let writes = 0;
  await page.route(API + "/admin/control/users/" + data.targetId, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    writes++;
    expect(route.request().postDataJSON().expectedUpdatedAt).toBe(change.beforeUpdatedAt);
    const actual = await route.fetch();
    expect(actual.status()).toBe(409);
    await route.fulfill({ response: actual });
  });
  await row.getByRole("button", { name: "Save display name", exact: true }).click();
  await expect(main.getByRole("alert")).toBeVisible();
  await expect(row.getByLabel("New display name", { exact: true })).toHaveValue(
    "Retained stale original name",
  );
  await expect(row.getByRole("button", { name: "Save display name", exact: true })).toBeDisabled();
  await unlock(page);
  await expect(row.getByLabel("New display name", { exact: true })).toHaveValue(
    "Retained stale original name",
  );
  expect(writes).toBe(1);
  const evidence = db("evidence", { accountId: data.operator.account.id, targetId: data.targetId });
  expect(evidence.target).toMatchObject({
    displayName: "Actual concurrent winner",
    status: "ACTIVE",
    authVersion: 0,
  });
  expect(evidence.audits).toEqual([]);
  expect(evidence.sessions.every((s: { revokedAt: string | null }) => s.revokedAt === null)).toBe(
    true,
  );
});

test("Native users hides private facts synchronously on actual role loss and clears the old search", async ({
  page,
  request,
}) => {
  const data = await seed(page, request, "authority-hide");
  await page.goto("/admin/users?query=" + encodeURIComponent(data.query));
  const main = page.getByRole("main"),
    row = rowFor(page, data.email);
  await expect(row).toBeVisible();
  await row.getByLabel("New display name", { exact: true }).fill("Private account draft");
  const payload = { accountId: data.operator.account.id, targetId: data.targetId };
  const before = db("evidence", payload);
  await page.evaluate(
    ({ marker, fact }) => {
      const node = document.querySelector<HTMLElement>(`[data-private-${marker}-records="true"]`);
      const native = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "hidden");
      if (!node || !native?.get || !native.set)
        throw Error("Expected private body and native hidden setter");
      const get = native.get,
        set = native.set;
      Object.defineProperty(node, "hidden", {
        configurable: true,
        get() {
          return get.call(node);
        },
        set(value) {
          set.call(node, value);
          if (value)
            (window as unknown as { authorityHide: object }).authorityHide = {
              oldFactPresent: node.textContent?.includes(fact),
              visible: node.checkVisibility(),
            };
        },
      });
    },
    { marker: "account", fact: data.email },
  );
  db("change-role", { accountId: data.operator.account.id });
  let privateReads = 0;
  page.on("request", (r) => {
    if (r.method() === "GET" && r.url().startsWith(API + "/admin/control/users")) privateReads++;
  });
  await main.getByRole("button", { name: "Read account records", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("access changed");
  expect(
    await page.evaluate(() => (window as unknown as { authorityHide: object }).authorityHide),
  ).toEqual({ oldFactPresent: true, visible: false });
  await expect(main.locator('[data-private-account-records="true"]')).toBeHidden();
  await expect(main.locator("article")).toHaveCount(0);
  await expect(main.getByLabel("Email or display name", { exact: true })).toHaveValue("");
  expect(privateReads).toBe(0);
  expect(db("evidence", payload)).toEqual(before);
});
