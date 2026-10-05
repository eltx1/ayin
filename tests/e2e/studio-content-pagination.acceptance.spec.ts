import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
const endpoint = `${API}/creator/studio/content`;
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "https://invalid.test");
  if (
    process.env.APP_ENV !== "test" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/ayin_e2e" ||
    process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL
  )
    throw new Error("Studio content acceptance requires the isolated local ayin_e2e database");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
async function seed(page: Page, email = "studio-pages@e2e.ayin.test") {
  const registration = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: { name: "Studio page creator", email, password: "strong-pass-123" },
  });
  expect(registration.status()).toBe(201);
  const identity = (await registration.json()).user;
  execFileSync(
    process.execPath,
    [path.resolve("tests/e2e/studio-content-pagination-fixture.mjs"), identity.channel.id],
    { env: process.env },
  );
  return identity;
}
async function titles(page: Page) {
  return page.locator("tbody th[scope=row]").allTextContents();
}
async function pageTwo(page: Page) {
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Content pages", exact: true })).toContainText(
    "Page 2",
  );
  await expect(page.locator("tbody tr")).toHaveCount(25);
}
async function editFirst(page: Page) {
  await page
    .locator("tbody tr")
    .first()
    .getByRole("button", { name: "Edit video", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Video editor", exact: true })).toBeVisible();
}
const failure = {
  status: 503,
  headers: { "access-control-allow-origin": WEB, "access-control-allow-credentials": "true" },
  json: { error: { message: "Isolated read failure" } },
};

test("130 actual videos remain reachable with one-page DOM, draft/applied filters and keyboard paging", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/studio/content?lang=en");
  await expect(page.locator("tbody tr")).toHaveCount(25);
  const first = await titles(page),
    all = [...first];
  for (let n = 2; n <= 6; n++) {
    const next = page.getByRole("button", { name: "Next page", exact: true });
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("navigation", { name: "Content pages", exact: true }),
    ).toContainText(`Page ${n}`);
    await expect(page.locator("tbody tr")).toHaveCount(n === 6 ? 5 : 25);
    all.push(...(await titles(page)));
  }
  expect(new Set(all).size).toBe(130);
  await expect(page.getByRole("button", { name: "Next page", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Return to first page", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(25);
  expect(await titles(page)).toEqual(first);
  await pageTwo(page);
  const second = await titles(page);
  await page.getByRole("textbox", { name: "Search videos", exact: true }).fill("Film night");
  await page.getByLabel("Status", { exact: true }).selectOption("PUBLISHED");
  expect(await titles(page)).toEqual(second);
  await expect(page.getByRole("navigation", { name: "Content pages", exact: true })).toContainText(
    "Page 2",
  );
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Content pages", exact: true })).toContainText(
    "Page 1",
  );
  await expect(page.locator("tbody tr")).toHaveCount(25);
  for (const row of await page.locator("tbody tr").all())
    await expect(row).toContainText("Published");
  await pageTwo(page);
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Content pages", exact: true })).toContainText(
    "Page 2",
  );
});

test("literal search punctuation is encoded without bypassing account scope", async ({ page }) => {
  await seed(page);
  await page.goto("/studio/content?lang=en");
  await expect(page.locator("tbody tr")).toHaveCount(25);
  const request = page.waitForRequest(
    (request) =>
      request.url().startsWith(endpoint) &&
      new URL(request.url()).searchParams.get("query") === "Film*",
  );
  await page.getByRole("textbox", { name: "Search videos", exact: true }).fill("Film*");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  expect((await request).url()).toContain("query=Film%2A");
  await expect(page.getByText("No videos match these filters.", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});

test("unchanged and discarded editor closes reload page two without moving the issued boundary", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/studio/content?lang=en");
  await expect(page.locator("tbody tr")).toHaveCount(25);
  await pageTwo(page);
  const before = await titles(page);
  await editFirst(page);
  await page.getByRole("button", { name: "Back to videos", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(25);
  expect(await titles(page)).toEqual(before);
  await editFirst(page);
  await page.getByLabel("Title", { exact: true }).fill("Unsaved page two title");
  await page.getByRole("button", { name: "Back to videos", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Discard changes and leave", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(25);
  expect(await titles(page)).toEqual(before);
  await expect(page.getByRole("navigation", { name: "Content pages", exact: true })).toContainText(
    "Page 2",
  );
});

for (const operation of ["save", "unpublish", "remove"] as const)
  test(`page-two ${operation} returns to filtered first page and preserves acknowledgment after failed refresh`, async ({
    page,
  }) => {
    await seed(page);
    let fail = false,
      writes = 0;
    await page.route(`${endpoint}?*`, (route) =>
      fail ? route.fulfill(failure) : route.continue(),
    );
    await page.route(`${API}/creator/studio/videos/**`, async (route) => {
      if (["PATCH", "POST", "DELETE"].includes(route.request().method())) writes++;
      await route.continue();
    });
    await page.goto("/studio/content?lang=en");
    await expect(page.locator("tbody tr")).toHaveCount(25);
    await page.getByRole("textbox", { name: "Search videos", exact: true }).fill("Film night");
    await page.getByLabel("Status", { exact: true }).selectOption("PUBLISHED");
    await page.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(25);
    await pageTwo(page);
    await editFirst(page);
    fail = true;
    if (operation === "save") {
      await page.getByLabel("Title", { exact: true }).fill("Film night saved from page two");
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
    } else {
      const label = operation === "unpublish" ? "Unpublish" : "Remove video";
      await page.getByRole("button", { name: label, exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: label, exact: true }).click();
    }
    await expect(page.getByRole("main").getByRole("alert")).toContainText("could not be loaded");
    await expect(page.getByRole("main")).toContainText(
      operation === "save"
        ? "Your changes were saved."
        : operation === "unpublish"
          ? "The video was unpublished."
          : "The video was removed.",
    );
    await expect(
      page.getByRole("navigation", { name: "Content pages", exact: true }),
    ).toContainText("Page 1");
    await expect(page.getByRole("textbox", { name: "Search videos", exact: true })).toHaveValue(
      "Film night",
    );
    await expect(page.getByLabel("Status", { exact: true })).toHaveValue("PUBLISHED");
    expect(writes).toBe(1);
    fail = false;
    await page.getByRole("button", { name: "Reload videos", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(25);
    if (operation === "save")
      await expect(page.locator("tbody tr").first()).toContainText(
        "Film night saved from page two",
      );
    expect(writes).toBe(1);
  });

test("overlapping page reads discard obsolete responses and switched accounts never inherit old cursors", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/studio/content?lang=en");
  await expect(page.locator("tbody tr")).toHaveCount(25);
  const first = await titles(page);
  let release: (() => void) | undefined, started: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route(`${endpoint}?*`, async (route) => {
    if (!new URL(route.request().url()).searchParams.has("cursor")) return route.continue();
    const response = await route.fetch();
    started?.();
    await held;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await reading;
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(25);
  expect(await titles(page)).toEqual(first);
  release?.();
  await page.unroute(`${endpoint}?*`);
  await expect(page.getByRole("navigation", { name: "Content pages", exact: true })).toContainText(
    "Page 1",
  );
  await seed(page, "studio-pages-other@e2e.ayin.test");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("could not be loaded");
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await page.getByRole("button", { name: "Return to first page", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(25);
  await expect(page.getByRole("navigation", { name: "Content pages", exact: true })).toContainText(
    "Page 1",
  );
});

for (const locale of ["en", "ar"] as const)
  for (const width of [390, 1440])
    test(`bounded content layout ${locale} ${width}`, async ({ page }, info) => {
      await seed(page);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(`${locale === "ar" ? "/ar" : ""}/studio/content?lang=${locale}`);
      await expect(page.locator("tbody tr")).toHaveCount(25);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const pager = page.getByRole("navigation", {
        name: locale === "ar" ? "صفحات المحتوى" : "Content pages",
        exact: true,
      });
      await pager.scrollIntoViewIfNeeded();
      const next = pager.getByRole("button", {
        name: locale === "ar" ? "الصفحة التالية" : "Next page",
        exact: true,
      });
      await next.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("tbody tr")).toHaveCount(25);
      await expect(
        pager.getByRole("button", {
          name: locale === "ar" ? "الصفحة السابقة" : "Previous page",
          exact: true,
        }),
      ).toBeEnabled();
      for (const badge of await page.locator("tbody span[data-tone]").all()) {
        expect(
          await badge.evaluate((node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return range.getClientRects().length;
          }),
        ).toBe(1);
      }
      await page.screenshot({
        path: info.outputPath(`design-studio-content-page2-${locale}-${width}.png`),
        fullPage: true,
      });
      await pager.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`design-studio-content-controls-${locale}-${width}.png`),
      });
    });
