import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
test.use({ serviceWorkers: "block" });
function db(command: string, payload: object) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/admin-tv-fixture.mjs"), command, JSON.stringify(payload)],
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
async function seed(page: Page, suffix: string) {
  const r = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: {
      name: "Actual native TV operator",
      email: "tv-operator-" + suffix + "@e2e.ayin.test",
      password: "strong-pass-123",
    },
  });
  expect(r.ok()).toBe(true);
  const operator = (await r.json()).user;
  await enrollMfa(page.request);
  return { operator, ...db("seed", { accountId: operator.account.id }) };
}
const rowFor = (page: Page, id: string) =>
  page.getByRole("main").locator(`[data-tv-record="${id}"]`);
async function unlock(page: Page, ar = false) {
  const main = page.getByRole("main");
  await main
    .getByRole("button", {
      name: ar ? "قراءة القناة التلفزيونية الأصلية" : "Read original TV",
      exact: true,
    })
    .click();
  const done = main.getByRole("button", {
    name: ar ? "راجعت الحالة؛ فعّل عملية أخرى" : "I reviewed; enable another operation",
    exact: true,
  });
  await expect(done).toBeEnabled();
  await done.click();
}
for (const locale of ["en", "ar"] as const)
  test(
    "Native TV retains paged reasons and actual acknowledged status decisions " + locale,
    async ({ page }, info) => {
      const data = await seed(page, locale),
        ar = locale === "ar",
        copy = (en: string, arabic: string) => (ar ? arabic : en);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/admin/tv?query=" + encodeURIComponent(data.query) + "&lang=" + locale);
      const main = page.getByRole("main"),
        row = rowFor(page, data.targetId),
        reason = row.getByLabel(
          copy("TV decision reason (8–500 characters)", "سبب قرار القناة التلفزيونية (٨–٥٠٠ حرف)"),
          { exact: true },
        );
      await expect(main.getByRole("heading", { level: 1 })).toHaveText(
        copy("Creator TV", "قنوات المنشئين التلفزيونية"),
      );
      await expect(main.locator("article")).toHaveCount(25);
      await reason.fill("Retained paged TV decision");
      await main.getByRole("button", { name: copy("Next", "التالي"), exact: true }).click();
      await expect(main.locator("article")).toHaveCount(1);
      await main.getByRole("button", { name: copy("Previous", "السابق"), exact: true }).click();
      await expect(reason).toHaveValue("Retained paged TV decision");
      await row.locator("summary").click();
      await expect(row.getByText("Actual scheduled film", { exact: true })).toHaveCount(2);
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await expect(page.locator("#tv-query")).toHaveAttribute("dir", "auto");
        await expect(row.locator("textarea")).toHaveAttribute("dir", "auto");
        expect(
          await page.locator("#tv-query").evaluate((node) => getComputedStyle(node).direction),
        ).toBe("ltr");
        expect(
          await row.locator("textarea").evaluate((node) => getComputedStyle(node).direction),
        ).toBe("ltr");
        const heading = main.getByRole("heading", { level: 1 });
        await heading.scrollIntoViewIfNeeded();
        expect(
          await heading.evaluate((node) => {
            const r = node.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= innerHeight;
          }),
        ).toBe(true);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        await page.screenshot({
          path: info.outputPath(`design-admin-tv-${locale}-${width}-heading.png`),
        });
        await row.screenshot({
          path: info.outputPath(`design-admin-tv-${locale}-${width}-record.png`),
        });
      }
      let writes = 0,
        reads = 0;
      page.on("request", (r) => {
        const u = new URL(r.url());
        if (u.origin !== API || !u.pathname.startsWith("/admin/control/tv")) return;
        if (r.method() === "PATCH") writes++;
        else if (r.method() === "GET") reads++;
      });
      await row
        .getByRole("button", { name: copy("Take off air", "إيقاف البث"), exact: true })
        .click();
      await expect(main.getByTestId("tv-ack")).toContainText(copy("Off air", "خارج البث"));
      expect(writes).toBe(1);
      expect(reads).toBe(0);
      await expect(reason).toHaveValue("");
      await page.route(API + "/admin/control/tv?**", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"message":"Controlled TV read failure"}',
        }),
      );
      await main
        .getByRole("button", {
          name: copy("Read TV records", "قراءة سجلات القنوات التلفزيونية"),
          exact: true,
        })
        .click();
      await expect(main.locator("article")).toHaveCount(0);
      await expect(main.getByTestId("tv-ack")).toContainText(copy("Off air", "خارج البث"));
      expect(writes).toBe(1);
      await page.unroute(API + "/admin/control/tv?**");
      await main
        .getByRole("button", {
          name: copy("Read TV records", "قراءة سجلات القنوات التلفزيونية"),
          exact: true,
        })
        .click();
      await expect(row).toBeVisible();
      await unlock(page, ar);
      for (const [action, value] of [
        [copy("Enable TV", "تفعيل القناة التلفزيونية"), "ACTIVE"],
        [copy("Disable TV", "تعطيل القناة التلفزيونية"), "DISABLED"],
      ] as const) {
        await reason.fill("Actual explicit " + value + " decision");
        await row.getByRole("button", { name: action, exact: true }).click();
        await expect(main.getByTestId("tv-ack")).toContainText(
          value === "ACTIVE" ? copy("Active", "نشط") : copy("Disabled", "معطّل"),
        );
        await unlock(page, ar);
      }
      const evidence = db("evidence", {
        accountId: data.operator.account.id,
        targetId: data.targetId,
      });
      expect(evidence.target.status).toBe("DISABLED");
      expect(evidence.target.disabledAt).not.toBeNull();
      expect(evidence.sessions).toEqual(data.sessions);
      expect(evidence.audits).toEqual([
        {
          action: "creator_tv.status_updated",
          reason: "Retained paged TV decision",
          metadata: { status: "OFF_AIR" },
        },
        {
          action: "creator_tv.status_updated",
          reason: "Actual explicit ACTIVE decision",
          metadata: { status: "ACTIVE" },
        },
        {
          action: "creator_tv.status_updated",
          reason: "Actual explicit DISABLED decision",
          metadata: { status: "DISABLED" },
        },
      ]);
      expect(writes).toBe(3);
    },
  );
