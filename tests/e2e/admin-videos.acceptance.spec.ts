import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
type Seed = {
  accountId: string;
  query: string;
  targetId: string;
  secondId: string;
  name: string;
  tvId: string;
  unrelatedTvId: string;
  sessions: unknown[];
};
type Evidence = {
  targets: Array<{
    id: string;
    title: string;
    status: string;
    commentsEnabled: boolean;
    updatedAt: string;
  }>;
  preferences: Array<{ videoId: string; tvChannelId: string; included: boolean }>;
  sessions: unknown[];
  audits: Array<{ action: string; reason: string; metadata: Record<string, unknown> }>;
};
function db<T = unknown>(command: string, payload: object): T {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/admin-video-fixture.mjs"), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  ) as T;
}
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
    throw Error("Requires isolated local ayin_e2e");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
async function seed(page: Page, suffix: string): Promise<Seed> {
  const response = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: {
      name: "Actual video moderator",
      email: "native-video-" + suffix + "@e2e.ayin.test",
      password: "strong-pass-123",
    },
  });
  expect(response.ok()).toBe(true);
  const account = (await response.json()).user.account;
  await enrollMfa(page.request);
  return {
    accountId: account.id,
    ...db<Omit<Seed, "accountId">>("seed", { accountId: account.id }),
  };
}
const rowFor = (page: Page, id: string) =>
  page.getByRole("main").locator(`[data-video-record="${id}"]`);
