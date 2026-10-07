import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";
import {
  adminAdvertisingAr,
  adminAdvertisingEn,
} from "../../apps/web/src/lib/i18n/resources/admin-advertising";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
function db<T>(command: string, payload: object): T {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/admin-video-ad-fixture.mjs"), command, JSON.stringify(payload)],
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
async function seed(page: Page, suffix: string, role: "seed" | "finance" = "seed") {
  const response = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: {
      name: "Advertising navigation operator",
      email: `ad-navigation-${suffix}@e2e.ayin.test`,
      password: "strong-pass-123",
    },
  });
  expect(response.ok()).toBe(true);
  const accountId = (await response.json()).user.account.id;
  await enrollMfa(page.request);
  return { accountId, ...db<{ query: string }>(role, { accountId }) };
}
async function screenshots(
  page: Page,
  info: TestInfo,
  locale: string,
  state: string,
  widths = [390, 1440],
) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const heading = page.getByRole("main").getByRole("heading", { level: 1 });
    await heading.evaluate((n) =>
      n.closest("header")?.scrollIntoView({ block: "start", behavior: "instant" }),
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
    const controls = page.getByRole("main").locator('nav[aria-label], [role="tablist"]');
    for (const control of await controls.all()) {
      if (!(await control.isVisible())) continue;
      expect(
        await control.evaluate((n) => {
          const r = n.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth + 1;
        }),
      ).toBe(true);
    }
    for (const tab of await page.getByRole("tab").all()) {
      expect(
        await tab.evaluate((n) => {
          const r = n.getBoundingClientRect();
          return (
            r.height >= 44 &&
            r.left >= 0 &&
            r.right <= innerWidth + 1 &&
            n.scrollWidth <= n.clientWidth + 1
          );
        }),
      ).toBe(true);
    }
    for (const tab of await page.getByRole("tab").all()) {
      expect(
        await tab.evaluate((node) => {
          const text = node.firstChild;
          if (!text || text.nodeType !== Node.TEXT_NODE) return false;
          for (const word of text.textContent!.matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(text, word.index!);
            range.setEnd(text, word.index! + word[0].length);
            if (range.getClientRects().length > 1) return false;
          }
          return true;
        }),
      ).toBe(true);
    }
    await page.screenshot({
      path: info.outputPath(`design-advertising-${locale}-${width}-${state}.png`),
      style: "html { scroll-behavior: auto !important; }",
    });
  }
}
for (const locale of ["en", "ar"] as const) {
  test(`Advertising center ${locale} keeps native tabs, draft intent, scoped navigation and compatible player routes`, async ({
    page,
  }, info) => {
    const copy = locale === "ar" ? adminAdvertisingAr : adminAdvertisingEn;
    const data = await seed(page, locale);
    let writes = 0;
    page.on("request", (r) => {
      if (
        r.url().startsWith(API + "/admin/") &&
        ["POST", "PATCH", "PUT", "DELETE"].includes(r.method())
      )
        writes++;
    });
    const read = page.waitForResponse(
      (r) => r.url() === API + "/admin/advertising/overview" && r.status() === 200,
    );
    await page.goto("/admin/advertising?lang=" + locale);
    await read;
    await expect(page.getByRole("button", { name: copy.refresh, exact: true })).toBeEnabled();
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(copy.title);
    await expect(page.getByRole("tabpanel", { includeHidden: true })).toHaveCount(6);
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Direct campaigns", exact: true })).toHaveCount(
      0,
    );
    const summary = page.getByRole("tab", { name: copy.overview, exact: true });
    const inventory = page.getByRole("tab", { name: copy.inventory, exact: true });
    await screenshots(page, info, locale, "overview");
    await summary.focus();
    await page.keyboard.press(locale === "ar" ? "ArrowLeft" : "ArrowRight");
    await expect(inventory).toBeFocused();
    await expect(summary).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(inventory).toHaveAttribute("aria-selected", "true");
    await page
      .getByLabel(copy.image, { exact: true })
      .fill("https://example.test/retained-house.png");
    await page.getByRole("tab", { name: copy.advertisers, exact: true }).click();
    await page
      .getByRole("button", { name: locale === "ar" ? "معلن جديد" : "New advertiser", exact: true })
      .click();
    await page
      .getByLabel(locale === "ar" ? "اسم المعلن" : "Advertiser name", { exact: true })
      .fill("Retained advertiser draft");
    await page.getByRole("tab", { name: copy.sellers, exact: true }).click();
    const seller = page.getByRole("tabpanel").locator("textarea").first();
    await seller.fill("# Retained manual seller draft");
    await inventory.click();
    await expect(page.getByLabel(copy.image, { exact: true })).toHaveValue(
      "https://example.test/retained-house.png",
    );
    await screenshots(page, info, locale, "inventory");
    await page.getByRole("tab", { name: copy.advertisers, exact: true }).click();
    await expect(
      page.getByLabel(locale === "ar" ? "اسم المعلن" : "Advertiser name", { exact: true }),
    ).toHaveValue("Retained advertiser draft");
    await page.getByRole("tab", { name: copy.sellers, exact: true }).click();
    await expect(seller).toHaveValue("# Retained manual seller draft");
    await seller.focus();
    await page.keyboard.press("Home"); // Native text entry must not switch panels.
    await expect(page.getByRole("tab", { name: copy.sellers, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: copy.sellers, exact: true }).focus();
    await page.keyboard.press("Home");
    await expect(summary).toBeFocused();
    await page.keyboard.press("Space");
    await expect(summary).toHaveAttribute("aria-selected", "true");
    const nav = page.getByRole("navigation", { name: copy.navigation, exact: true });
    await expect(nav.getByRole("link", { name: copy.pageArea, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await nav.getByRole("link", { name: copy.videoArea, exact: true }).click();
    // The native advertiser draft now has an explicit departure boundary.
    // Cancel once to prove intent remains, then deliberately leave without saving.
    await page
      .getByRole("dialog")
      .getByRole("button", {
        name: locale === "ar" ? "متابعة التحرير" : "Keep editing",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/admin\/advertising$/);
    await page.getByRole("tab", { name: copy.advertisers, exact: true }).click();
    await expect(
      page.getByLabel(locale === "ar" ? "اسم المعلن" : "Advertiser name", { exact: true }),
    ).toHaveValue("Retained advertiser draft");
    await summary.click();
    await nav.getByRole("link", { name: copy.videoArea, exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: locale === "ar" ? "مغادرة الصفحة" : "Leave page", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp((locale === "ar" ? "/ar" : "") + "/admin/video-ads$"));
    await expect(page.locator("[data-ad-override]").first()).toBeVisible();
    await expect(nav.getByRole("link", { name: copy.videoArea, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await screenshots(page, info, locale, "player");
    const sidebar = page.locator("aside").getByRole("navigation");
    await expect(
      sidebar.getByRole("link", {
        name: locale === "ar" ? "الإعلانات" : "Advertising",
        exact: true,
      }),
    ).toHaveAttribute("aria-current", "page");
    await expect(sidebar.locator('a[href$="/admin/video-ads"]')).toHaveCount(0);
    await page.goBack();
    await expect(page.getByRole("heading", { name: copy.title, exact: true })).toBeVisible();
    await page.goForward();
    await expect(page.locator("[data-ad-override]").first()).toBeVisible();
    // Existing deep links/query stay supported and the protected editor's departure guard is used.
    await page.goto("/admin/video-ads?query=" + data.query + "&lang=" + locale);
    await expect(page.locator("[data-ad-override]")).toHaveCount(25);
    await page
      .getByRole("main")
      .locator("summary")
      .filter({
        hasText:
          locale === "ar"
            ? /^مراجعة إعدادات المشغّل وتعديلها$/
            : /^Review and edit player defaults$/,
      })
      .click();
    await page.locator("#video-ads-frequency").fill("5");
    page.once("dialog", (dialog) => dialog.dismiss());
    await nav.getByRole("link", { name: copy.pageArea, exact: true }).click();
    await expect(page.locator("#video-ads-frequency")).toHaveValue("5");
    await expect(page).toHaveURL(/\/admin\/video-ads\?/);
    expect(writes).toBe(0);
    const evidence = db<{ audits: unknown[] }>("evidence", data);
    expect(evidence.audits).toHaveLength(0);
  });
}
test("Advertising initial read failure is unavailable, not ready or a fabricated zero", async ({
  page,
}) => {
  const data = await seed(page, "read-failure");
  let writes = 0;
  page.on("request", (request) => {
    if (
      request.url().startsWith(API + "/admin/") &&
      ["POST", "PATCH", "PUT", "DELETE"].includes(request.method())
    )
      writes++;
  });
  await page.route(API + "/admin/advertising/overview", (route) => route.abort("failed"));
  await page.goto("/admin/advertising");
  await expect(page.getByText(adminAdvertisingEn.readError, { exact: true })).toBeVisible();
  const summary = page.locator('dl[aria-label="Advertising summary"]');
  await expect(summary.locator("dd")).toHaveText(Array(5).fill("Unavailable"));
  await page
    .getByRole("main")
    .locator("summary")
    .filter({ hasText: /^Emergency control$/ })
    .click();
  const reason = page.getByLabel("Operator reason", { exact: true });
  const stop = page.getByRole("button", { name: "Stop all advertising", exact: true });
  await expect(reason).toBeDisabled();
  await expect(reason).toHaveValue("");
  await expect(stop).toBeDisabled();
  await page.unroute(API + "/admin/advertising/overview");
  const freshOverview = page.waitForResponse(
    (response) =>
      response.url() === API + "/admin/advertising/overview" && response.status() === 200,
  );
  await page.getByRole("button", { name: "Read advertising records", exact: true }).click();
  await freshOverview;
  await expect(summary.getByText("Emergency stop off", { exact: true })).toBeVisible();
  await expect(page.getByText(adminAdvertisingEn.readError, { exact: true })).toHaveCount(0);
  await expect(reason).toBeEnabled();
  await expect(reason).toHaveValue("");
  await expect(stop).toBeDisabled();
  await reason.fill("Reviewed reason after a fresh read");
  await expect(reason).toHaveValue("Reviewed reason after a fresh read");
  await expect(stop).toBeEnabled();
  expect(writes).toBe(0);
  const evidence = db<{ audits: unknown[]; emergencyAudits: unknown[] }>("evidence", data);
  expect(evidence.audits).toHaveLength(0);
  expect(evidence.emergencyAudits).toHaveLength(0);
});
test("Finance retains no Advertising navigation and the player API rejects direct access", async ({
  page,
}) => {
  await seed(page, "finance", "finance");
  await page.goto("/admin/video-ads");
  await expect(page.getByTestId("video-ads-private-body")).not.toContainText(
    "Provider: Google IMA",
  );
  await expect(page.locator('aside a[href$="/admin/advertising"]')).toHaveCount(0);
  for (const endpoint of ["/admin/video-ads/settings/record", "/admin/advertising/overview"]) {
    expect((await page.request.get(API + endpoint)).status()).toBe(403);
  }
});

async function editableReadFixtures(page: Page) {
  let revision = 0;
  await page.route(API + "/admin/page-ads/settings", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        house: {
          imageUrl: `https://example.test/server-${revision}.png`,
          clickUrl: null,
          altText: `Server ${revision}`,
        },
      },
    });
  });
  await page.route(API + "/admin/advertising/authorized-sellers", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        ads: { ...body.ads, manualText: `# web-${revision}` },
        appAds: { ...body.appAds, manualText: `# app-${revision}` },
      },
    });
  });
  return (next: number) => {
    revision = next;
  };
}

