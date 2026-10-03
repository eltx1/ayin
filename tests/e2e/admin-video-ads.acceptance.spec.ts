import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
type Seed = {
  accountId: string;
  channelId: string;
  query: string;
  name: string;
  targetId: string;
  overrideId: string;
  defaultName: string;
  defaultId: string;
  settingsId: string;
  sessions: unknown[];
};
type Evidence = {
  settings: {
    value: { masterEnabled: boolean; frequencyCapPerSession: number };
    updatedAt: string;
  };
  overrides: Array<{
    id: string;
    videoId: string;
    enabled: boolean | null;
    midRollEverySec: number | null;
    updatedAt: string;
    vastTagUrl: string | null;
  }>;
  audits: Array<{ action: string; entityId: string; metadata: Record<string, unknown> }>;
  sessions: unknown[];
};
function db<T = unknown>(command: string, payload: object): T {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/admin-video-ad-fixture.mjs"), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  ) as T;
}
const evidence = (data: Seed) => db<Evidence>("evidence", data);
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  const u = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(u.hostname) || u.pathname !== "/ayin_e2e")
    throw Error("Requires isolated local ayin_e2e");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
async function seed(page: Page, suffix: string): Promise<Seed> {
  const r = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: {
      name: "Actual advertising operator",
      email: "native-video-ads-" + suffix + "@e2e.ayin.test",
      password: "strong-pass-123",
    },
  });
  expect(r.ok()).toBe(true);
  const account = (await r.json()).user.account;
  await enrollMfa(page.request);
  return {
    accountId: account.id,
    ...db<Omit<Seed, "accountId">>("seed", { accountId: account.id }),
  };
}
const row = (page: Page, data: Seed) =>
  page.getByRole("main").locator(`[data-ad-override="${data.overrideId}"]`);
