import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page, type Locator } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001";
const MEDIA = process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? "http://media.invalid";
const fixturePath = path.resolve("tests/e2e/public-discovery-detail-fixture.mjs");
interface Catalog {
  movieSlug: string;
  seriesSlug: string;
  movieVideoSlug: string;
  trailerVideoSlug: string;
  episodeVideoSlug: string;
  channelHandle: string;
  videoId: string;
  channelId: string;
  tvId: string;
  playlistId: string;
  playlistSlug: string;
  longTitle: string;
}
function fixture<T = Catalog>(command: string, payload: object = {}): T {
  return JSON.parse(
    execFileSync(process.execPath, [fixturePath, command, JSON.stringify(payload)], {
      env: process.env,
      encoding: "utf8",
    }),
  );
}
const layouts = [
  { width: 390, height: 844, locale: "en" },
  { width: 390, height: 844, locale: "ar" },
  { width: 1440, height: 1000, locale: "en" },
  { width: 1440, height: 1000, locale: "ar" },
] as const;
async function unobscured(control: Locator) {
  await expect
    .poll(() =>
      control.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const x = bounds.x + bounds.width / 2;
        return (
          bounds.y >= 0 &&
          bounds.bottom <= innerHeight &&
          element.contains(document.elementFromPoint(x, bounds.y + 3)) &&
          element.contains(document.elementFromPoint(x, bounds.bottom - 3))
        );
      }),
    )
    .toBe(true);
}
async function contained(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  for (const heading of await page.locator("main h1:visible, main h2:visible").all()) {
    const bounds = await heading.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
}

// API/catalog reads below are real. Only the image transport is a deterministic
// local test cover; these assertions do not certify R2/media-provider delivery.
async function testArtwork(page: Page) {
  const body =
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="720"><rect width="480" height="720" fill="#21103f"/><circle cx="240" cy="290" r="155" fill="#6415ce"/><path d="M200 190L345 290L200 390Z" fill="#fff"/><text x="240" y="540" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#fff">AYIN · TEST COVER</text></svg>';
  await page.route(
    (url) => url.hostname === new URL(MEDIA).hostname,
    (route) => route.fulfill({ contentType: "image/svg+xml", body }),
  );
  await page.route("**/_next/image?**", async (route) => {
    const source = new URL(route.request().url()).searchParams.get("url");
    if (source && new URL(source, route.request().url()).hostname === new URL(MEDIA).hostname) {
      await route.fulfill({ contentType: "image/svg+xml", body });
    } else {
      await route.continue();
    }
  });
}

test("real public hero shares one controls read, preserves authored copy and uses locale canonical destinations", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const catalog = fixture("seed");
  try {
    fixture("hero", { entityType: "VIDEO", entityId: catalog.videoId });
    const response = await page.request.get(`${API}/product-controls`);
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.resolvedHero).toMatchObject({
      entityId: catalog.videoId,
      href: `/watch/${catalog.movieVideoSlug}`,
      description: null,
    });
    let reads = 0;
    page.on("request", (request) => {
      if (request.url() === `${API}/product-controls`) reads++;
    });
    for (const layout of layouts) {
      const prefix = layout.locale === "ar" ? "/ar" : "";
      await page.setViewportSize(layout);
      const before = reads;
      await page.goto(`${prefix}/?lang=${layout.locale}`);
      const hero = page.locator('section[aria-labelledby="ayin-hero-title"]:visible');
      await expect(hero.getByRole("heading", { level: 1 })).toHaveText(catalog.longTitle.trim());
      await expect(
        hero.getByRole("link", {
          name: layout.locale === "ar" ? "شاهد الفيديو" : "Watch video",
          exact: true,
        }),
      ).toHaveAttribute("href", `${prefix}/watch/${catalog.movieVideoSlug}`);
      const search = hero.getByRole("link", {
        name: layout.locale === "ar" ? "ابحث في AYIN" : "Search AYIN",
        exact: true,
      });
      await expect(search).toHaveAttribute("href", `${prefix}/search`);
      expect(reads - before).toBe(1);
      await hero.locator('[data-tv-focus-id="hero-primary"]').focus();
      await unobscured(hero.locator('[data-tv-focus-id="hero-primary"]'));
      await page.keyboard.press("Tab");
      await expect(search).toBeFocused();
      await unobscured(search);
      await contained(page);
      await page.screenshot({
        path: testInfo.outputPath(`hero-focused-${layout.width}-${layout.locale}.png`),
      });
      await hero.screenshot({
        path: testInfo.outputPath(`hero-real-${layout.width}-${layout.locale}.png`),
      });
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`${prefix}/search$`));
    }
    for (const locale of ["en", "ar"]) {
      const prefix = locale === "ar" ? "/ar" : "";
      for (const entity of [
        { entityType: "CHANNEL", entityId: catalog.channelId, href: `/c/${catalog.channelHandle}` },
        {
          entityType: "CREATOR_TV",
          entityId: catalog.tvId,
          href: `/c/${catalog.channelHandle}/tv`,
        },
        {
          entityType: "PLAYLIST",
          entityId: catalog.playlistId,
          href: `/c/${catalog.channelHandle}/playlists/${catalog.playlistSlug}`,
        },
      ]) {
        fixture("hero", entity);
        await page.goto(`${prefix}/?lang=${locale}`);
        const primary = page.locator('[data-tv-focus-id="hero-primary"]:visible');
        await expect(primary).toHaveAttribute("href", `${prefix}${entity.href}`);
        await primary.focus();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(new RegExp(`${prefix}${entity.href}$`));
        await expect(page.locator("main h1:visible")).toHaveCount(1);
      }
    }
    fixture("hero");
    await page.goto("/ar/?lang=ar");
    await expect(page.locator("main:visible h1")).toHaveText("هنا، للحكايات إيقاع مختلف.");
    await expect(page.locator('[data-tv-focus-id="hero-primary"]:visible')).toHaveAttribute(
      "href",
      "#discovery",
    );
  } finally {
    fixture("cleanup", catalog);
  }
});