test("Manual reads refresh clean forms independently while retaining dirty page and both seller drafts", async ({
  page,
}) => {
  await seed(page, "manual-drafts");
  const revision = await editableReadFixtures(page);
  await page.goto("/admin/advertising");
  const read = page.getByRole("button", { name: "Read advertising records", exact: true });
  await expect(read).toBeEnabled();
  let writes = 0;
  page.on("request", (r) => {
    if (
      r.url().startsWith(API + "/admin/") &&
      ["POST", "PATCH", "PUT", "DELETE"].includes(r.method())
    )
      writes++;
  });
  // A clean form must not remain frozen at the first snapshot.
  revision(1);
  await read.click();
  await expect(read).toBeEnabled();
  await page.getByRole("tab", { name: "Page inventory", exact: true }).click();
  await expect(page.getByLabel("House image URL", { exact: true })).toHaveValue(
    "https://example.test/server-1.png",
  );
  await page.getByRole("tab", { name: "Seller files", exact: true }).click();
  const sellers = page.getByRole("tabpanel").locator("textarea");
  await expect(sellers.nth(0)).toHaveValue("# web-1");
  await expect(sellers.nth(1)).toHaveValue("# app-1");
  await sellers.nth(0).fill("# retained web intent");
  revision(2);
  await read.click();
  await expect(read).toBeEnabled();
  await expect(sellers.nth(0)).toHaveValue("# retained web intent");
  await expect(sellers.nth(1)).toHaveValue("# app-2");
  await page.getByRole("tab", { name: "Page inventory", exact: true }).click();
  await expect(page.getByLabel("House image URL", { exact: true })).toHaveValue(
    "https://example.test/server-2.png",
  );
  await page
    .getByLabel("House image URL", { exact: true })
    .fill("https://example.test/retained-page.png");
  await page.getByRole("tab", { name: "Seller files", exact: true }).click();
  await sellers.nth(1).fill("# retained app intent");
  revision(3);
  await read.click();
  await expect(read).toBeEnabled();
  await expect(sellers.nth(0)).toHaveValue("# retained web intent");
  await expect(sellers.nth(1)).toHaveValue("# retained app intent");
  await page.getByRole("tab", { name: "Page inventory", exact: true }).click();
  await expect(page.getByLabel("House image URL", { exact: true })).toHaveValue(
    "https://example.test/retained-page.png",
  );
  expect(writes).toBe(0);
});

