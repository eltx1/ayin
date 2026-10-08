import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test as base, type Page, type TestInfo } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
interface Catalog {
  fixtureId: string;
  accountId: string;
  profileId: string;
  alternateProfileId: string;
  email: string;
  password: string;
  videos: { id: string; slug: string; title: string }[];
}
function fixture<T = { ok: boolean }>(command: string, input: object = {}): T {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/clips-audience-fixture.mjs"), command, JSON.stringify(input)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
const test = base.extend<{ catalog: Catalog }>({
  catalog: async ({ baseURL }, use) => {
    if (!baseURL) throw new Error("Standard Playwright baseURL required.");
    const catalog = fixture<Catalog>("seed");
    try {
      await use(catalog);
    } finally {
      fixture("cleanup", { fixtureId: catalog.fixtureId });
    }
  },
});
test.use({
  serviceWorkers: "block",
  contextOptions: { reducedMotion: "reduce" },
  viewport: { width: 1440, height: 900 },
});
async function captureAudience(page: Page, testInfo: TestInfo, name: string) {
  const stateRead = page.evaluate(() => ({
    pathname: location.pathname,
    viewport: { width: innerWidth, height: innerHeight },
    locale: document.documentElement.lang,
    direction: document.documentElement.dir,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    clipCount: document.querySelectorAll("[data-clip-item]").length,
    clips: [...document.querySelectorAll<HTMLElement>("[data-clip-item]")]
      .slice(0, 24)
      .map((node) => {
        const video = node.querySelector("video");
        const rect = node.getBoundingClientRect();
        return {
          id: node.dataset.videoId,
          active: node.dataset.clipActive === "true",
          bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          media: video
            ? {
                readyState: video.readyState,
                paused: video.paused,
                currentTime: video.currentTime,
                sourcePresent: video.hasAttribute("src"),
              }
            : null,
        };
      }),
    headings: [...document.querySelectorAll("main h1,main h2")]
      .slice(0, 6)
      .map((node) => node.textContent?.slice(0, 200)),
  }));
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  const state = await Promise.race([
    stateRead,
    new Promise<never>((_, reject) => {
      snapshotTimer = setTimeout(
        () => reject(new Error("Clips evidence snapshot timed out")),
        2_500,
      );
    }),
  ]).finally(() => clearTimeout(snapshotTimer));
  const json = testInfo.outputPath(`clips-audience-${name}.json`);
  writeFileSync(json, JSON.stringify(state, null, 2));
  await testInfo.attach(`clips-audience-${name}-state`, {
    path: json,
    contentType: "application/json",
  });
  const screenshot = testInfo.outputPath(`clips-audience-${name}.png`);
  await page.screenshot({
    path: screenshot,
    fullPage: false,
    animations: "disabled",
    timeout: 5_000,
  });
  await testInfo.attach(`clips-audience-${name}`, { path: screenshot, contentType: "image/png" });
}

test.beforeEach(async ({ page }) => {
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(
    true,
  );
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  // Keep failure collection bounded and never replace the original test error.
  try {
    await captureAudience(page, testInfo, "failure");
  } catch (error) {
    await testInfo.attach("clips-audience-capture-failure", {
      body: String(error).slice(0, 1_200),
      contentType: "text/plain",
    });
  }
});

async function login(page: Page, catalog: Catalog) {
  expect(
    (
      await page.request.post(`${API}/auth/login`, {
        headers: { origin: WEB },
        data: { email: catalog.email, password: catalog.password },
      })
    ).status(),
  ).toBe(200);
}
const change = (catalog: Catalog, command: string, extra: object = {}) =>
  fixture(command, { fixtureId: catalog.fixtureId, ...extra });
const article = (page: Page, id: string) =>
  page.locator(`[data-clip-item='true'][data-video-id='${id}']`);
async function selectIndex(page: Page, index: number) {
  const active = page.locator("[data-clip-active='true']");
  let current = Number(await active.getAttribute("data-clip-index"));
  while (current !== index) {
    const delta = index > current ? 1 : -1;
    await active.focus();
    await page.keyboard.press(delta > 0 ? "ArrowDown" : "ArrowUp");
    current += delta;
    await expect(active).toHaveAttribute("data-clip-index", String(current));
  }
}
async function refocus(page: Page) {
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}
async function installMedia(page: Page) {
  const bytes = readFileSync(path.resolve("tests/e2e/fixtures/clips-viewport.webm"));
  await page.route("**/e2e/clips-audience/**/canonical.mp4", async (route) => {
    const range = route
      .request()
      .headers()
      .range?.match(/^bytes=(\d+)-(\d*)$/);
    if (!range)
      return route.fulfill({
        status: 200,
        contentType: "video/webm",
        headers: { "accept-ranges": "bytes" },
        body: bytes,
      });
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    await route.fulfill({
      status: 206,
      contentType: "video/webm",
      headers: {
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${end}/${bytes.length}`,
      },
      body: bytes.subarray(start, end + 1),
    });
  });
}
function hold() {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { waiting, release };
}

for (const locale of ["en", "ar"] as const) {
  for (const width of [1440, 390]) {
    test(`default Kids ordinary ${locale} ${width}px Clips never embeds or requests adult media and traverses policy-filtered pages`, async ({
      page,
      catalog,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      change(catalog, "default-kids", { isKids: true });
      await login(page, catalog);
      await installMedia(page);
      const sourceRequests: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes(`/e2e/clips-audience/${catalog.fixtureId}/`))
          sourceRequests.push(request.url());
      });
      const route = `${locale === "ar" ? "/ar" : ""}/clips?lang=${locale}`;
      const html = await (await page.request.get(`${WEB}${route}`)).text();
      for (const video of catalog.videos) {
        expect(html).not.toContain(video.title);
        expect(html).not.toContain(video.id);
      }
      expect(html).not.toContain(`e2e/clips-audience/${catalog.fixtureId}`);
      const proxy = await page.request.get(`${WEB}/api/clips`);
      expect(proxy.status()).toBe(410);
      expect(await proxy.text()).not.toContain(catalog.videos[0]!.id);
      await page.goto(route);
      await expect(article(page, catalog.videos[1]!.id)).toBeVisible();
      await expect(article(page, catalog.videos[0]!.id)).toHaveCount(0);
      await expect(page.locator("[data-clips-feed]")).toHaveAttribute(
        "data-clips-loaded-count",
        "20",
      );
      await expect(page.locator("[data-clip-item]")).toHaveCount(2);
      await expect
        .poll(() =>
          article(page, catalog.videos[1]!.id)
            .locator("video")
            .evaluate((video: HTMLVideoElement) => video.readyState),
        )
        .toBeGreaterThanOrEqual(2);
      await captureAudience(page, testInfo, `kids-${locale}-${width}`);
      await page.locator('[data-tv-focus-id="clips-load-more"]').click();
      await expect(page.locator("[data-clips-feed]")).toHaveAttribute(
        "data-clips-loaded-count",
        "24",
      );
      await selectIndex(page, 23);
      await expect(article(page, catalog.videos[24]!.id)).toHaveAttribute(
        "data-clip-active",
        "true",
      );
      await expect(article(page, catalog.videos[0]!.id)).toHaveCount(0);
      await expect(page.locator("[data-clip-ad-boundary]")).toHaveCount(0);
      expect(sourceRequests.some((url) => url.includes(`/${catalog.fixtureId}/0/`))).toBe(false);
    });
  }
}

test("pending and failed audience reads expose only the neutral shell, then recover explicitly", async ({
  page,
  catalog,
}, testInfo) => {
  await login(page, catalog);
  const gate = hold();
  let captured = false;
  await page.route(`${API}/auth/me`, async (route) => {
    captured = true;
    await gate.waiting;
    await route.abort("failed").catch(() => undefined);
  });
  try {
    await page.goto("/clips?lang=en");
    await expect.poll(() => captured).toBe(true);
    await expect(page.locator("[data-clip-item], video")).toHaveCount(0);
    await captureAudience(page, testInfo, "neutral-en-1440");
    gate.release();
    await expect(page.getByRole("heading", { name: "Clips could not be loaded" })).toBeVisible();
    await expect(page.locator("[data-clip-item], video")).toHaveCount(0);
    await captureAudience(page, testInfo, "error-en-1440");
    await page.unroute(`${API}/auth/me`);
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(article(page, catalog.videos[0]!.id)).toBeVisible();
  } finally {
    gate.release();
  }
});

for (const phase of ["initial", "continuation"] as const) {
  test(`held adult ${phase} cannot populate the newly verified Kids feed`, async ({
    page,
    catalog,
  }) => {
    await login(page, catalog);
    const gate = hold();
    let captured = false;
    let delivered = false;
    await page.route(`${API}/public/clips?*`, async (route) => {
      const isContinuation = new URL(route.request().url()).searchParams.has("cursor");
      if (captured || isContinuation !== (phase === "continuation")) return route.continue();
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      expect((await actual.json()).viewer.isKids).toBe(false);
      captured = true;
      await gate.waiting;
      await route.fulfill({ response: actual }).catch(() => undefined);
      delivered = true;
    });
    try {
      await page.goto("/clips?lang=en");
      if (phase === "continuation") {
        await expect(article(page, catalog.videos[0]!.id)).toBeVisible();
        await page.locator('[data-tv-focus-id="clips-load-more"]').click();
      }
      await expect.poll(() => captured).toBe(true);
      change(catalog, "default-kids", { isKids: true });
      const revoked = await page.evaluate(() => {
        const videos = [...document.querySelectorAll("video")];
        window.dispatchEvent(new Event("blur"));
        return videos.every((video) => video.paused && !video.hasAttribute("src"));
      });
      expect(revoked).toBe(true);
      await refocus(page);
      await expect(article(page, catalog.videos[1]!.id)).toBeVisible();
      gate.release();
      await expect.poll(() => delivered).toBe(true);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(article(page, catalog.videos[0]!.id)).toHaveCount(0);
      await expect(page.locator("[data-clips-feed]")).toHaveAttribute(
        "data-clips-loaded-count",
        "20",
      );
      await expect(page.locator("[data-clip-item]")).toHaveCount(2);
    } finally {
      gate.release();
    }
  });
}

test("same verified viewer retains native controls, position, active Clip and loaded pagination only after fresh reads", async ({
  page,
  catalog,
}, testInfo) => {
  await login(page, catalog);
  await installMedia(page);
  await page.goto("/clips?lang=en");
  await expect(article(page, catalog.videos[0]!.id)).toBeVisible();
  await page.locator('[data-tv-focus-id="clips-load-more"]').click();
  const target = article(page, catalog.videos[21]!.id);
  await expect(page.locator("[data-clips-feed]")).toHaveAttribute("data-clips-loaded-count", "25");
  await selectIndex(page, 21);
  await expect(target).toHaveAttribute("data-clip-active", "true");
  const video = target.locator("video");
  await expect
    .poll(() => video.evaluate((media: HTMLVideoElement) => media.readyState))
    .toBeGreaterThanOrEqual(2);
  await video.evaluate((media: HTMLVideoElement) => {
    media.pause();
    media.currentTime = 2;
    media.muted = false;
    media.volume = 0.42;
    media.playbackRate = 1.25;
  });
  await expect.poll(() => video.evaluate((media: HTMLVideoElement) => !media.seeking)).toBe(true);
  let reads = 0;
  page.on("request", (request) => {
    if (request.url().includes("/public/clips?")) reads++;
  });
  const suspended = await page.evaluate(() => {
    const videos = [...document.querySelectorAll("video")];
    const feed = document.querySelector<HTMLElement>("[data-clips-feed]")!;
    const before = feed.scrollTop;
    window.dispatchEvent(new Event("blur"));
    return {
      before,
      afterConcealment: feed.scrollTop,
      revoked: videos.every((media) => media.paused && !media.hasAttribute("src")),
    };
  });
  expect(suspended.revoked).toBe(true);
  expect(suspended.before).toBeGreaterThan(0);
  await refocus(page);
  await expect(target).toBeVisible();
  await expect
    .poll(() => page.locator("[data-clips-feed]").evaluate((feed: HTMLElement) => feed.scrollTop))
    .toBe(suspended.before);
  await expect(target).toBeInViewport({ ratio: 0.7 });
  await expect(target).toHaveAttribute("data-clip-active", "true");
  await expect(page.locator("[data-clips-feed]")).toHaveAttribute("data-clips-loaded-count", "25");
  await expect
    .poll(() =>
      video.evaluate((media: HTMLVideoElement) => ({
        time: Math.round(media.currentTime * 10) / 10,
        muted: media.muted,
        volume: media.volume,
        rate: media.playbackRate,
        paused: media.paused,
      })),
    )
    .toEqual({ time: 2, muted: false, volume: 0.42, rate: 1.25, paused: true });
  expect(reads).toBe(2);
  await testInfo.attach("clips-scroll-restoration", {
    body: JSON.stringify({
      suspended,
      restored: await page
        .locator("[data-clips-feed]")
        .evaluate((feed: HTMLElement) => feed.scrollTop),
      active: await target.getAttribute("data-clip-active"),
      reads,
    }),
    contentType: "application/json",
  });
});

test("changed default profile cannot inherit adult media or prior pagination", async ({
  page,
  catalog,
}) => {
  await login(page, catalog);
  await page.goto("/clips?lang=en");
  await expect(article(page, catalog.videos[0]!.id)).toBeVisible();
  await page.locator('[data-tv-focus-id="clips-load-more"]').click();
  await expect(page.locator("[data-clips-feed]")).toHaveAttribute("data-clips-loaded-count", "25");
  change(catalog, "switch-default");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await refocus(page);
  await expect(article(page, catalog.videos[1]!.id)).toBeVisible();
  await expect(article(page, catalog.videos[0]!.id)).toHaveCount(0);
  await expect(page.locator("[data-clips-feed]")).toHaveAttribute("data-clips-loaded-count", "20");
  await expect(page.locator("[data-clip-item]")).toHaveCount(2);
});
