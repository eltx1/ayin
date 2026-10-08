import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
const DB_HELPER = path.resolve(process.cwd(), "tests/e2e/db-helper.mjs");

function db<T>(command: string, payload: Record<string, unknown> = {}): T {
  return JSON.parse(
    execFileSync(process.execPath, [DB_HELPER, command, JSON.stringify(payload)], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
    }),
  ) as T;
}

// Decoded synthetic media and reduced motion keep the capture frame stable.
// This does not certify provider playback, native-control clearance, or devices.
async function installCaptureMedia(page: Page) {
  const bytes = readFileSync(path.resolve("tests/e2e/fixtures/clips-viewport.webm"));
  await page.route("**/e2e/clips/**/canonical.mp4", async (route) => {
    const range = route
      .request()
      .headers()
      .range?.match(/^bytes=(\d+)-(\d*)$/);
    if (!range) {
      return route.fulfill({
        status: 200,
        contentType: "video/webm",
        headers: { "accept-ranges": "bytes" },
        body: bytes,
      });
    }
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

async function captureViewport(page: Page, videoId: string, name: string, testInfo: TestInfo) {
  const article = page.locator(`[data-clip-item='true'][data-video-id='${videoId}']`);
  const video = article.locator("video");
  await expect
    .poll(() => video.evaluate((media: HTMLVideoElement) => media.readyState))
    .toBeGreaterThanOrEqual(2);
  await article.locator(`[data-tv-focus-id="clip-${videoId}-play"]`).click();
  await expect
    .poll(() =>
      video.evaluate((media: HTMLVideoElement) => media.getVideoPlaybackQuality().totalVideoFrames),
    )
    .toBeGreaterThan(0);
  await video.evaluate((media: HTMLVideoElement) => {
    media.pause();
    media.currentTime = 1;
  });
  await expect
    .poll(() =>
      video.evaluate(
        (media: HTMLVideoElement) => media.paused && !media.seeking && media.currentTime === 1,
      ),
    )
    .toBe(true);
  await article.evaluate((element) =>
    element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }),
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  const bounds = await article.evaluate((element) => {
    const box = (node: Element) => {
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
    const header = document.querySelector('[data-tv-focus-id="brand-home"]')!.closest("header")!;
    const mobile = [...document.querySelectorAll("nav[data-mobile-visible]")].find(
      (node) =>
        getComputedStyle(node).position === "fixed" && node.getBoundingClientRect().height > 0,
    );
    const usable = { top: box(header).bottom, bottom: mobile ? box(mobile).top : innerHeight };
    const clip = box(element);
    const media = element.querySelector("video")!;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scrollY,
      feedScrollTop: element.parentElement!.scrollTop,
      usable,
      clip,
      media: {
        readyState: media.readyState,
        paused: media.paused,
        seeking: media.seeking,
        currentTime: media.currentTime,
        width: media.videoWidth,
        height: media.videoHeight,
        decodedFrames: media.getVideoPlaybackQuality().totalVideoFrames,
        error: media.error?.code ?? null,
      },
      controls: [...element.querySelectorAll("button,a,h2,p")]
        .filter(
          (control) =>
            control.getBoundingClientRect().width > 0 && control.getBoundingClientRect().height > 0,
        )
        .map((control) => {
          const r = box(control);
          const fragments = [...control.getClientRects()]
            .filter((fragment) => fragment.width > 0 && fragment.height > 0)
            .map((fragment) => ({
              left: fragment.left,
              right: fragment.right,
              top: fragment.top,
              bottom: fragment.bottom,
              width: fragment.width,
              height: fragment.height,
            }));
          // Wrapped inline links have whitespace inside their union box.
          const hitTests = control.matches("button,a")
            ? fragments.flatMap((fragment) =>
                [0.25, 0.5, 0.75].map((fraction) => {
                  const point = {
                    x: fragment.left + fragment.width * fraction,
                    y: fragment.top + fragment.height / 2,
                  };
                  const hit = document.elementFromPoint(point.x, point.y);
                  return {
                    ...point,
                    hit: hit?.tagName ?? null,
                    passes: Boolean(hit && (hit === control || control.contains(hit))),
                  };
                }),
              )
            : [];
          return {
            label: control.textContent?.trim(),
            tag: control.tagName,
            box: r,
            fragments,
            hitTests,
            hit:
              !control.matches("button,a") ||
              (hitTests.length > 0 && hitTests.every((hit) => hit.passes)),
          };
        }),
    };
  });
  // These are custom-control and shell bounds. The native layout suite also
  // verifies Chromium's internal play, seek and fullscreen targets separately.
  expect(bounds.clip.top).toBeGreaterThanOrEqual(bounds.usable.top - 1);
  expect(bounds.clip.bottom).toBeLessThanOrEqual(bounds.usable.bottom + 1);
  expect(bounds.media.error).toBeNull();
  expect(bounds.media.width).toBeGreaterThan(0);
  for (const control of bounds.controls) {
    expect(control.box.left, control.label).toBeGreaterThanOrEqual(bounds.clip.left - 1);
    expect(control.box.right, control.label).toBeLessThanOrEqual(bounds.clip.right + 1);
    expect(control.box.top, control.label).toBeGreaterThanOrEqual(bounds.usable.top - 1);
    expect(control.box.bottom, control.label).toBeLessThanOrEqual(bounds.usable.bottom + 1);
    expect(control.hit, control.label).toBe(true);
    if (control.tag === "BUTTON") {
      expect(control.box.width).toBeGreaterThanOrEqual(44);
      expect(control.box.height).toBeGreaterThanOrEqual(44);
    }
  }
  const videoBox = await video.boundingBox();
  if (videoBox)
    await page.mouse.move(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height - 25);
  await testInfo.attach(`${name}-bounds`, {
    body: JSON.stringify(bounds, null, 2),
    contentType: "application/json",
  });
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: false,
    animations: "disabled",
  });
}