test("Native TV commits lost responses once and recovers the original target without replay", async ({
  page,
}) => {
  const data = await seed(page, "lost");
  await page.goto("/admin/tv?query=" + data.query);
  const main = page.getByRole("main"),
    row = rowFor(page, data.targetId),
    reason = row.getByLabel("TV decision reason (8–500 characters)", { exact: true });
  await reason.fill("Actual committed lost TV decision");
  let writes = 0;
  await page.route(API + "/admin/control/tv/" + data.targetId, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    writes++;
    const actual = await route.fetch();
    expect(actual.status()).toBe(200);
    await route.abort();
  });
  await row.getByRole("button", { name: "Disable TV", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("response was not confirmed");
  await expect(reason).toHaveValue("Actual committed lost TV decision");
  await expect(row.getByRole("button", { name: "Disable TV", exact: true })).toBeDisabled();
  await unlock(page);
  expect(writes).toBe(1);
  const evidence = db("evidence", { accountId: data.operator.account.id, targetId: data.targetId });
  expect(evidence.target.status).toBe("DISABLED");
  expect(evidence.audits).toHaveLength(1);
  expect(evidence.sessions).toEqual(data.sessions);
});
test("Native TV rejects real stale409, retains the reason and reviews the original winner without replay", async ({
  page,
}) => {
  const data = await seed(page, "stale");
  await page.goto("/admin/tv?query=" + data.query);
  const main = page.getByRole("main"),
    row = rowFor(page, data.targetId),
    reason = row.getByLabel("TV decision reason (8–500 characters)", { exact: true });
  await reason.fill("Retained stale TV decision");
  const winner = db("change-target", {
    accountId: data.operator.account.id,
    targetId: data.targetId,
  });
  let writes = 0;
  page.on("request", (r) => {
    if (r.url() === API + "/admin/control/tv/" + data.targetId && r.method() === "PATCH") writes++;
  });
  const pending = page.waitForResponse(
    (r) =>
      r.url() === API + "/admin/control/tv/" + data.targetId && r.request().method() === "PATCH",
  );
  await row.getByRole("button", { name: "Disable TV", exact: true }).click();
  expect((await pending).status()).toBe(409);
  await expect(main.getByRole("alert")).toContainText("response was not confirmed");
  await expect(reason).toHaveValue("Retained stale TV decision");
  await unlock(page);
  expect(writes).toBe(1);
  const evidence = db("evidence", { accountId: data.operator.account.id, targetId: data.targetId });
  expect(evidence.target.status).toBe(winner.status);
  expect(evidence.audits).toHaveLength(0);
});
test("Native TV exact step-up cancellation retains reasons with one request and no committed decision", async ({
  page,
}) => {
  const data = await seed(page, "stepup");
  await page.goto("/admin/tv?query=" + data.query);
  const row = rowFor(page, data.targetId),
    reason = row.getByLabel("TV decision reason (8–500 characters)", { exact: true });
  await reason.fill("Retained TV step-up decision");
  let writes = 0;
  await page.route(API + "/admin/control/tv/" + data.targetId, (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    writes++;
    return route.fulfill({
      status: 403,
      contentType: "application/json",
      body: '{"error":{"code":"STEP_UP_REQUIRED"}}',
    });
  });
  await row.getByRole("button", { name: "Disable TV", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(reason).toHaveValue("Retained TV step-up decision");
  await expect(row.getByRole("button", { name: "Disable TV", exact: true })).toBeEnabled();
  expect(writes).toBe(1);
  expect(
    db("evidence", { accountId: data.operator.account.id, targetId: data.targetId }).audits,
  ).toHaveLength(0);
});
test("Native TV hides all private facts and reasons synchronously before controlled freeze and reads again only explicitly", async ({
  page,
}) => {
  const data = await seed(page, "freeze");
  await page.goto("/admin/tv?query=" + data.query);
  const main = page.getByRole("main"),
    row = rowFor(page, data.targetId),
    reason = row.getByLabel("TV decision reason (8–500 characters)", { exact: true });
  await reason.fill("Retained hidden TV reason");
  let reads = 0;
  page.on("request", (r) => {
    if (r.url().startsWith(API + "/admin/control/tv") && r.method() === "GET") reads++;
  });
  for (const kind of ["pagehide", "visibilitychange"] as const) {
    expect(
      await page.evaluate((kind) => {
        if (kind === "visibilitychange")
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: "hidden",
          });
        (kind === "pagehide" ? window : document).dispatchEvent(new Event(kind));
        return document.querySelector<HTMLElement>("[data-private-tv-records]")?.checkVisibility();
      }, kind),
    ).toBe(false);
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    expect(reads).toBe(kind === "pagehide" ? 0 : 1);
    await main.getByRole("button", { name: "Read TV records", exact: true }).click();
    await expect(row).toBeVisible();
    await expect(reason).toHaveValue("Retained hidden TV reason");
    await main
      .getByRole("button", { name: "I reviewed; enable another operation", exact: true })
      .click();
  }
  expect(
    db("evidence", { accountId: data.operator.account.id, targetId: data.targetId }).audits,
  ).toHaveLength(0);
});
test("Finance receives no native TV fact request", async ({ page }) => {
  const r = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: {
      name: "Actual TV finance denial",
      email: "tv-finance@e2e.ayin.test",
      password: "strong-pass-123",
    },
  });
  const account = (await r.json()).user.account;
  await enrollMfa(page.request);
  db("finance", { accountId: account.id });
  let reads = 0;
  page.on("request", (r) => {
    if (r.url().startsWith(API + "/admin/control/tv")) reads++;
  });
  await page.goto("/admin/tv");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("access changed");
  expect(reads).toBe(0);
});

