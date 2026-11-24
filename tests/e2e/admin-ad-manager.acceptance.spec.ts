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
  await expect(page.locator('[id^="ad-slot-"]')).toHaveCount(10);

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