test.use({ serviceWorkers: "block", contextOptions: { reducedMotion: "reduce" } });

test.beforeEach(() => {
  db("reset");
});

test("Clips paginate real rows and recover uncertain social writes in EN/AR", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const registration = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Clips viewer",
      email: "clips-viewer@e2e.ayin.test",
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBe(true);

  const fixture = db<{
    channelId: string;
    handle: string;
    firstVideoId: string;
    items: Array<{ id: string; slug: string; title: string }>;
  }>("seed-clips-viewer");

  const invalid = await page.request.get(`${WEB}/api/clips?cursor=invalid`);
  expect(invalid.status()).toBe(400);

  await installCaptureMedia(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/clips?lang=en");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "AYIN Clips" })).toBeVisible();
  await expect(page.locator("[data-clips-feed]")).toHaveAttribute("data-clips-loaded-count", "20");
  await expect(main.getByRole("article")).toHaveCount(2);
  await expect(main.getByText("Clip 01", { exact: true })).toBeVisible();
  await expect(main.locator('a[href*="#comments"]')).toHaveCount(0);
  await expect(main.getByText("Ad opportunity", { exact: true })).toHaveCount(0);

  const like = main.getByRole("button", { name: /^Like ·/ });
  await expect(like).toBeVisible();

  let likeWrites = 0;
  const likeUrl = `${API}/social/videos/${fixture.firstVideoId}/reaction`;
  await page.route(likeUrl, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    likeWrites += 1;
    await route.abort("failed");
  });
  await like.click();
  await expect(main.getByText(/could not confirm that change/i)).toBeVisible();
  expect(likeWrites).toBe(1);
  await page.unroute(likeUrl);

  await main.getByRole("button", { name: "Refresh actions", exact: true }).click();
  await expect(main.getByRole("button", { name: /^Like ·/ })).toBeVisible();
  await main.getByRole("button", { name: /^Like ·/ }).click();
  await expect(main.getByRole("button", { name: /^Liked ·/ })).toBeVisible();

  let subscriptionWrites = 0;
  const subscriptionUrl = `${API}/social/channels/${fixture.channelId}/subscription`;
  await page.route(subscriptionUrl, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    subscriptionWrites += 1;
    await route.abort("failed");
  });
  await main.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(main.getByText(/could not confirm that change/i)).toBeVisible();
  expect(subscriptionWrites).toBe(1);
  await page.unroute(subscriptionUrl);

  await main.getByRole("button", { name: "Refresh actions", exact: true }).click();
  await expect(main.getByRole("button", { name: "Subscribe", exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Subscribe", exact: true }).click();
  await expect(main.getByRole("button", { name: "Subscribed", exact: true })).toBeVisible();

  expect(
    db<{ reactions: number; subscriptions: number }>("social-counts", {
      videoId: fixture.firstVideoId,
      channelId: fixture.channelId,
    }),
  ).toMatchObject({ reactions: 1, subscriptions: 1 });

  await main.getByRole("button", { name: "Load more Clips", exact: true }).click();
  await expect(page.locator("[data-clips-feed]")).toHaveAttribute("data-clips-loaded-count", "22");
  await expect(main.getByRole("article")).toHaveCount(2);
  await expect(main.getByRole("button", { name: "Load more Clips", exact: true })).toHaveCount(0);

  await captureViewport(page, fixture.firstVideoId, "design-clips-1440-en", testInfo);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar/clips?lang=ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(main.getByRole("heading", { level: 1, name: "مقاطع AYIN" })).toBeVisible();
  await expect(page.locator("[data-clips-feed]")).toHaveAttribute("data-clips-loaded-count", "20");
  await expect(main.getByRole("article")).toHaveCount(2);
  await expect(main.getByRole("button", { name: /^تم الإعجاب ·/ })).toBeVisible();
  await expect(main.getByRole("button", { name: "مشترك", exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
  await captureViewport(page, fixture.firstVideoId, "design-clips-390-ar", testInfo);
});