test("Native tv hides private facts synchronously on actual role loss and clears the old search", async ({
  page,
  request,
}) => {
  const data = await seed(page, "authority-hide");
  await page.goto("/admin/tv?query=" + encodeURIComponent(data.query));
  const main = page.getByRole("main"),
    row = rowFor(page, data.targetId);
  await expect(row).toBeVisible();
  await row
    .getByLabel("TV decision reason (8–500 characters)", { exact: true })
    .fill("Private TV decision reason");
  await row.locator("summary").click();
  const payload = { accountId: data.operator.account.id, targetId: data.targetId };
  const before = db("evidence", payload);
  await page.evaluate(
    ({ marker, fact }) => {
      const node = document.querySelector<HTMLElement>(`[data-private-${marker}-records="true"]`);
      const native = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "hidden");
      if (!node || !native?.get || !native.set)
        throw Error("Expected private body and native hidden setter");
      if (!node.textContent?.includes(fact))
        throw Error("Expected actual private fact before observing hide");
      const get = native.get,
        set = native.set;
      Object.defineProperty(node, "hidden", {
        configurable: true,
        get() {
          return get.call(node);
        },
        set(value) {
          set.call(node, value);
          if (value && !(window as unknown as { authorityHide?: object }).authorityHide)
            (window as unknown as { authorityHide: object }).authorityHide = {
              oldFactPresent: node.textContent?.includes(fact),
              visible: node.checkVisibility(),
            };
        },
      });
    },
    { marker: "tv", fact: data.name },
  );
  db("change-role", { accountId: data.operator.account.id });
  let privateReads = 0,
    writes = 0;
  page.on("request", (r) => {
    if (
      ["POST", "PATCH", "DELETE"].includes(r.method()) &&
      r.url().startsWith(API + "/admin/control/tv")
    )
      writes++;
    if (r.method() === "GET" && r.url().startsWith(API + "/admin/control/tv")) privateReads++;
  });
  await row.getByRole("button", { name: "Disable TV", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("access changed");
  expect(
    await page.evaluate(() => (window as unknown as { authorityHide: object }).authorityHide),
  ).toEqual({ oldFactPresent: true, visible: false });
  await expect(main.locator('[data-private-tv-records="true"]')).toBeHidden();
  await expect(main.locator("article")).toHaveCount(0);
  await expect(main.getByLabel("TV or owner channel name", { exact: true })).toHaveValue("");
  expect(privateReads).toBe(0);
  expect(writes).toBe(0);
  expect(db("evidence", payload)).toEqual(before);
});