test("real search artwork and catalog detail controls work in EN/AR desktop/mobile with authored season copy", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const catalog = fixture("seed");
  await testArtwork(page);
  try {
    const searchResponse = await page.request.get(
      `${API}/public/search?q=${encodeURIComponent("Catalog E2E Published")}`,
    );
    expect(searchResponse.ok()).toBe(true);
    const results = await searchResponse.json();
    const movie = results.items.find(
      (item: { href: string }) => item.href === `/movies/${catalog.movieSlug}`,
    );
    expect(movie.artworkObjectKey).toBeTruthy();
    for (const layout of layouts) {
      const ar = layout.locale === "ar",
        prefix = ar ? "/ar" : "";
      await page.setViewportSize(layout);
      await page.goto(`${prefix}/search?q=Catalog+E2E+Published&lang=${layout.locale}`);
      const card = page.locator(
        `main:visible a[data-tv-focus-id][href="${prefix}/movies/${catalog.movieSlug}"]`,
      );
      await expect(card).toBeVisible();
      await expect(card).toContainText(ar ? "فيلم" : "Movie");
      const artwork = card.locator('[data-media-artwork="true"]');
      await expect(artwork).toHaveAttribute("src", `${MEDIA}/${movie.artworkObjectKey}`);
      await expect
        .poll(() => artwork.evaluate((image) => (image as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
      await contained(page);
      await page.screenshot({
        path: testInfo.outputPath(`search-real-${layout.width}-${layout.locale}.png`),
        fullPage: true,
      });
      await card.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("main:visible h1")).toHaveText("Catalog E2E Published Movie");
      await expect(
        page.getByRole("link", { name: ar ? "شاهد الفيلم" : "Watch movie", exact: true }),
      ).toHaveAttribute("href", `${prefix}/watch/${catalog.movieVideoSlug}`);
      await expect(
        page.getByRole("link", {
          name: ar ? "شاهد الإعلان التشويقي" : "Watch trailer",
          exact: true,
        }),
      ).toHaveAttribute("href", `${prefix}/watch/${catalog.trailerVideoSlug}`);
      await expect(page.locator("main:visible")).toContainText(ar ? "١١٨ دقيقة" : "118 min");
      await expect(page.locator("main:visible")).toContainText("Original editorial synopsis.");
      await contained(page);
      await page.screenshot({
        path: testInfo.outputPath(`movie-real-${layout.width}-${layout.locale}.png`),
        fullPage: true,
      });
      await page.goto(`${prefix}/series/${catalog.seriesSlug}?lang=${layout.locale}`);
      await expect(page.locator("main:visible h1")).toHaveText("Catalog E2E Published Series");
      const seasons = page.getByRole("navigation", {
        name: ar ? "اختيار الموسم" : "Season selector",
        exact: true,
      });
      await expect(
        seasons.getByRole("link", { name: ar ? "الموسم ١" : "Season 1", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      await expect(
        page.getByRole("link", { name: ar ? "ابدأ المشاهدة" : "Start watching", exact: true }),
      ).toHaveAttribute("href", `${prefix}/watch/${catalog.episodeVideoSlug}`);
      await expect(page.locator("main:visible")).toContainText(ar ? "الحلقة ١" : "Episode 1");
      await contained(page);
      await page.screenshot({
        path: testInfo.outputPath(`series-real-${layout.width}-${layout.locale}.png`),
        fullPage: true,
      });
      const secondSeason = seasons.getByRole("link", {
        name: "Creator’s own season title",
        exact: true,
      });
      await secondSeason.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(
        new RegExp(`${prefix}/series/${catalog.seriesSlug}\\?season=2$`),
      );
      await expect(page.locator("main:visible h2")).toHaveText("Creator’s own season title");
      await expect(
        page.getByRole("heading", { name: "Second season premiere", exact: true }),
      ).toBeVisible();
      await page.goBack();
      await expect(page.locator("main:visible h2")).toHaveText(ar ? "الموسم ١" : "Season 1");
    }
    await page.goto("/ar/search?q=NoMatchesForThisUniqueDiscoveryPhrase&lang=ar");
    await expect(page.getByRole("heading", { name: "لا توجد نتائج", exact: true })).toBeVisible();
  } finally {
    fixture("cleanup", catalog);
  }
});

test.describe("controlled hero read failures", () => {
  // Scoped fault injection only. The other tests exercise the actual API.
  test.use({ serviceWorkers: "block" });
  test("loading, failed read and null recovery preserve localized usable actions", async ({
    page,
    baseURL,
  }, testInfo) => {
    test.setTimeout(120_000);
    for (const layout of layouts) {
      const ar = layout.locale === "ar",
        prefix = ar ? "/ar" : "";
      await page.setViewportSize(layout);
      let release: (() => void) | undefined;
      let reads = 0;
      const controls = {
        navigation: [{ key: "home", label: "Home", href: "/", enabled: true, featureFlag: null }],
        announcement: { enabled: false, text: "", href: null },
        deviceVisibility: { web: true, mobile: true, tv: true },
        resolvedHero: null,
      };
      await page.route(`${API}/product-controls`, async (route) => {
        reads++;
        const attempt = reads;
        if (attempt <= 2)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        await route.fulfill({
          status: attempt === 1 ? 503 : 200,
          headers: {
            "access-control-allow-origin": baseURL!,
            "access-control-allow-credentials": "true",
          },
          json: attempt === 1 ? { message: "Controlled read failure" } : controls,
        });
      });
      await page.goto(`${prefix}/?lang=${layout.locale}`, { waitUntil: "domcontentloaded" });
      const hero = page.locator('section[aria-labelledby="ayin-hero-title"]:visible');
      await expect(hero.getByRole("status")).toContainText(
        ar ? "جارٍ تحميل المحتوى المميز…" : "Loading featured content…",
      );
      await expect.poll(() => typeof release).toBe("function");
      await hero.screenshot({
        path: testInfo.outputPath(`hero-loading-${layout.width}-${layout.locale}.png`),
      });
      release!();
      await expect(hero.getByRole("status")).toContainText(
        ar ? "تعذر تحميل المحتوى المميز." : "Featured content could not be loaded.",
      );
      const retry = hero.getByRole("button", {
        name: ar ? "إعادة المحاولة" : "Try again",
        exact: true,
      });
      await hero.screenshot({
        path: testInfo.outputPath(`hero-error-${layout.width}-${layout.locale}.png`),
      });
      await retry.evaluate((button) =>
        button.scrollIntoView({ block: "center", behavior: "instant" }),
      );
      await retry.focus();
      await expect(retry).toBeFocused();
      await unobscured(retry);
      await page.screenshot({
        path: testInfo.outputPath(`hero-retry-visible-${layout.width}-${layout.locale}.png`),
      });
      await page.keyboard.press("Enter");
      await expect(hero.getByRole("status")).toContainText(
        ar ? "جارٍ تحميل المحتوى المميز…" : "Loading featured content…",
      );
      await expect(retry).toHaveCount(0);
      await expect.poll(() => reads).toBe(2);
      release!();
      await expect(hero.getByRole("status")).toHaveCount(0);
      await expect(hero.locator('[data-tv-focus-id="hero-primary"]')).toHaveAttribute(
        "href",
        "#discovery",
      );
      await expect(hero.getByRole("heading", { level: 1 })).toHaveText(
        ar ? "هنا، للحكايات إيقاع مختلف." : "Stories move differently here.",
      );
      await contained(page);
      await hero.screenshot({
        path: testInfo.outputPath(`hero-recovered-${layout.width}-${layout.locale}.png`),
      });
      await page.unroute(`${API}/product-controls`);
    }
  });
});
