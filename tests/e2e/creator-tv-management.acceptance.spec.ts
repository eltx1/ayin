import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
test.use({ serviceWorkers: "block" });
function db(command: string, payload: object) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve("tests/e2e/creator-tv-management-fixture.mjs"),
        command,
        JSON.stringify(payload),
      ],
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
async function register(page: Page, email: string) {
  const response = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: { name: "Actual TV owner", email, password: "strong-pass-123" },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).user;
}
for (const locale of ["en", "ar"] as const)
  test(`Creator TV exposes the actual owned library and saves explicit zero ${locale}`, async ({
    page,
  }, testInfo) => {
    const user = await register(page, `tv-management-${locale}@e2e.ayin.test`),
      seed = db("seed", { accountId: user.account.id }),
      ar = locale === "ar";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${ar ? "/channel/tv" : "/studio/tv"}?lang=${locale}`);
    const main = page.getByRole("main"),
      library = main.getByRole("region", {
        name: ar ? "مكتبة التلفزيون" : "TV library",
        exact: true,
      });
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(
      ar ? "تلفزيون المنشئ" : "Creator TV",
    );
    await expect(library.locator(":scope > ul > li")).toHaveCount(20);
    await library.getByRole("button", { name: ar ? "التالي" : "Next", exact: true }).click();
    await expect(library.locator(":scope > ul > li")).toHaveCount(6);
    await library.getByRole("button", { name: ar ? "السابق" : "Previous", exact: true }).click();
    const row = library.locator(":scope > ul > li").filter({ hasText: "Actual TV video 00" });
    await row.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(row.getByLabel(ar ? "الأولوية" : "Priority", { exact: true })).toHaveValue("0");
    await expect(row.getByLabel(ar ? "الترتيب" : "Order", { exact: true })).toHaveValue("0");
    await expect(
      row.getByLabel(ar ? "التضمين في دورة العرض" : "Include in rotation"),
    ).not.toBeChecked();
    await row.getByLabel(ar ? "الأولوية" : "Priority", { exact: true }).fill("10");
    await row.getByLabel(ar ? "التضمين في دورة العرض" : "Include in rotation").check();
    let writes = 0,
      reads = 0;
    page.on("request", (request) => {
      if (request.method() === "PUT" && request.url().includes("/creator/tv/")) writes++;
      if (
        request.method() === "GET" &&
        request.url().endsWith(`/creator/channels/${seed.channelId}/tv`)
      )
        reads++;
    });
    await row
      .getByRole("button", { name: ar ? "حفظ التفضيل" : "Save preference", exact: true })
      .click();
    await expect(
      main.getByRole("status").filter({ hasText: ar ? "تم حفظ التفضيل" : "Preference saved." }),
    ).toBeVisible();
    expect(db("evidence", { accountId: user.account.id, videoId: seed.videoId })).toEqual({
      preference: { included: true, priority: 10, sortOrder: 0 },
    });
    expect(writes).toBe(1);
    expect(reads).toBe(0);
    await expect(
      row.getByRole("button", { name: ar ? "حفظ التفضيل" : "Save preference", exact: true }),
    ).toBeDisabled();
    await page.route(`${API}/creator/channels/${seed.channelId}/tv`, (route) =>
      route.fulfill({ status: 503, json: { message: "Read unavailable" } }),
    );
    await main
      .getByRole("button", {
        name: ar ? "مراجعة دورة العرض الحالية" : "Review current rotation",
        exact: true,
      })
      .click();
    await expect(main.getByRole("alert")).toContainText(
      ar ? "تعذر التحقق" : "could not be verified",
    );
    await expect(
      main.getByRole("status").filter({ hasText: ar ? "تم حفظ التفضيل" : "Preference saved." }),
    ).toBeVisible();
    await expect(
      main.getByRole("button", {
        name: ar ? "تأكيد المراجعة وتفعيل التعديلات" : "Confirm review and enable changes",
        exact: true,
      }),
    ).toBeDisabled();
    expect(writes).toBe(1);
    await page.unroute(`${API}/creator/channels/${seed.channelId}/tv`);
    await main
      .getByRole("button", {
        name: ar ? "مراجعة دورة العرض الحالية" : "Review current rotation",
        exact: true,
      })
      .click();
    await main
      .getByRole("button", {
        name: ar ? "تأكيد المراجعة وتفعيل التعديلات" : "Confirm review and enable changes",
        exact: true,
      })
      .click();
    expect(writes).toBe(1);
    expect(reads).toBe(2);
    const snapshot = await page.request.get(`${API}/creator/channels/${seed.channelId}/tv`);
    expect(snapshot.headers()["cache-control"]).toContain("no-store");
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await testInfo.attach(`design-creator-tv-${width}-${locale}.png`, {
        body: await page.screenshot({
          path: testInfo.outputPath(`design-creator-tv-management-${width}-${locale}.png`),
          fullPage: true,
        }),
        contentType: "image/png",
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true);
    }
  });
test("lost actual preference acknowledgment preserves the draft and never replays", async ({
  page,
}) => {
  const user = await register(page, "tv-management-loss@e2e.ayin.test"),
    seed = db("seed", { accountId: user.account.id });
  await page.goto("/studio/tv?lang=en");
  const main = page.getByRole("main"),
    row = main
      .getByRole("region", { name: "TV library", exact: true })
      .locator(":scope > ul > li")
      .filter({ hasText: "Actual TV video 00" });
  await row.locator("summary").click();
  await row.getByLabel("Priority", { exact: true }).fill("99");
  let writes = 0,
    reads = 0;
  await page.route(
    `${API}/creator/tv/${seed.tvChannelId}/videos/${seed.videoId}`,
    async (route) => {
      writes++;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    },
  );
  page.on("request", (request) => {
    if (request.url().endsWith(`/creator/channels/${seed.channelId}/tv`)) reads++;
  });
  await row.getByRole("button", { name: "Save preference", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("save outcome could not be verified");
  expect(
    db("evidence", { accountId: user.account.id, videoId: seed.videoId }).preference.priority,
  ).toBe(99);
  expect(writes).toBe(1);
  expect(reads).toBe(0);
  await expect(row.getByLabel("Priority", { exact: true })).toHaveValue("99");
  await main.getByRole("button", { name: "Review current rotation", exact: true }).click();
  await main
    .getByRole("button", { name: "Confirm review and enable changes", exact: true })
    .click();
  expect(writes).toBe(1);
  expect(reads).toBe(1);
});
test("changed account cannot send a preference mutation and foreign owner remains denied", async ({
  page,
}) => {
  const user = await register(page, "tv-management-first@e2e.ayin.test"),
    seed = db("seed", { accountId: user.account.id });
  await page.goto("/studio/tv?lang=en");
  const main = page.getByRole("main"),
    row = main
      .getByRole("region", { name: "TV library", exact: true })
      .locator(":scope > ul > li")
      .filter({ hasText: "Actual TV video 00" });
  await row.locator("summary").click();
  await row.getByLabel("Priority", { exact: true }).fill("88");
  await register(page, "tv-management-second@e2e.ayin.test");
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT") writes++;
  });
  await row.getByRole("button", { name: "Save preference", exact: true }).click();
  await expect(main.getByRole("alert")).toContainText("account or channel changed");
  expect(writes).toBe(0);
  await expect(main.getByRole("region", { name: "TV library", exact: true })).toHaveCount(0);
  await expect(main.getByText("88", { exact: true })).toHaveCount(0);
  const foreign = await page.request.put(
    `${API}/creator/tv/${seed.tvChannelId}/videos/${seed.videoId}`,
    { headers: { origin: WEB }, data: { included: true, priority: 88, sortOrder: null } },
  );
  expect(foreign.status()).toBe(403);
  expect(
    db("evidence", { accountId: user.account.id, videoId: seed.videoId }).preference.priority,
  ).toBe(0);
});
test("stalled and malformed management reads have explicit recovery", async ({ page }) => {
  const user = await register(page, "tv-management-deadline@e2e.ayin.test"),
    seed = db("seed", { accountId: user.account.id });
  await page.route(`${API}/creator/channels/${seed.channelId}/tv`, () => new Promise(() => {}));
  await page.goto("/studio/tv?lang=en");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("could not be verified", {
    timeout: 20000,
  });
  await page.unroute(`${API}/creator/channels/${seed.channelId}/tv`);
  await page.route(`${API}/creator/channels/${seed.channelId}/tv`, async (route) => {
    const response = await route.fetch(),
      body = await response.json();
    body.videos[0].sortOrder = -1;
    await route.fulfill({ response, json: body });
  });
  await page.getByRole("button", { name: "Review current rotation", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("could not be verified");
  await expect(page.getByRole("region", { name: "TV library", exact: true })).toHaveCount(0);
  await page.unroute(`${API}/creator/channels/${seed.channelId}/tv`);
  await page.getByRole("button", { name: "Review current rotation", exact: true }).click();
  await expect(page.getByRole("region", { name: "TV library", exact: true })).toBeVisible();
});
