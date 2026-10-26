import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:3141";
const MEDIA = "http://127.0.0.1:3142";
const origin = "http://127.0.0.1:3140";
const headers = {
  "access-control-allow-origin": origin,
  "access-control-allow-credentials": "true",
};
const film = (id: string, title = `Test film ${id}`) => ({
  id,
  type: "VIDEO",
  title,
  href: `/watch/${id}`,
  kicker: "Recently added",
  meta: "Creator · 12:06",
  artworkObjectKey: `thumbnails/${id}.svg`,
});
const feature = (id = "first") => ({
  ...film(id),
  description: "A complete story with real source metadata.",
  durationMs: 726000,
  channelName: "Creator",
});
const row = (key: string, source: string, items = [film("second")]) => ({
  key,
  source,
  title: "Editorial title",
  items,
  nextCursor: null,
  availability: items.length ? "AVAILABLE" : "EMPTY",
  emptyMessage: "No eligible videos",
});
const autoHome = () => ({
  mode: "AUTO",
  status: "READY",
  spotlight: feature(),
  rows: [row("auto-discover", "RECENTLY_ADDED")],
});

async function control(
  page: Page,
  response: () => unknown,
  fail: () => boolean = () => false,
  resolvedHero: unknown = null,
) {
  await page.route(`${API}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me")
      return route.fulfill({ status: 401, headers, json: { error: { code: "UNAUTHENTICATED" } } });
    if (path === "/platform/navigation") return route.fulfill({ headers, json: { flags: {} } });
    if (path === "/product-controls")
      return route.fulfill({
        headers,
        json: {
          resolvedHero,
          navigation: [
            { key: "home", label: "Home", href: "/", enabled: true, featureFlag: null },
            { key: "search", label: "Search", href: "/search", enabled: true, featureFlag: null },
          ],
          announcement: { enabled: false, text: "", href: null },
          deviceVisibility: { web: true, mobile: true, tv: true },
        },
      });
    if (path === "/public/discovery/home")
      return route.fulfill({
        status: fail() ? 503 : 200,
        headers,
        json: fail() ? { error: { message: "Controlled failure" } } : response(),
      });
    if (path.startsWith("/ads/")) return route.fulfill({ headers, json: { enabled: false } });
    return route.fulfill({ status: 404, headers, json: {} });
  });
  await page.route(`${MEDIA}/**`, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#251139"/><circle cx="530" cy="160" r="90" fill="#a16ade"/></svg>',
    }),
  );
}

async function fitsViewport(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}

test("empty and intentionally disabled catalogues expose a useful search action without fake cards", async ({
  page,
}) => {
  let home: unknown = { mode: "AUTO", status: "EMPTY", spotlight: null, rows: [] };
  await control(page, () => home);
  await page.goto("/?lang=en");
  await expect(page.getByRole("heading", { name: "Find something to watch" })).toBeVisible();
  await expect(
    page.locator("#discovery").getByRole("link", { name: "Search the collection" }),
  ).toHaveAttribute("href", "/search");
  await expect(page.locator("[data-home-spotlight]")).toHaveCount(0);
  home = { mode: "MANAGED", status: "DISABLED", spotlight: null, rows: [] };
  await page.reload();
  await expect(page.getByRole("heading", { name: "Explore AYIN", exact: true })).toBeVisible();
  await expect(page.locator("#discovery [role=alert]")).toHaveCount(0);
});

test("one eligible video is sufficient and is not duplicated in a shelf", async ({ page }) => {
  await control(page, () => ({ mode: "AUTO", status: "READY", spotlight: feature(), rows: [] }));
  await page.goto("/?lang=en");
  await expect(page.locator("[data-home-spotlight]")).toBeVisible();
  await expect(page.locator('main a[href="/watch/first"]')).toHaveCount(3);
  await expect(page.locator('#discovery a[href="/watch/first"]')).toHaveCount(0);
  await expect(page.locator("[data-home-artwork]")).toBeVisible();
  await expect(page.locator("[data-tv-focus-id=hero-primary]")).toContainText("Watch now");
  await expect(page.getByRole("heading", { name: "Find something to watch" })).toHaveCount(0);
  await fitsViewport(page);
});

test("automatic composition keeps saved editorial content dormant, while managed hero stays meaningful without rows", async ({
  page,
}) => {
  let home: unknown = { mode: "AUTO", status: "EMPTY", spotlight: null, rows: [] };
  await control(
    page,
    () => home,
    () => false,
    {
      entityType: "VIDEO",
      entityId: "saved-editorial",
      title: "Saved editorial choice",
      description: "An operator-selected feature.",
      href: "/watch/saved-editorial",
    },
  );
  await page.goto("/?lang=en");
  await expect(page.getByRole("heading", { name: "Find something to watch" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saved editorial choice" })).toHaveCount(0);
  home = { mode: "MANAGED", status: "EMPTY", spotlight: null, rows: [] };
  await page.reload();
  await expect(page.getByRole("heading", { name: "Saved editorial choice" })).toBeVisible();
  await expect(
    page.locator("#discovery").getByRole("heading", { name: "Explore AYIN", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("There are no featured videos", { exact: false })).toHaveCount(0);
});

for (const view of [
  { locale: "en", width: 1440, height: 900 },
  { locale: "ar", width: 390, height: 844 },
  { locale: "en", width: 360, height: 740 },
] as const) {
  test(`sparse catalogue remains usable at ${view.width}px in ${view.locale}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(view);
    await control(page, autoHome);
    await page.goto(`${view.locale === "ar" ? "/ar" : "/"}?lang=${view.locale}`);
    const prefix = view.locale === "ar" ? "/ar" : "";
    await expect(page.locator("html")).toHaveAttribute("dir", view.locale === "ar" ? "rtl" : "ltr");
    await expect(page.locator("[data-home-spotlight]")).toBeVisible();
    await expect(page.locator(`main a[href="${prefix}/watch/first"]`)).toHaveCount(3);
    await expect(page.locator(`main a[href="${prefix}/watch/second"]`)).toHaveCount(1);
    await expect(
      page
        .locator("#discovery")
        .getByRole("heading", { name: view.locale === "ar" ? "أُضيف حديثًا" : "Recently added" }),
    ).toBeVisible();
    await expect(page.locator("#discovery button[data-tv-focus-id$='-next']:visible")).toHaveCount(
      0,
    );
    const watch = page.locator("[data-tv-focus-id=hero-primary]");
    await watch.focus();
    await expect(watch).toBeFocused();
    await expect
      .poll(() =>
        watch.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return node.contains(
            document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
          );
        }),
      )
      .toBe(true);
    await fitsViewport(page);
    await page.screenshot({
      path: testInfo.outputPath(`home-${view.locale}-${view.width}.png`),
      fullPage: true,
    });
  });
}

test("real sections localize, jump to actual rows and retain editorial titles in managed mode", async ({
  page,
}) => {
  let home: unknown = {
    mode: "AUTO",
    status: "READY",
    spotlight: feature(),
    rows: [
      row("auto-movies", "MOVIES", [film("film-a"), film("film-b")]),
      row("auto-documentaries", "DOCUMENTARIES", [film("doc-a"), film("doc-b")]),
    ],
  };
  await control(page, () => home);
  await page.goto("/ar?lang=ar");
  const sections = page.getByRole("navigation", { name: "في هذه الصفحة" });
  await sections.getByRole("link", { name: "وثائقيات" }).click();
  const id = (await sections.getByRole("link", { name: "وثائقيات" }).getAttribute("href"))!.slice(
    1,
  );
  await expect(
    page.locator(`[id="${id}"]`).getByRole("heading", { name: "وثائقيات" }),
  ).toBeVisible();
  home = {
    mode: "MANAGED",
    status: "READY",
    spotlight: null,
    rows: [row("auto-movies", "MOVIES")],
  };
  await page.reload();
  await expect(
    page.locator("#discovery").getByRole("heading", { name: "Editorial title" }),
  ).toBeVisible();
  await expect(
    page.locator("#discovery").getByRole("heading", { name: "أفلام", exact: true }),
  ).toHaveCount(0);
});

test("ineligible personal rows do not become false service errors", async ({ page }) => {
  await control(page, () => ({
    mode: "MANAGED",
    status: "READY",
    spotlight: null,
    rows: [
      row("recent", "RECENTLY_ADDED"),
      {
        ...row("continue", "CONTINUE_WATCHING", []),
        availability: "UNAVAILABLE",
        emptyMessage: "Sign in to continue watching",
      },
    ],
  }));
  await page.goto("/?lang=en");
  await expect(
    page.locator("#discovery").getByRole("heading", { name: "Editorial title" }),
  ).toBeVisible();
  await expect(page.locator("#discovery [role=alert]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry discovery" })).toHaveCount(0);
});

test("a failed response can be retried and stale spotlight is hidden on audience suspension", async ({
  page,
}) => {
  let failed = true;
  let home = autoHome();
  await control(
    page,
    () => home,
    () => failed,
  );
  await page.goto("/?lang=en");
  await expect(page.locator("#discovery [role=alert]")).toBeVisible();
  failed = false;
  await page.getByRole("button", { name: "Retry discovery" }).click();
  await expect(page.locator('[data-home-spotlight="first"]')).toBeVisible();
  const concealed = await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    const node = document.querySelector('[data-home-spotlight="first"]');
    return !node || !!node.closest("[hidden]");
  });
  expect(concealed).toBe(true);
  home = { ...autoHome(), spotlight: feature("replacement") };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator('[data-home-spotlight="replacement"]')).toBeVisible();
  await expect(page.locator('[data-home-spotlight="first"]')).toHaveCount(0);
});