test("Manual read retains page and seller edits made after the request starts", async ({
  page,
}) => {
  await seed(page, "in-flight-drafts");
  const revision = await editableReadFixtures(page);
  await page.goto("/admin/advertising");
  const read = page.getByRole("button", { name: "Read advertising records", exact: true });
  await expect(read).toBeEnabled();
  let release!: () => void, started!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(API + "/admin/advertising/overview", async (route) => {
    const response = await route.fetch();
    started();
    await hold;
    await route.fulfill({ response });
  });
  let writes = 0;
  page.on("request", (r) => {
    if (
      r.url().startsWith(API + "/admin/") &&
      ["POST", "PATCH", "PUT", "DELETE"].includes(r.method())
    )
      writes++;
  });
  revision(1);
  await read.click();
  await requested;
  await expect(read).toBeDisabled();
  try {
    await page.getByRole("tab", { name: "Page inventory", exact: true }).click();
    await page
      .getByLabel("House image URL", { exact: true })
      .fill("https://example.test/typed-while-reading.png");
    await page.getByRole("tab", { name: "Seller files", exact: true }).click();
    const sellers = page.getByRole("tabpanel").locator("textarea");
    await sellers.nth(0).fill("# typed web while reading");
    await sellers.nth(1).fill("# typed app while reading");
  } finally {
    release();
  }
  await expect(read).toBeEnabled();
  const sellers = page.getByRole("tabpanel").locator("textarea");
  await expect(sellers.nth(0)).toHaveValue("# typed web while reading");
  await expect(sellers.nth(1)).toHaveValue("# typed app while reading");
  await page.getByRole("tab", { name: "Page inventory", exact: true }).click();
  await expect(page.getByLabel("House image URL", { exact: true })).toHaveValue(
    "https://example.test/typed-while-reading.png",
  );
  expect(writes).toBe(0);
});

