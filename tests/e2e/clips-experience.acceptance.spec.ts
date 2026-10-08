import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
interface Catalog {
  fixtureId: string;
  accountId: string;
  profileId: string;
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
const active = (page: Page) => page.locator("[data-clip-item][data-clip-active='true']");
const feed = (page: Page) => page.locator("[data-clips-feed]");
const clip = (page: Page, id: string) => page.locator(`[data-clip-item][data-video-id="${id}"]`);
async function seekTo(range: Locator, seconds: number) {
  // Use the native input setter and bubbling input event so React receives a
  // real authored-range change. Keyboard increment/ownership is checked below.
  await range.evaluate((element: HTMLInputElement, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      element,
      String(value),
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, seconds);
}
async function frames(page: Page) {
  await expect
    .poll(() =>
      active(page)
        .locator("video")
        .evaluate((video: HTMLVideoElement) => video.getVideoPlaybackQuality().totalVideoFrames),
    )
    .toBeGreaterThan(0);
}
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
// Auth, audience, feed, social, progress and media decode remain real. Only
// canonical MP4 bytes are substituted with the repository's decoded WebM.
async function installMedia(page: Page) {
  const bytes = readFileSync(path.resolve("tests/e2e/fixtures/clips-viewport.webm"));
  const transfers: { url: string; range: string | null; bytes: number }[] = [];
  await page.route("**/e2e/clips-audience/**/canonical.mp4", async (route) => {
    const range = route.request().headers().range;
    const match = range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = match ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
    if (start > end)
      return route.fulfill({
        status: 416,
        headers: { "content-range": `bytes */${bytes.length}` },
      });
    transfers.push({ url: route.request().url(), range: range ?? null, bytes: end - start + 1 });
    await route.fulfill({
      status: match ? 206 : 200,
      contentType: "video/webm",
      headers: {
        "accept-ranges": "bytes",
        ...(match ? { "content-range": `bytes ${start}-${end}/${bytes.length}` } : {}),
      },
      body: bytes.subarray(start, end + 1),
    });
  });
  return transfers;
}
async function attachState(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: false, animations: "disabled" });
  await testInfo.attach(name, { path: screenshot, contentType: "image/png" });
}
async function bounded(page: Page) {
  await expect(page.locator("video")).toHaveCount(1);
  expect(await page.locator("[data-clip-item]").count()).toBeLessThanOrEqual(3);
  const state = await page.evaluate(() => {
    const current = document.querySelector("[data-clip-active='true']");
    return [...document.querySelectorAll("video")].every(
      (video) => video.closest("[data-clip-item]") === current,
    );
  });
  expect(state).toBe(true);
}
async function navigateIndex(page: Page, index: number) {
  // A virtualized feed has adjacent native snap targets, not off-window article
  // elements. Traverse its real keyboard navigation instead of asking CSS snap
  // to jump to an artificial target inside a spacer.
  let current = Number(await active(page).getAttribute("data-clip-index"));
  while (current !== index) {
    const delta = index > current ? 1 : -1;
    await active(page).focus();
    await page.keyboard.press(delta > 0 ? "ArrowDown" : "ArrowUp");
    current += delta;
    await expect(active(page)).toHaveAttribute("data-clip-index", String(current));
  }
}

test.use({
  serviceWorkers: "block",
  contextOptions: { reducedMotion: "no-preference" },
  viewport: { width: 390, height: 844 },
});