const evidence = (data: Seed) => db<Evidence>("evidence", data);
async function visit(page: Page, data: Seed, locale = "en") {
  await page.goto("/admin/videos?query=" + data.query + "&lang=" + locale);
  await expect(rowFor(page, data.targetId)).toBeVisible();
  await expect(page.locator(`[id^="video-title-"]`)).toHaveCount(0);
  await rowFor(page, data.targetId)
    .locator("summary")
    .filter({ hasText: locale === "ar" ? /^مراجعة الفيديو وتعديله$/ : /^Review and edit video$/ })
    .click();
  await expect(page.locator(`[id^="video-title-"]`)).toHaveCount(1);
}
async function unlock(page: Page, ar = false) {
  const main = page.getByRole("main"),
    copy = (en: string, arabic: string) => (ar ? arabic : en);
  await main
    .getByRole("button", {
      name: copy("Read original videos", "قراءة الفيديوهات الأصلية"),
      exact: true,
    })
    .click();
  await expect(main.getByTestId("video-review")).toBeVisible();
  const done = main.getByRole("button", {
    name: copy("I reviewed; enable another operation", "راجعت الحالة؛ فعّل عملية أخرى"),
    exact: true,
  });
  await expect(done).toBeDisabled();
  await main
    .getByRole("button", {
      name: copy("Read video records", "قراءة سجلات الفيديوهات"),
      exact: true,
    })
    .click();
  await expect(done).toBeEnabled();
  await done.click();
}
for (const locale of ["en", "ar"] as const)
  test(
    "Native video keeps paged metadata and actual single/bulk TV acknowledgments " + locale,
    async ({ page }, info) => {
      test.setTimeout(120_000);
      const data = await seed(page, locale),
        ar = locale === "ar",
        copy = (en: string, arabic: string) => (ar ? arabic : en);
      await page.setViewportSize({ width: 390, height: 844 });
      await visit(page, data, locale);
      const main = page.getByRole("main"),
        row = rowFor(page, data.targetId),
        second = rowFor(page, data.secondId);
      const title = row.getByLabel(copy("Title", "العنوان"), { exact: true }),
        reason = row.getByLabel(
          copy("Video decision reason (8–500 characters)", "سبب قرار الفيديو (٨–٥٠٠ حرف)"),
          { exact: true },
        );
      await expect(main.locator("article")).toHaveCount(25);
      await title.fill(data.name + " reviewed");
      await reason.fill("Retained paged video moderation");
      await main
        .getByRole("button", { name: copy("Next page", "الصفحة التالية"), exact: true })
        .click();
      await expect(main.locator("article")).toHaveCount(1);
      await main
        .getByRole("button", { name: copy("Previous page", "الصفحة السابقة"), exact: true })
        .click();
      await expect(title).toHaveValue(data.name + " reviewed");
      await expect(reason).toHaveValue("Retained paged video moderation");
      await row
        .locator("summary")
        .filter({ hasText: copy("Channel, comments and reports", "القناة والتعليقات والبلاغات") })
        .click();
      await expect(row.getByText(copy("Clip", "مقطع قصير"), { exact: true })).toBeVisible();
      await expect(row.getByText("Actual selected TV", { exact: true })).toBeVisible();
      await expect(
        row.getByLabel(copy("Include in this TV channel", "إدراج في هذه القناة التلفزيونية"), {
          exact: true,
        }),
      ).toBeChecked();
      await expect(
        row.getByText(
          copy(
            "Default inclusion; no explicit preference is stored.",
            "إدراج افتراضي؛ لا يوجد تفضيل صريح محفوظ.",
          ),
          { exact: true },
        ),
      ).toBeVisible();
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
          ),
        ).toBe(true);
        await expect(title).toHaveAttribute("dir", "auto");
        expect(await title.evaluate((node) => getComputedStyle(node).direction)).toBe("ltr");
        expect(
          await row
            .getByLabel(copy("Comments enabled", "التعليقات مفعّلة"), { exact: true })
            .locator("..")
            .evaluate((node) => node.getBoundingClientRect().height),
        ).toBeGreaterThanOrEqual(44);
        const heading = main.getByRole("heading", { level: 1 });
        await heading.evaluate((node) =>
          node.scrollIntoView({ block: "center", behavior: "instant" }),
        );
        await expect(heading).toBeVisible();
        await expect
          .poll(() =>
            heading.evaluate((node) => {
              const r = node.getBoundingClientRect();
              return r.top >= 0 && r.bottom <= innerHeight;
            }),
          )
          .toBe(true);
        await page.screenshot({
          path: info.outputPath(`design-admin-videos-${locale}-${width}-heading.png`),
          style: "html { scroll-behavior: auto !important; }",
        });
        await row.screenshot({
          path: info.outputPath(`design-admin-videos-${locale}-${width}-record.png`),
          style: "html { scroll-behavior: auto !important; }",
        });
      }
      let writes = 0,
        reads = 0;
      page.on("request", (r) => {
        const u = new URL(r.url());
        if (u.origin !== API || !u.pathname.startsWith("/admin/control/videos")) return;
        if (r.method() === "GET") reads++;
        else writes++;
      });
      await row
        .getByLabel(copy("Include in this TV channel", "إدراج في هذه القناة التلفزيونية"), {
          exact: true,
        })
        .uncheck();
      await row
        .getByRole("button", {
          name: copy("Save reviewed video changes", "حفظ تعديلات الفيديو بعد المراجعة"),
          exact: true,
        })
        .click();
      await expect(main.getByTestId("video-ack")).toContainText(copy("Excluded", "مستبعد"));
      expect(writes).toBe(1);
      expect(reads).toBe(0);
      await expect(reason).toHaveValue("");
      await page.route(API + "/admin/control/videos?**", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"message":"Controlled read failure"}',
        }),
      );
      await main
        .getByRole("button", {
          name: copy("Read video records", "قراءة سجلات الفيديوهات"),
          exact: true,
        })
        .click();
      await expect(main.locator("article")).toHaveCount(0);
      await expect(main.getByTestId("video-ack")).toContainText(copy("Excluded", "مستبعد"));
      await page.unroute(API + "/admin/control/videos?**");
      await unlock(page, ar);
      // Bulk comments changes must refresh untouched fields while retaining a title draft.
      await title.fill(data.name + " independent draft");
      await reason.fill("Independent metadata after bulk");
      const select = copy("Select video for batch decision", "تحديد الفيديو للقرار الجماعي");
      await row.getByLabel(select, { exact: true }).check();
      await second.getByLabel(select, { exact: true }).check();
      await main
        .getByLabel(
          copy("Bulk decision reason (8–500 characters)", "سبب القرار الجماعي (٨–٥٠٠ حرف)"),
          { exact: true },
        )
        .fill("Actual selected comments decision");
      await main
        .getByRole("button", {
          name: copy("Disable selected comments", "تعطيل تعليقات المحدد"),
          exact: true,
        })
        .click();
      await expect(main.getByTestId("video-ack")).toContainText("2");
      expect(writes).toBe(2);
      await unlock(page, ar);
      await expect(title).toHaveValue(data.name + " independent draft");
      await expect(
        row.getByLabel(copy("Comments enabled", "التعليقات مفعّلة"), { exact: true }),
      ).not.toBeChecked();
      await row
        .getByRole("button", {
          name: copy("Save reviewed video changes", "حفظ تعديلات الفيديو بعد المراجعة"),
          exact: true,
        })
        .click();
      await expect(main.getByTestId("video-ack")).toContainText(data.name + " independent draft");
      const actual = evidence(data);
      expect(actual.targets.find((r) => r.id === data.targetId)).toMatchObject({
        title: data.name + " independent draft",
        commentsEnabled: false,
        status: "PUBLISHED",
      });
      expect(actual.targets.find((r) => r.id === data.secondId)?.commentsEnabled).toBe(false);
      expect(
        actual.preferences.find((r) => r.videoId === data.targetId && r.tvChannelId === data.tvId)
          ?.included,
      ).toBe(false);
      expect(
        actual.preferences.find(
          (r) => r.videoId === data.targetId && r.tvChannelId === data.unrelatedTvId,
        )?.included,
      ).toBe(false);
      expect(actual.audits.map((r) => [r.action, r.reason])).toEqual([
        ["video.admin_updated", "Retained paged video moderation"],
        ["video.bulk_updated", "Actual selected comments decision"],
        ["video.admin_updated", "Independent metadata after bulk"],
      ]);
      expect(actual.sessions).toEqual(data.sessions);
      expect(writes).toBe(3);
    },
  );