for (const locale of ["en", "ar"] as const) {
  test(`Advertising ${locale} hides populated stale counters after read failure with bounded unavailable typography`, async ({
    page,
  }, info) => {
    await seed(page, "recovery-" + locale);
    const copy = locale === "ar" ? adminAdvertisingAr : adminAdvertisingEn;
    let failing = false;
    await page.route(API + "/admin/advertising/overview", async (route) => {
      if (failing) {
        await route.abort("failed");
        return;
      }
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, eventCounters: { IMPRESSION: 1234 } } });
    });
    await page.goto("/admin/advertising?lang=" + locale);
    const read = page.getByRole("button", { name: copy.refresh, exact: true });
    await expect(read).toBeEnabled();
    const disclosure = page.locator("details").filter({
      has: page.locator("summary").filter({ hasText: new RegExp("^" + copy.counters + "$") }),
    });
    await disclosure.locator("summary").click();
    await expect(disclosure).toContainText("1,234");
    const summary = page.locator(`dl[aria-label="${copy.summary}"]`);
    expect(
      await summary
        .locator("dd")
        .nth(2)
        .evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
    ).toBeGreaterThanOrEqual(24);
    failing = true;
    await read.click();
    await expect(page.getByText(copy.readError, { exact: true })).toBeVisible();
    await expect(disclosure).toContainText(copy.unavailable);
    await expect(disclosure).not.toContainText("1,234");
    await expect(summary.locator("dd")).toHaveText(Array(5).fill(copy.unavailable));
    await screenshots(page, info, locale, "read-failure", [390, 1280, 1440]);
    for (const width of [390, 1280, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const badge of await summary.locator("dd > span").all()) {
        expect(
          await badge.evaluate((node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return (
              range.getClientRects().length === 1 &&
              parseFloat(getComputedStyle(node).fontSize) < 24
            );
          }),
        ).toBe(true);
      }
    }
  });
}