const editor = (page: Page) => page.locator("#video-ads-target-editor");
async function visit(page: Page, data: Seed, locale = "en") {
  await page.goto("/admin/video-ads?query=" + data.query + "&lang=" + locale);
  await expect(row(page, data)).toBeVisible();
}
async function openTarget(page: Page, data: Seed, ar = false) {
  await row(page, data)
    .getByRole("button", { name: ar ? "قراءة هذا الاستثناء" : "Read this override", exact: true })
    .click();
  await expect(editor(page)).toContainText(data.name);
}
async function defaults(page: Page, ar = false) {
  const summary = page
    .getByRole("main")
    .locator("summary")
    .filter({
      hasText: ar ? /^مراجعة إعدادات المشغّل وتعديلها$/ : /^Review and edit player defaults$/,
    });
  await summary.click();
  await expect(page.locator("#video-ads-frequency")).toBeVisible();
}
async function unlock(page: Page, ar = false) {
  await page
    .getByRole("button", {
      name: ar ? "قراءة الإعدادات الأصلية" : "Read original configuration",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("video-ads-reviewed")).toBeVisible();
  await page
    .getByRole("button", {
      name: ar ? "مراجعة التعديلات المحفوظة" : "Review retained edits",
      exact: true,
    })
    .click();
}
async function findDefault(page: Page, data: Seed) {
  await page
    .getByRole("main")
    .locator("summary")
    .filter({ hasText: /^Find a channel or video target$/ })
    .click();
  await page.locator("#video-ads-target-query").fill(data.defaultName);
  await page.getByRole("button", { name: "Find targets", exact: true }).click();
  await page.getByRole("button", { name: "Video · " + data.defaultName, exact: true }).click();
  await expect(editor(page)).toContainText("No stored override; inherited policy");
}
for (const locale of ["en", "ar"]) {
  test(`Native advertising ${locale} retains independent player and target drafts, real pages, smaller ACKs and manual recovery`, async ({
    page,
  }, info) => {
    const ar = locale === "ar",
      copy = (en: string, arabic: string) => (ar ? arabic : en),
      data = await seed(page, locale);
    await visit(page, data, locale);
    expect(await page.locator("[data-ad-override]").count()).toBe(25);
    await expect(editor(page)).toHaveCount(0);
    await defaults(page, ar);
    await page.locator("#video-ads-frequency").fill("5");
    await page
      .getByRole("button", { name: copy("Next page", "الصفحة التالية"), exact: true })
      .click();
    await expect(page.locator("[data-ad-override]")).toHaveCount(1);
    await expect(page.locator("#video-ads-frequency")).toHaveValue("5");
    await page
      .getByRole("button", { name: copy("Previous page", "الصفحة السابقة"), exact: true })
      .click();
    await expect(row(page, data)).toBeVisible();
    await openTarget(page, data, ar);
    await page.locator("#video-ads-override-interval").fill("900");
    await page.locator("#video-ads-override-url").fill("https://example.test/retained-tag");
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
      ).toBe(true);
      const input = page.locator("#video-ads-override-url");
      await expect(input).toHaveAttribute("dir", "auto");
      expect(await input.evaluate((n) => getComputedStyle(n).direction)).toBe("ltr");
      const heading = page.getByRole("main").getByRole("heading", { level: 1 });
      await heading.evaluate((n) => n.scrollIntoView({ block: "center", behavior: "instant" }));
      await expect
        .poll(() =>
          heading.evaluate((n) => {
            const r = n.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= innerHeight;
          }),
        )
        .toBe(true);
      await page.screenshot({
        path: info.outputPath(`design-admin-video-ads-${locale}-${width}-heading.png`),
        style: "html { scroll-behavior: auto !important; }",
      });
      await editor(page).screenshot({
        path: info.outputPath(`design-admin-video-ads-${locale}-${width}-record.png`),
        style: "html { scroll-behavior: auto !important; }",
      });
    }
    let writes = 0,
      reads = 0;
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.origin !== API || !u.pathname.startsWith("/admin/video-ads")) return;
      if (r.method() === "GET") reads++;
      else writes++;
    });
    await page
      .getByRole("button", {
        name: copy("Save reviewed override", "حفظ الاستثناء بعد المراجعة"),
        exact: true,
      })
      .click();
    await expect(page.getByTestId("video-ads-ack")).toContainText(
      copy("Override saved", "حُفظ الاستثناء"),
    );
    expect(writes).toBe(1);
    expect(reads).toBe(0);
    await expect(page.locator("#video-ads-frequency")).toHaveValue("5");
    const first = evidence(data);
    expect(first.audits).toHaveLength(1);
    expect(first.overrides.find((x) => x.videoId === data.targetId)).toMatchObject({
      enabled: false,
      midRollEverySec: 900,
      vastTagUrl: "https://example.test/retained-tag",
    });
    expect(first.sessions).toEqual(data.sessions);
    await page.route(API + "/admin/video-ads/settings/record", (r) =>
      r.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"message":"Controlled read failure"}',
      }),
    );
    await page
      .getByRole("button", {
        name: copy("Read advertising records", "قراءة سجلات الإعلانات"),
        exact: true,
      })
      .click();
    await expect(page.getByRole("main")).toContainText(
      copy("Records could not be verified", "تعذّر التحقق من السجلات"),
    );
    await expect(page.getByTestId("video-ads-ack")).toContainText(
      copy("Override saved", "حُفظ الاستثناء"),
    );
    expect(writes).toBe(1);
    await page.unroute(API + "/admin/video-ads/settings/record");
    await unlock(page, ar);
    await expect(page.locator("#video-ads-frequency")).toHaveValue("5");
    await page
      .getByRole("button", {
        name: copy("Save reviewed player defaults", "حفظ إعدادات المشغّل بعد المراجعة"),
        exact: true,
      })
      .click();
    await expect(page.getByTestId("video-ads-ack")).toContainText(
      copy("Player defaults saved", "حُفظت إعدادات المشغّل"),
    );
    expect(writes).toBe(2);
    const saved = evidence(data);
    expect(saved.settings.value).toMatchObject({ masterEnabled: false, frequencyCapPerSession: 5 });
    expect(saved.audits).toHaveLength(2);
    expect(saved.sessions).toEqual(data.sessions);
  });
}
test("Native advertising lost settings ACK never replays and reviews the actual original with retained edits", async ({
  page,
}) => {
  const data = await seed(page, "lost-settings");
  await visit(page, data);
  await defaults(page);
  await page.locator("#video-ads-frequency").fill("5");
  let writes = 0;
  await page.route(API + "/admin/video-ads/settings", async (r) => {
    if (r.request().method() !== "PATCH") return r.continue();
    writes++;
    const committed = await r.fetch();
    expect(committed.status()).toBe(200);
    await r.abort("failed");
  });
  await page.getByRole("button", { name: "Save reviewed player defaults", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("The result is uncertain");
  expect(writes).toBe(1);
  expect(evidence(data).settings.value.frequencyCapPerSession).toBe(5);
  expect(evidence(data).audits).toHaveLength(1);
  await expect(page.locator("#video-ads-frequency")).toHaveValue("5");
  await page.waitForTimeout(100);
  expect(writes).toBe(1);
  await unlock(page);
  expect(writes).toBe(1);
  expect(evidence(data).audits).toHaveLength(1);
});
test("Native advertising lost override ACK never replays and recovers the captured actual target", async ({
  page,
}) => {
  const data = await seed(page, "lost-override");
  await visit(page, data);
  await openTarget(page, data);
  await page.locator("#video-ads-override-interval").fill("900");
  let writes = 0;
  await page.route(API + "/admin/video-ads/videos/" + data.targetId, async (r) => {
    writes++;
    const committed = await r.fetch();
    expect(committed.status()).toBe(200);
    await r.abort("failed");
  });
  await page.getByRole("button", { name: "Save reviewed override", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("The result is uncertain");
  expect(writes).toBe(1);
  expect(evidence(data).audits).toHaveLength(1);
  const targets: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "GET" && r.url().includes("/admin/video-ads/videos/"))
      targets.push(new URL(r.url()).pathname);
  });
  await unlock(page);
  expect(targets).toEqual(["/admin/video-ads/videos/" + data.targetId + "/record"]);
  await expect(page.locator("#video-ads-override-interval")).toHaveValue("900");
  expect(writes).toBe(1);
});
test("Native advertising rejects actual default-override winner with no partial effects and retains intent", async ({
  page,
}) => {
  const data = await seed(page, "default-winner");
  await visit(page, data);
  await findDefault(page, data);
  await page.locator("#video-ads-override-enabled").selectOption("DISABLED");
  await page.locator("#video-ads-override-interval").fill("900");
  db("change-override", { ...data, targetId: data.defaultId });
  const winner = evidence(data);
  await page.getByRole("button", { name: "Save reviewed override", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("The result is uncertain");
  expect(evidence(data)).toEqual(winner);
  await unlock(page);
  await expect(page.locator("#video-ads-override-interval")).toHaveValue("900");
  expect(evidence(data)).toEqual(winner);
});
test("Native advertising rejects actual settings winner and rebase retains only edited settings", async ({
  page,
}) => {
  const data = await seed(page, "settings-winner");
  await visit(page, data);
  await defaults(page);
  await page.locator("#video-ads-interval").fill("900");
  db("change-settings", data);
  const winner = evidence(data);
  await page.getByRole("button", { name: "Save reviewed player defaults", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("The result is uncertain");
  expect(evidence(data)).toEqual(winner);
  await unlock(page);
  await expect(page.locator("#video-ads-interval")).toHaveValue("900");
  await expect(page.locator("#video-ads-frequency")).toHaveValue("7");
  await page.getByRole("button", { name: "Save reviewed player defaults", exact: true }).click();
  await expect(page.getByTestId("video-ads-ack")).toContainText("Player defaults saved");
  expect(evidence(data).settings.value.frequencyCapPerSession).toBe(7);
  expect(evidence(data).audits).toHaveLength(1);
});
test("Native advertising exact step-up cancellation preserves edits without replay or actual config changes", async ({
  page,
}) => {
  const data = await seed(page, "canceled"),
    before = evidence(data);
  await visit(page, data);
  await openTarget(page, data);
  await page.locator("#video-ads-override-interval").fill("900");
  let writes = 0;
  await page.route(API + "/admin/video-ads/videos/" + data.targetId, (r) => {
    writes++;
    return r.fulfill({
      status: 403,
      contentType: "application/json",
      body: '{"error":{"code":"STEP_UP_REQUIRED","message":"Controlled canceled verification"}}',
    });
  });
  await page.getByRole("button", { name: "Save reviewed override", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("Verification was canceled");
  await expect(page.locator("#video-ads-override-interval")).toHaveValue("900");
  expect(writes).toBe(1);
  expect(evidence(data)).toEqual(before);
});
test("Native advertising synchronously hides private defaults, target edits and ACK on freeze with no automatic resume requests", async ({
  page,
}) => {
  const data = await seed(page, "freeze");
  await visit(page, data);
  await defaults(page);
  await openTarget(page, data);
  await page.locator("#video-ads-frequency").fill("5");
  await page.locator("#video-ads-override-url").fill("https://example.test/private-draft");
  let requests = 0;
  page.on("request", (r) => {
    if (r.url().startsWith(API + "/admin/video-ads")) requests++;
  });
  const hidden = await page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    return !document
      .querySelector<HTMLElement>('[data-testid="video-ads-private-body"]')
      ?.checkVisibility();
  });
  expect(hidden).toBe(true);
  const before = requests;
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await page.waitForTimeout(100);
  expect(requests).toBe(before);
  await page.getByRole("button", { name: "Read advertising records", exact: true }).click();
  await defaults(page);
  await expect(page.locator("#video-ads-frequency")).toHaveValue("5");
  await unlock(page);
  await expect(page.locator("#video-ads-override-url")).toHaveValue(
    "https://example.test/private-draft",
  );
  expect(evidence(data).audits).toHaveLength(0);
});
test("Finance sends zero advertising fact requests", async ({ page }) => {
  const r = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: {
      name: "Denied Finance",
      email: "video-ads-finance@e2e.ayin.test",
      password: "strong-pass-123",
    },
  });
  expect(r.ok()).toBe(true);
  const id = (await r.json()).user.account.id;
  await enrollMfa(page.request);
  db("finance", { accountId: id });
  let facts = 0;
  page.on("request", (r) => {
    if (r.url().startsWith(API + "/admin/video-ads")) facts++;
  });
  await page.goto("/admin/video-ads");
  await expect(page.getByRole("main")).toContainText("Advertising authority changed");
  expect(facts).toBe(0);
});
test("Native advertising clears all prior private intent after actual advertising-to-Finance role transition", async ({
  page,
}) => {
  const data = await seed(page, "role-change");
  await visit(page, data);
  await defaults(page);
  await openTarget(page, data);
  await page.locator("#video-ads-frequency").fill("5");
  await page.locator("#video-ads-override-url").fill("https://example.test/old-private");
  db("change-role", data);
  let facts = 0;
  page.on("request", (r) => {
    if (r.url().startsWith(API + "/admin/video-ads")) facts++;
  });
  await page.getByRole("button", { name: "Read advertising records", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("Advertising authority changed");
  expect(facts).toBe(0);
  expect(
    await page.getByTestId("video-ads-private-body").evaluate((n) => n.checkVisibility()),
  ).toBe(false);
  await expect(page.locator("#video-ads-target-editor")).toHaveCount(0);
  expect(evidence(data).audits).toHaveLength(0);
});
