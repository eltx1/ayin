import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";

test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
    throw Error("Requires isolated local ayin_e2e");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});

// Leave no live slot or video setting behind for the specs that run after this one.
test.afterEach(() => {
  execFileSync(
    process.execPath,
    [path.resolve("tests/e2e/db-helper.mjs"), "reset-ad-manager", "{}"],
    {
      env: process.env,
    },
  );
});

async function signInAsAdManager(page: Page) {
  const response = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: {
      name: "Ad manager operator",
      email: `ad-manager-${Date.now()}@e2e.ayin.test`,
      password: "strong-pass-123",
    },
  });
  expect(response.ok()).toBe(true);
  const accountId = (await response.json()).user.account.id as string;
  execFileSync(
    process.execPath,
    [path.resolve("tests/e2e/admin-video-ad-fixture.mjs"), "seed", JSON.stringify({ accountId })],
    { env: process.env, encoding: "utf8" },
  );
  const stepUp = await page.request.post(API + "/auth/mfa/step-up", {
    headers: { origin: WEB },
    data: { password: "strong-pass-123" },
  });
  expect(stepUp.ok()).toBe(true);
}

test("the simple ad manager fills a slot with pasted code that renders on the site in both locales", async ({
  page,
}) => {
  await signInAsAdManager(page);
  await page.goto("/admin/advertising/manager");
  await expect(page.getByRole("heading", { name: "Ad manager", level: 1 })).toBeVisible();

  // Every slot that the site renders is listed with a plain explanation of where it appears.
  const slot = page.locator("#ad-slot-header_below");
  await expect(slot.getByRole("heading", { name: "Below the header" })).toBeVisible();
  await expect(page.locator('[id^="ad-slot-"]')).toHaveCount(13);

  // Server-backed switch: it flips once the saved state is read back.
  const master = page.getByRole("switch", { name: /Website ads master switch/ });
  if (!(await master.isChecked())) {
    await master.click();
    await expect(page.getByText("Saved. Changes reach viewers within a minute.")).toBeVisible();
  }
  await expect(master).toBeChecked();

  await slot.getByRole("button", { name: "Edit" }).click();
  await slot.getByText("Ad code (HTML / ad tag)").click();
  await slot
    .getByLabel("Ad code", { exact: true })
    .fill(
      '<div id="ayin-e2e-ad" style="width:320px;height:90px;background:#ffd400">AYIN E2E AD</div>',
    );
  await slot.getByRole("switch", { name: "Show ads in this slot" }).check();
  await slot.getByRole("button", { name: "Save slot" }).click();
  await expect(page.getByText("Saved. Changes reach viewers within a minute.")).toBeVisible();
  await expect(slot.getByText("Running")).toBeVisible();

  await page.reload();
  await slot.getByRole("button", { name: "Edit" }).click();
  await expect(slot.getByLabel("Ad code", { exact: true })).toHaveValue(/ayin-e2e-ad/);
  await expect(slot.getByRole("switch", { name: "Show ads in this slot" })).toBeChecked();

  for (const home of ["/", "/ar"]) {
    await page.goto(home);
    const frame = page.locator('iframe[title="Advertisement"]').first();
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute(
      "sandbox",
      "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms",
    );
    await expect(
      page.frameLocator('iframe[title="Advertisement"]').first().getByText("AYIN E2E AD"),
    ).toBeVisible();
    await expect
      .poll(async () => (await frame.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(90);
  }

  // Kids routes never show outside-player advertising.
  await page.goto("/search?kids=1");
  await expect(page.locator('iframe[title="Advertisement"]')).toHaveCount(0);
});

test("video breaks keep one VAST tag each and app ads stay superadmin-only", async ({ page }) => {
  await signInAsAdManager(page);
  await page.goto("/admin/advertising/manager");
  await page.getByRole("tab", { name: "Video (player)" }).click();
  await page.getByRole("switch", { name: /Video ads master switch/ }).check();
  await page
    .getByLabel("VAST tag URL")
    .first()
    .fill(
      "https://pubads.g.doubleclick.net/gampad/ads?iu=/23374456398/AYIN/preroll&description_url=[placeholder]&env=vp&output=vast",
    );
  await page.getByRole("button", { name: "Save video ads" }).click();
  await expect(page.getByText("Saved. Changes reach viewers within a minute.")).toBeVisible();

  const overview = await page.request.get(API + "/admin/ad-manager");
  expect(overview.ok()).toBe(true);
  const body = (await overview.json()) as {
    video: { masterEnabled: boolean; preRoll: { vastTagUrl: string | null } };
  };
  expect(body.video.masterEnabled).toBe(true);
  expect(body.video.preRoll.vastTagUrl).toContain("/23374456398/AYIN/preroll");

  await page.getByRole("tab", { name: "App", exact: true }).click();
  await expect(
    page.getByText("App ad settings are managed by a superadministrator."),
  ).toBeVisible();
});

test("the Arabic quick editor saves a nested GAM unit and an off-slot draft across reloads", async ({
  page,
}) => {
  await signInAsAdManager(page);
  await page.goto("/ar/admin/advertising/manager");
  const slot = page.locator("#ad-slot-home_top");
  const next = page.locator("#ad-slot-header_below");
  const edit = { name: "تعديل", exact: true };
  const save = { name: "احفظ المكان", exact: true };
  await slot.getByRole("button", edit).click();
  await next.getByRole("button", edit).click();
  await slot.getByRole("radio", { name: /وحدة Google Ad Manager/ }).check();
  const unit = slot.getByLabel("مسار الوحدة (Ad unit path)");
  const path = "/23374456398/AYIN/home_top";
  await unit.pressSequentially(path);
  await expect(unit).toHaveValue(path);
  await page.route(
    "**/admin/ad-manager/web/slots/home_top",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Temporarily unavailable" } }),
      }),
    { times: 1 },
  );
  await slot.getByRole("button", save).click();
  await expect(slot.getByRole("alert")).toContainText("لم يتم الحفظ");
  await expect(unit).toHaveValue(path);
  // Hold only this browser's request, then pass it through to the real API and DB.
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/admin/ad-manager/web/slots/home_top",
    async (route) => {
      await wait;
      await route.continue();
    },
    { times: 1 },
  );
  await slot.getByRole("button", save).click();
  try {
    await expect(next.getByRole("button", save)).toBeDisabled();
  } finally {
    release();
  }
  await expect(slot.getByRole("status")).toContainText("تم الحفظ");
  await page.reload();
  await slot.getByRole("button", edit).click();
  await expect(unit).toHaveValue(path);
  await expect(slot.getByRole("switch")).not.toBeChecked();
  await unit.fill("");
  await slot.getByRole("button", save).click();
  await expect(slot.getByRole("status")).toContainText("تم الحفظ");
  await page.reload();
  await slot.getByRole("button", edit).click();
  await expect(slot.getByRole("radio", { name: /وحدة Google Ad Manager/ })).toBeChecked();
  await expect(unit).toHaveValue("");
});