test("100 decoded Clips forward and return keep one media owner and bounded DOM, then release on exit", async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const catalog = fixture<Catalog>("seed", { count: 130 });
  try {
    await login(page, catalog);
    const transfers = await installMedia(page);
    await page.addInitScript(() => {
      const samples = { maxArticles: 0, maxMedia: 0, maxPlaying: 0, overlaps: 0 };
      Object.assign(window, { clipsResourceSamples: samples });
      const measure = () => {
        const media = [...document.querySelectorAll("video")];
        const playing = media.filter((video) => !video.paused && !video.ended).length;
        samples.maxArticles = Math.max(
          samples.maxArticles,
          document.querySelectorAll("[data-clip-item]").length,
        );
        samples.maxMedia = Math.max(samples.maxMedia, media.length);
        samples.maxPlaying = Math.max(samples.maxPlaying, playing);
        if (playing > 1) samples.overlaps++;
      };
      document.addEventListener("play", measure, true);
      document.addEventListener("playing", measure, true);
      new MutationObserver(measure).observe(document, { childList: true, subtree: true });
      const tick = () => {
        measure();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.goto("/clips?lang=en");
    await expect(active(page)).toHaveAttribute("data-video-id", catalog.videos[0]!.id);
    await frames(page);
    for (let count = 40; count <= 120; count += 20) {
      await page.getByRole("button", { name: "Load more Clips", exact: true }).click();
      await expect(feed(page)).toHaveAttribute("data-clips-loaded-count", String(count));
    }
    await expect(page.getByRole("button", { name: "Load more Clips", exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Start a fresh feed", exact: true }),
    ).toBeVisible();
    const visited = new Set([0]);
    const domCounts: number[] = [];
    for (const index of [
      ...Array.from({ length: 99 }, (_, i) => i + 1),
      ...Array.from({ length: 99 }, (_, i) => 98 - i),
    ]) {
      const old = await active(page).locator("video").elementHandle();
      await page
        .getByRole("button", {
          name:
            index > Number(await active(page).getAttribute("data-clip-index"))
              ? "Next Clip"
              : "Previous Clip",
          exact: true,
        })
        .click();
      await expect(active(page)).toHaveAttribute("data-video-id", catalog.videos[index]!.id);
      await bounded(page);
      await frames(page);
      expect(
        await old!.evaluate(
          (video: HTMLVideoElement) =>
            video.paused && !video.hasAttribute("src") && !video.isConnected,
        ),
      ).toBe(true);
      await old!.dispose();
      visited.add(index);
      domCounts.push(await page.locator("*").count());
    }
    expect(visited.size).toBe(100);
    const samples = await page.evaluate(
      () => (window as unknown as { clipsResourceSamples: object }).clipsResourceSamples,
    );
    expect(samples).toMatchObject({ maxMedia: 1, maxPlaying: 1, overlaps: 0 });
    expect(Math.max(...domCounts) - Math.min(...domCounts)).toBeLessThan(60);
    expect(
      transfers.every((item) => Number(item.url.match(/\/(\d+)\/canonical\.mp4/)?.[1]) < 100),
    ).toBe(true);
    // The bounded session ends through an explicit action. It must discard the
    // old pagination metadata and retire its decoder before starting again.
    const previousSession = await active(page).locator("video").elementHandle();
    await page.getByRole("button", { name: "Start a fresh feed", exact: true }).click();
    await expect(feed(page)).toHaveAttribute("data-clips-loaded-count", "20");
    await expect(active(page)).toHaveAttribute("data-video-id", catalog.videos[0]!.id);
    await bounded(page);
    expect(
      await previousSession!.evaluate(
        (node: HTMLVideoElement) => node.paused && !node.hasAttribute("src") && !node.isConnected,
      ),
    ).toBe(true);
    await previousSession!.dispose();
    const current = await active(page).locator("video").elementHandle();
    await page.locator('[data-tv-focus-id="brand-home"]:visible').click();
    await expect(page.locator("[data-clip-item], video")).toHaveCount(0);
    expect(
      await current!.evaluate(
        (video: HTMLVideoElement) => video.paused && !video.hasAttribute("src"),
      ),
    ).toBe(true);
    await current!.dispose();
    await testInfo.attach("clips-100-forward-return-resources", {
      body: JSON.stringify(
        {
          samples,
          visited: visited.size,
          traversals: domCounts.length + 1,
          explicitFreshReset: true,
          domMin: Math.min(...domCounts),
          domMax: Math.max(...domCounts),
          transferCount: transfers.length,
          servedBytes: transfers.reduce((sum, item) => sum + item.bytes, 0),
          transfers,
          note: "Actual intercepted ranges and supplied bytes; synthetic local WebM, no network-byte ceiling or JS heap/leak claim.",
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    fixture("cleanup", { fixtureId: catalog.fixtureId });
  }
});

test("Save-Data starts paused and requests no speculative offscreen media or untouched progress", async ({
  page,
}, testInfo) => {
  const catalog = fixture<Catalog>("seed");
  try {
    await login(page, catalog);
    await page.addInitScript(() => {
      const connection = new EventTarget();
      Object.assign(connection, { saveData: true, effectiveType: "4g" });
      Object.defineProperty(navigator, "connection", { configurable: true, value: connection });
    });
    const transfers = await installMedia(page);
    const progressWrites: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "PUT" && request.url().includes("/watch/progress/"))
        progressWrites.push(request.url());
    });
    await page.goto("/clips?lang=en");
    await expect(page.getByRole("button", { name: "Save data", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(active(page).locator("video")).toHaveAttribute("preload", "none");
    expect(
      await active(page)
        .locator("video")
        .evaluate((video: HTMLVideoElement) => video.paused),
    ).toBe(true);
    await page.waitForTimeout(300);
    expect(transfers).toEqual([]);
    await page.getByRole("button", { name: "Next Clip", exact: true }).click();
    await expect(active(page)).toHaveAttribute("data-clip-index", "1");
    await bounded(page);
    await page.waitForTimeout(300);
    expect(transfers).toEqual([]);
    expect(progressWrites).toEqual([]);
    await active(page).locator(`[data-tv-focus-id="clip-${catalog.videos[1]!.id}-play"]`).click();
    await frames(page);
    expect(transfers.length).toBeGreaterThan(0);
    expect(transfers.every((item) => item.url.includes(`/${catalog.fixtureId}/1/`))).toBe(true);
    await testInfo.attach("clips-save-data-transfers", {
      body: JSON.stringify(transfers),
      contentType: "application/json",
    });
  } finally {
    fixture("cleanup", { fixtureId: catalog.fixtureId });
  }
});

for (const locale of ["en", "ar"] as const) {
  test(`authored controls and long-text Details preserve focus, playback intent and ordinary history ${locale}`, async ({
    page,
  }, testInfo) => {
    const catalog = fixture<Catalog>("seed", { longText: true });
    try {
      await login(page, catalog);
      await installMedia(page);
      await page.goto("/");
      await page.goto(locale === "ar" ? "/ar/clips?lang=ar" : "/clips?lang=en");
      await frames(page);
      const id = catalog.videos[0]!.id;
      const video = active(page).locator("video");
      const play = page.locator(`[data-tv-focus-id="clip-${id}-play"]`);
      const seek = page.locator(`[data-tv-focus-id="clip-${id}-seek"]`);
      const mute = page.locator(`[data-tv-focus-id="clip-${id}-mute"]`);
      expect(await video.evaluate((node: HTMLVideoElement) => node.controls)).toBe(false);
      await play.click();
      await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
      await seek.focus();
      await seekTo(seek, 7);
      await seek.press("ArrowRight");
      await expect
        .poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime))
        .toBeCloseTo(7.1, 1);
      await seek.press("ArrowDown");
      await expect(active(page)).toHaveAttribute("data-video-id", id);
      await mute.click();
      expect(await video.evaluate((node: HTMLVideoElement) => node.muted)).toBe(false);
      await mute.click();
      expect(await video.evaluate((node: HTMLVideoElement) => node.muted)).toBe(true);
      const trigger = active(page).getByRole("button", {
        name: locale === "ar" ? "التفاصيل" : "Details",
        exact: true,
      });
      const dialog = page.getByRole("dialog", {
        name: locale === "ar" ? "التفاصيل" : "Details",
        exact: true,
      });
      const before = await page.evaluate(() => ({ url: location.href, history: history.length }));
      await trigger.click();
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("END OF COMPLETE DESCRIPTION.");
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
      expect(bounds!.y).toBeGreaterThanOrEqual(-1);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(845);
      await dialog.evaluate((node) =>
        node.scrollTo({ top: node.scrollHeight, behavior: "instant" }),
      );
      await expect(active(page)).toHaveAttribute("data-video-id", id);
      expect(await page.evaluate(() => ({ url: location.href, history: history.length }))).toEqual(
        before,
      );
      await attachState(page, testInfo, `clips-details-long-${locale}-390`);
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      expect(await video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
      await play.click();
      await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(false);
      const playingAt = await video.evaluate((node: HTMLVideoElement) => node.currentTime);
      await trigger.click();
      await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
      const pausedAt = await video.evaluate((node: HTMLVideoElement) => node.currentTime);
      expect(pausedAt).toBeGreaterThanOrEqual(playingAt);
      await dialog
        .getByRole("button", { name: locale === "ar" ? "إغلاق" : "Close", exact: true })
        .click();
      await expect(trigger).toBeFocused();
      await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(false);
      expect(
        await video.evaluate((node: HTMLVideoElement) => node.currentTime),
      ).toBeGreaterThanOrEqual(pausedAt);
      await trigger.click();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.keyboard.press("Escape");
      await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
      expect(await page.evaluate(() => history.length)).toBe(before.history);
      await trigger.click();
      await page.goBack();
      await expect(page).toHaveURL(/\/(?:ar)?$/);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator("video")).toHaveCount(0);
    } finally {
      fixture("cleanup", { fixtureId: catalog.fixtureId });
    }
  });
}

test("delayed play completion and rejected autoplay cannot revive retired media or leave false Pause UI", async ({
  page,
}) => {
  const catalog = fixture<Catalog>("seed");
  try {
    await login(page, catalog);
    await installMedia(page);
    await page.addInitScript(() => {
      const original = HTMLMediaElement.prototype.play;
      let calls = 0;
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      Object.assign(window, { releaseClipPlay: release });
      HTMLMediaElement.prototype.play = function () {
        calls++;
        if (calls === 1) return original.call(this).then(() => pending);
        if (calls === 2)
          return Promise.reject(
            new DOMException("Controlled autoplay rejection", "NotAllowedError"),
          );
        return original.call(this);
      };
    });
    await page.goto("/clips?lang=en");
    await frames(page);
    const old = await active(page).locator("video").elementHandle();
    await page.getByRole("button", { name: "Next Clip", exact: true }).click();
    await expect(active(page)).toHaveAttribute("data-clip-index", "1");
    await expect(active(page).getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await page.evaluate(() =>
      (window as unknown as { releaseClipPlay: () => void }).releaseClipPlay(),
    );
    expect(
      await old!.evaluate(
        (video: HTMLVideoElement) =>
          video.paused && !video.hasAttribute("src") && !video.isConnected,
      ),
    ).toBe(true);
    await active(page).getByRole("button", { name: "Play", exact: true }).click();
    await frames(page);
    for (let i = 0; i < 8; i++) {
      await page
        .getByRole("button", { name: i % 2 ? "Previous Clip" : "Next Clip", exact: true })
        .click();
      await bounded(page);
    }
    expect(
      await old!.evaluate((video: HTMLVideoElement) => video.paused && !video.hasAttribute("src")),
    ).toBe(true);
    await old!.dispose();
  } finally {
    fixture("cleanup", { fixtureId: catalog.fixtureId });
  }
});

test("playing checkpoint survives focus and page-two creator Back, including an evicted explicit rewind", async ({
  page,
}) => {
  const catalog = fixture<Catalog>("seed");
  try {
    await login(page, catalog);
    await installMedia(page);
    await page.goto("/clips?lang=en");
    await frames(page);
    await page.getByRole("button", { name: "Load more Clips", exact: true }).click();
    await expect(feed(page)).toHaveAttribute("data-clips-loaded-count", "25");
    await navigateIndex(page, 21);
    await frames(page);
    const id = catalog.videos[21]!.id;
    await seekTo(page.locator(`[data-tv-focus-id="clip-${id}-seek"]`), 17);
    await expect
      .poll(() =>
        active(page)
          .locator("video")
          .evaluate((node: HTMLVideoElement) => node.currentTime),
      )
      .toBeGreaterThanOrEqual(17);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(clip(page, id)).toHaveAttribute("data-clip-active", "true");
    await expect
      .poll(() =>
        active(page)
          .locator("video")
          .evaluate(
            (node: HTMLVideoElement) =>
              !node.paused && node.currentTime >= 17 && node.currentTime < 20,
          ),
      )
      .toBe(true);
    await page.locator(`[data-tv-focus-id="clip-${id}-play"]`).click();
    await seekTo(page.locator(`[data-tv-focus-id="clip-${id}-seek"]`), 0);
    await expect
      .poll(() =>
        active(page)
          .locator("video")
          .evaluate((node: HTMLVideoElement) => node.currentTime),
      )
      .toBe(0);
    await active(page).locator('a[href*="/c/"]').click();
    await expect(page).toHaveURL(/\/c\//);
    await expect(page.locator("[data-clips-feed], video")).toHaveCount(0);
    await page.goBack();
    await expect(clip(page, id)).toHaveAttribute("data-clip-active", "true");
    await expect(feed(page)).toHaveAttribute("data-clips-loaded-count", "25");
    await expect
      .poll(() =>
        active(page)
          .locator("video")
          .evaluate((node: HTMLVideoElement) => node.currentTime),
      )
      .toBe(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await navigateIndex(page, 24);
    await expect(clip(page, id)).toHaveCount(0);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let captured = false;
    await page.route(`${API}/watch/progress/${id}?*`, async (route) => {
      captured = true;
      const actual = await route.fetch();
      await gate;
      await route.fulfill({ response: actual }).catch(() => undefined);
    });
    try {
      await navigateIndex(page, 21);
      await expect.poll(() => captured).toBe(true);
      await expect
        .poll(() =>
          active(page)
            .locator("video")
            .evaluate((node: HTMLVideoElement) => node.readyState),
        )
        .toBeGreaterThanOrEqual(1);
      expect(
        await active(page)
          .locator("video")
          .evaluate((node: HTMLVideoElement) => node.currentTime),
      ).toBe(0);
      release();
      await expect
        .poll(() =>
          active(page)
            .locator("video")
            .evaluate((node: HTMLVideoElement) => node.currentTime),
        )
        .toBe(0);
    } finally {
      release();
    }
  } finally {
    fixture("cleanup", { fixtureId: catalog.fixtureId });
  }
});

for (const locale of ["en", "ar"] as const) {
  for (const viewport of [
    { width: 360, height: 780 },
    { width: 768, height: 1024 },
    { width: 844, height: 390 },
  ]) {
    test(`first decoded authored viewport geometry ${locale} ${viewport.width}x${viewport.height}`, async ({
      page,
    }, testInfo) => {
      const catalog = fixture<Catalog>("seed");
      try {
        await page.setViewportSize(viewport);
        await login(page, catalog);
        await installMedia(page);
        await page.goto(locale === "ar" ? "/ar/clips?lang=ar" : "/clips?lang=en");
        await frames(page);
        const geometry = await active(page).evaluate((article) => {
          const rect = (node: Element) => {
            const r = node.getBoundingClientRect();
            return {
              left: r.left,
              right: r.right,
              top: r.top,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            };
          };
          const header = document
            .querySelector('[data-tv-focus-id="brand-home"]')!
            .closest("header")!;
          const bottom = [...document.querySelectorAll("nav[data-mobile-visible]")].find(
            (node) =>
              getComputedStyle(node).position === "fixed" &&
              node.getBoundingClientRect().height > 0,
          );
          return {
            scrollY,
            direction: getComputedStyle(article).direction,
            viewport: { width: innerWidth, height: innerHeight },
            usable: { top: rect(header).bottom, bottom: bottom ? rect(bottom).top : innerHeight },
            article: rect(article),
            video: rect(article.querySelector("video")!),
            objectFit: getComputedStyle(article.querySelector("video")!).objectFit,
            controls: [...article.querySelectorAll("button,input,a")]
              .filter((node) => node.getBoundingClientRect().height > 0)
              .map((node) => {
                const box = rect(node);
                const hit = document.elementFromPoint(
                  box.left + box.width / 2,
                  box.top + box.height / 2,
                );
                return {
                  box,
                  tag: node.tagName,
                  label: node.getAttribute("aria-label") ?? node.textContent,
                  hit: !!hit && (hit === node || node.contains(hit)),
                };
              }),
          };
        });
        expect(geometry.scrollY).toBe(0);
        expect(geometry.direction).toBe(locale === "ar" ? "rtl" : "ltr");
        expect(geometry.objectFit).toBe("contain");
        expect(geometry.article.top).toBeGreaterThanOrEqual(geometry.usable.top - 1);
        expect(geometry.article.bottom).toBeLessThanOrEqual(geometry.usable.bottom + 1);
        expect(geometry.video.height).toBeGreaterThan(40);
        for (const control of geometry.controls) {
          expect(control.box.left, control.label ?? "control").toBeGreaterThanOrEqual(-1);
          expect(control.box.right, control.label ?? "control").toBeLessThanOrEqual(
            viewport.width + 1,
          );
          expect(control.box.top, control.label ?? "control").toBeGreaterThanOrEqual(
            geometry.usable.top - 1,
          );
          expect(control.box.bottom, control.label ?? "control").toBeLessThanOrEqual(
            geometry.usable.bottom + 1,
          );
          expect(control.hit, control.label ?? "control").toBe(true);
          if (control.tag !== "A") {
            expect(control.box.width).toBeGreaterThanOrEqual(44);
            expect(control.box.height).toBeGreaterThanOrEqual(44);
          }
        }
        await testInfo.attach("authored-viewport-geometry", {
          body: JSON.stringify(geometry),
          contentType: "application/json",
        });
        await attachState(
          page,
          testInfo,
          `clips-authored-${locale}-${viewport.width}x${viewport.height}`,
        );
      } finally {
        fixture("cleanup", { fixtureId: catalog.fixtureId });
      }
    });
  }
}

test("real H.264 baseline MP4 decodes in the authored Clips player when the runtime supports AVC", async ({
  page,
}, testInfo) => {
  const supported = await page.evaluate(() =>
    document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"'),
  );
  test.skip(
    !supported,
    "This Chromium runtime does not advertise AVC; production MP4/device decoding is not certified by WebM tests.",
  );
  const output = testInfo.outputPath("synthetic-clips-baseline.mp4");
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=96x160:rate=24",
    "-t",
    "3",
    "-an",
    "-c:v",
    "libx264",
    "-profile:v",
    "baseline",
    "-level",
    "3.0",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    output,
  ]);
  const bytes = readFileSync(output);
  const catalog = fixture<Catalog>("seed");
  try {
    await login(page, catalog);
    await page.route("**/e2e/clips-audience/**/canonical.mp4", (route) =>
      route.fulfill({ contentType: "video/mp4", body: bytes }),
    );
    await page.goto("/clips?lang=en");
    await frames(page);
    expect(
      await active(page)
        .locator("video")
        .evaluate((video: HTMLVideoElement) => ({
          error: video.error?.code ?? null,
          width: video.videoWidth,
          height: video.videoHeight,
        })),
    ).toEqual({ error: null, width: 96, height: 160 });
    await testInfo.attach("mp4-runtime-decode", {
      body: JSON.stringify({
        canPlayType: supported,
        bytes: bytes.length,
        codec: "H.264 baseline, yuv420p",
        synthetic: true,
      }),
      contentType: "application/json",
    });
    await attachState(page, testInfo, "clips-decoded-baseline-mp4");
  } finally {
    fixture("cleanup", { fixtureId: catalog.fixtureId });
  }
});

test("50 uninterrupted rapid keyboard moves retain focus on the current virtualized Clip", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const catalog = fixture<Catalog>("seed", { count: 60 });
  try {
    await login(page, catalog);
    await installMedia(page);
    await page.goto("/clips?lang=en");
    await frames(page);
    for (const count of [40, 60]) {
      await page.getByRole("button", { name: "Load more Clips", exact: true }).click();
      await expect(feed(page)).toHaveAttribute("data-clips-loaded-count", String(count));
    }
    // Focus only once. Re-focusing on every step would conceal an application
    // bug where eviction of the previous focused article drops focus to BODY.
    await active(page).focus();
    const steps: {
      index: number;
      activeId: string | null;
      focusedId: string | null;
      focusedTag: string | undefined;
    }[] = [];
    for (let index = 1; index <= 50; index++) {
      await page.keyboard.press("ArrowDown");
      await expect(active(page)).toHaveAttribute("data-clip-index", String(index));
      const step = await page.evaluate(
        (index) => ({
          index,
          activeId:
            document.querySelector("[data-clip-active='true']")?.getAttribute("data-video-id") ??
            null,
          focusedId: document.activeElement?.getAttribute("data-video-id") ?? null,
          focusedTag: document.activeElement?.tagName,
        }),
        index,
      );
      steps.push(step);
      expect(step.focusedId).toBe(step.activeId);
      await bounded(page);
    }
    await testInfo.attach("clips-rapid-keyboard-focus", {
      body: JSON.stringify(steps),
      contentType: "application/json",
    });
  } finally {
    fixture("cleanup", { fixtureId: catalog.fixtureId });
  }
});

test("global menu pauses Clips and keeps EN/AR language switching available without a viewport row", async ({
  page,
}) => {
  const catalog = fixture<Catalog>("seed");
  try {
    await login(page, catalog);
    await installMedia(page);
    await page.goto("/clips?lang=en");
    await frames(page);
    await expect(page.getByRole("navigation", { name: "Language", exact: true })).toHaveCount(0);
    const trigger = page.getByRole("button", { name: "Open menu", exact: true });
    await trigger.click();
    const menu = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("navigation", { name: "Language", exact: true }) });
    await expect(menu).toBeVisible();
    await expect
      .poll(() =>
        active(page)
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.paused),
      )
      .toBe(true);
    await expect(menu.getByRole("link", { name: "English", exact: true })).toBeVisible();
    await expect(menu.getByRole("link", { name: "العربية", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect
      .poll(() =>
        active(page)
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.paused),
      )
      .toBe(false);
    await trigger.click();
    await menu.getByRole("link", { name: "العربية", exact: true }).click();
    await expect(page).toHaveURL(/\/ar\/clips/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(active(page)).toHaveAttribute("data-video-id", catalog.videos[0]!.id);
    await bounded(page);
    await page.getByRole("button", { name: "فتح القائمة", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "اللغة", exact: true })).toBeVisible();
    await page
      .getByRole("navigation", { name: "اللغة", exact: true })
      .getByRole("link", { name: "English", exact: true })
      .click();
    await expect(page).toHaveURL(/\/clips/);
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(active(page)).toHaveAttribute("data-video-id", catalog.videos[0]!.id);
  } finally {
    fixture("cleanup", { fixtureId: catalog.fixtureId });
  }
});