test("Native single video lost actual committed response retains draft and reviews originals without replay", async ({
  page,
}) => {
  const data = await seed(page, "lost-single");
  await visit(page, data);
  const main = page.getByRole("main"),
    row = rowFor(page, data.targetId),
    reason = row.getByLabel("Video decision reason (8–500 characters)", { exact: true });
  await row.getByLabel("Title", { exact: true }).fill(data.name + " committed");
  await reason.fill("Actual lost single video response");
  let writes = 0;
  await page.route(API + "/admin/control/videos/" + data.targetId, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    writes++;
    const actual = await route.fetch();
    expect(actual.status()).toBe(200);
    await route.abort();
  });
  await row.getByRole("button", { name: "Save reviewed video changes", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("response was not confirmed");
  await expect(reason).toHaveValue("Actual lost single video response");
  await unlock(page);
  expect(writes).toBe(1);
  const actual = evidence(data);
  expect(actual.targets.find((r) => r.id === data.targetId)?.title).toBe(data.name + " committed");
  expect(actual.audits).toHaveLength(1);
  expect(actual.sessions).toEqual(data.sessions);
});
test("Native bulk lost actual commit reviews every original target and never replays", async ({
  page,
}) => {
  const data = await seed(page, "lost-bulk");
  await visit(page, data);
  const main = page.getByRole("main");
  for (const id of [data.targetId, data.secondId])
    await rowFor(page, id).getByLabel("Select video for batch decision", { exact: true }).check();
  await main
    .getByLabel("Bulk decision reason (8–500 characters)", { exact: true })
    .fill("Actual lost bulk committed decision");
  let writes = 0;
  const recovered: string[] = [];
  await page.route(API + "/admin/control/videos/bulk", async (route) => {
    writes++;
    const actual = await route.fetch();
    expect(actual.status()).toBe(201);
    await route.abort();
  });
  page.on("request", (r) => {
    if (
      r.method() === "GET" &&
      [data.targetId, data.secondId].some((id) => r.url() === API + "/admin/control/videos/" + id)
    )
      recovered.push(r.url());
  });
  await main.getByRole("button", { name: "Unpublish selected", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("response was not confirmed");
  await expect(
    main.getByLabel("Bulk decision reason (8–500 characters)", { exact: true }),
  ).toHaveValue("Actual lost bulk committed decision");
  await unlock(page);
  expect(writes).toBe(1);
  expect(recovered.sort()).toEqual(
    [data.targetId, data.secondId].map((id) => API + "/admin/control/videos/" + id).sort(),
  );
  const actual = evidence(data);
  expect(actual.targets.every((r) => r.status === "DRAFT")).toBe(true);
  expect(actual.audits).toHaveLength(1);
  expect(actual.audits[0]?.metadata.affected).toBe(2);
  expect(actual.sessions).toEqual(data.sessions);
});
test("Native bulk rejects one actual newer target with409 and commits no partial changes", async ({
  page,
}) => {
  const data = await seed(page, "stale-bulk");
  await visit(page, data);
  const main = page.getByRole("main");
  for (const id of [data.targetId, data.secondId])
    await rowFor(page, id).getByLabel("Select video for batch decision", { exact: true }).check();
  await main
    .getByLabel("Bulk decision reason (8–500 characters)", { exact: true })
    .fill("Retained stale all-target decision");
  db("change-target", { ...data, targetId: data.secondId });
  const before = evidence(data),
    result = page.waitForResponse(
      (r) => r.url() === API + "/admin/control/videos/bulk" && r.request().method() === "POST",
    );
  await main.getByRole("button", { name: "Unpublish selected", exact: true }).click();
  expect((await result).status()).toBe(409);
  await expect(main.getByRole("alert")).toContainText("response was not confirmed");
  expect(evidence(data)).toEqual(before);
  await unlock(page);
});
test("Native video rejects an actual default preference winner without changing the root video or audit", async ({
  page,
}) => {
  const data = await seed(page, "preference-winner");
  await visit(page, data);
  const main = page.getByRole("main"),
    row = rowFor(page, data.targetId);
  await row.getByLabel("Include in this TV channel", { exact: true }).uncheck();
  await row
    .getByLabel("Video decision reason (8–500 characters)", { exact: true })
    .fill("Retained stale TV preference decision");
  db("change-preference", data);
  const before = evidence(data);
  const result = page.waitForResponse(
    (r) =>
      r.url() === API + "/admin/control/videos/" + data.targetId &&
      r.request().method() === "PATCH",
  );
  await row.getByRole("button", { name: "Save reviewed video changes", exact: true }).click();
  expect((await result).status()).toBe(409);
  await expect(main.getByRole("alert")).toContainText("response was not confirmed");
  expect(evidence(data)).toEqual(before);
  await unlock(page);
  await expect(
    row.getByLabel("Video decision reason (8–500 characters)", { exact: true }),
  ).toHaveValue("Retained stale TV preference decision");
});
test("Native video exact step-up cancellation retains changed fields and reason with no replay", async ({
  page,
}) => {
  const data = await seed(page, "stepup");
  await visit(page, data);
  const row = rowFor(page, data.targetId);
  await row.getByLabel("Title", { exact: true }).fill(data.name + " retained");
  await row
    .getByLabel("Video decision reason (8–500 characters)", { exact: true })
    .fill("Retained video step-up decision");
  let writes = 0;
  await page.route(API + "/admin/control/videos/" + data.targetId, (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    writes++;
    return route.fulfill({
      status: 403,
      contentType: "application/json",
      body: '{"error":{"code":"STEP_UP_REQUIRED"}}',
    });
  });
  await row.getByRole("button", { name: "Save reviewed video changes", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row.getByLabel("Title", { exact: true })).toHaveValue(data.name + " retained");
  await expect(
    row.getByLabel("Video decision reason (8–500 characters)", { exact: true }),
  ).toHaveValue("Retained video step-up decision");
  await expect(
    row.getByRole("button", { name: "Save reviewed video changes", exact: true }),
  ).toBeEnabled();
  expect(writes).toBe(1);
  expect(evidence(data).audits).toHaveLength(0);
});
test("Native video hides private metadata, bulk reason and facts synchronously on freeze and recovers only manually", async ({
  page,
}) => {
  const data = await seed(page, "freeze");
  await visit(page, data);
  const main = page.getByRole("main"),
    row = rowFor(page, data.targetId);
  await row.getByLabel("Title", { exact: true }).fill(data.name + " hidden draft");
  await row
    .getByLabel("Video decision reason (8–500 characters)", { exact: true })
    .fill("Retained hidden video reason");
  await row.getByLabel("Select video for batch decision", { exact: true }).check();
  await main
    .getByLabel("Bulk decision reason (8–500 characters)", { exact: true })
    .fill("Retained hidden bulk reason");
  let reads = 0,
    writes = 0;
  page.on("request", (r) => {
    if (r.url().startsWith(API + "/admin/control/videos")) {
      if (r.method() === "GET") reads++;
      else writes++;
    }
  });
  for (const kind of ["pagehide", "visibilitychange"] as const) {
    const before = reads;
    expect(
      await page.evaluate((kind) => {
        if (kind === "visibilitychange")
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: "hidden",
          });
        (kind === "pagehide" ? window : document).dispatchEvent(new Event(kind));
        return document
          .querySelector<HTMLElement>("[data-private-video-records]")
          ?.checkVisibility();
      }, kind),
    ).toBe(false);
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    expect(reads).toBe(before);
    expect(writes).toBe(0);
    await main.getByRole("button", { name: "Read video records", exact: true }).click();
    await expect(row).toBeVisible();
    await expect(row.getByLabel("Title", { exact: true })).toHaveValue(data.name + " hidden draft");
    await expect(
      row.getByLabel("Video decision reason (8–500 characters)", { exact: true }),
    ).toHaveValue("Retained hidden video reason");
    await expect(
      main.getByLabel("Bulk decision reason (8–500 characters)", { exact: true }),
    ).toHaveValue("Retained hidden bulk reason");
    await main
      .getByRole("button", { name: "I reviewed; enable another operation", exact: true })
      .click();
  }
  expect(evidence(data).audits).toHaveLength(0);
});
test("Finance sends zero private video fact requests", async ({ page }) => {
  const r = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: {
      name: "Actual finance denial",
      email: "video-finance@e2e.ayin.test",
      password: "strong-pass-123",
    },
  });
  expect(r.ok()).toBe(true);
  const account = (await r.json()).user.account;
  await enrollMfa(page.request);
  db("finance", { accountId: account.id });
  let facts = 0;
  page.on("request", (r) => {
    if (r.url().startsWith(API + "/admin/control/videos")) facts++;
  });
  await page.goto("/admin/videos");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("access changed");
  expect(facts).toBe(0);
});
test("Native video clears all prior private facts and intent after an actual moderator-to-finance role transition", async ({
  page,
}) => {
  const data = await seed(page, "role-transition");
  await visit(page, data);
  const main = page.getByRole("main"),
    row = rowFor(page, data.targetId);
  await row.getByLabel("Title", { exact: true }).fill(data.name + " private intent");
  await row
    .getByLabel("Video decision reason (8–500 characters)", { exact: true })
    .fill("Prior identity moderation reason");
  let facts = 0;
  page.on("request", (r) => {
    if (r.url().startsWith(API + "/admin/control/videos")) facts++;
  });
  db("change-role", data);
  await main.getByRole("button", { name: "Read video records", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("access changed");
  await expect(main.locator("[data-private-video-records]")).toBeHidden();
  expect(facts).toBe(0);
  expect(evidence(data).audits).toHaveLength(0);
});