test("a serving slot holds its space from the server HTML, nothing moves, and the report counts it", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInAsAdManager(page);
  const headers = { origin: WEB };
  expect(
    (
      await page.request.put(API + "/admin/ad-manager/web", {
        headers,
        data: { masterEnabled: true },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.put(API + "/admin/ad-manager/web/slots/header_below", {
        headers,
        data: {
          enabled: true,
          source: "CODE",
          code: '<div style="width:320px;height:90px;background:#00c2ff">RESERVED AD</div>',
          adUnitPath: null,
          height: 90,
          devices: ["MOBILE", "DESKTOP"],
        },
      })
    ).ok(),
  ).toBe(true);

  const layout = (await (await page.request.get(API + "/ads/page/layout")).json()) as {
    slots: Array<{ key: string; mobile: number; desktop: number }>;
  };
  expect(layout.slots.find((slot) => slot.key === "header_below")).toMatchObject({
    mobile: 90,
    desktop: 90,
  });

  // The web caches the layout for up to a minute; the reserved space then ships in the HTML.
  await expect
    .poll(
      async () =>
        (await (await page.request.get(WEB + "/")).text()).includes(
          'data-ad-reserve="header_below"',
        ),
      {
        timeout: 90_000,
        intervals: [2_000],
      },
    )
    .toBe(true);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const reserve = page.locator('[data-ad-reserve="header_below"]');
  const before = await reserve.evaluate((node) => {
    const next = node.nextElementSibling as HTMLElement;
    return {
      height: node.getBoundingClientRect().height,
      nextTop: next.getBoundingClientRect().top,
    };
  });
  await expect(
    page.frameLocator('[data-ad-reserve="header_below"] iframe').getByText("RESERVED AD"),
  ).toBeVisible();
  const after = await reserve.evaluate((node) => {
    const next = node.nextElementSibling as HTMLElement;
    return {
      height: node.getBoundingClientRect().height,
      nextTop: next.getBoundingClientRect().top,
    };
  });
  expect(before.height).toBeGreaterThan(90);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(4);
  expect(Math.abs(after.nextTop - before.nextTop)).toBeLessThanOrEqual(4);

  await expect
    .poll(async () => {
      const report = (await (
        await page.request.get(API + "/admin/ad-manager/report?days=1")
      ).json()) as { web: Array<{ key: string; requests: number; impressions: number }> };
      const row = report.web.find((entry) => entry.key === "header_below");
      return row ? Math.min(row.requests, row.impressions) : 0;
    })
    .toBeGreaterThanOrEqual(1);
  await page.goto("/admin/advertising/manager");
  await page.getByRole("tab", { name: "Performance" }).click();
  const row = page.getByRole("row", { name: /Below the header/ });
  await expect(row).toBeVisible();
  await expect(row.getByRole("cell").first()).not.toHaveText("0");
});
