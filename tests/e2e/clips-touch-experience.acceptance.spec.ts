import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
interface Catalog {
  fixtureId: string;
  email: string;
  password: string;
  videos: { id: string }[];
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

test("emulated Chromium touch swipe reverses while range dragging and Details scrolling keep input ownership", async ({
  browser,
  browserName,
}, testInfo) => {
  test.setTimeout(90_000);
  expect(browserName).toBe("chromium");
  const catalog = fixture<Catalog>("seed", { longText: true });
  const context = await browser.newContext({
    baseURL: WEB,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  try {
    expect(
      (
        await page.request.post(`${API}/auth/login`, {
          headers: { origin: WEB },
          data: { email: catalog.email, password: catalog.password },
        })
      ).status(),
    ).toBe(200);
    const bytes = readFileSync(path.resolve("tests/e2e/fixtures/clips-viewport.webm"));
    await page.route("**/e2e/clips-audience/**/canonical.mp4", async (route) => {
      const match = route
        .request()
        .headers()
        .range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
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
    await page.addInitScript(() => {
      const touches: { trusted: boolean; target: string | undefined }[] = [];
      Object.assign(window, { clipsTrustedTouches: touches });
      document.addEventListener(
        "touchstart",
        (event) =>
          touches.push({
            trusted: event.isTrusted,
            target: (event.target as Element).tagName,
          }),
        { passive: true, capture: true },
      );
    });
    await page.goto("/clips?lang=en");
    expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
    const active = page.locator("[data-clip-active='true']");
    const feed = page.locator("[data-clips-feed]");
    await expect(active).toHaveAttribute("data-video-id", catalog.videos[0]!.id);
    await expect
      .poll(() =>
        active
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.getVideoPlaybackQuality().totalVideoFrames),
      )
      .toBeGreaterThan(0);
    const stageHeight = await feed.evaluate((node: HTMLElement) => node.clientHeight);
    const drag = async (x: number, startY: number, endY: number) => {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y: startY, id: 1 }],
      });
      for (let step = 1; step <= 16; step++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: startY + ((endY - startY) * step) / 16, id: 1 }],
        });
        await page.waitForTimeout(25);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    const swipe = async (direction: 1 | -1) => {
      const box = await active.locator("video").boundingBox();
      if (!box) throw new Error("Decoded touch target has no box");
      await drag(
        box.x + box.width / 2,
        direction === 1 ? box.y + box.height - 12 : box.y + 12,
        direction === 1 ? 20 : 744,
      );
    };
    const settled = async (index: number) => {
      await expect
        .poll(() =>
          feed.evaluate(async (node: HTMLElement, target) => {
            const expected = target * node.clientHeight;
            const before = node.scrollTop;
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            );
            return Math.abs(before - expected) < 1 && Math.abs(node.scrollTop - expected) < 1;
          }, index),
        )
        .toBe(true);
    };
    await swipe(1);
    await expect(active).toHaveAttribute("data-video-id", catalog.videos[1]!.id);
    await settled(1);
    await expect(page.locator("video")).toHaveCount(1);
    await expect
      .poll(() => active.locator("video").evaluate((video: HTMLVideoElement) => video.readyState))
      .toBeGreaterThanOrEqual(2);
    await swipe(-1);
    await expect(active).toHaveAttribute("data-video-id", catalog.videos[0]!.id);
    await settled(0);
    await expect
      .poll(() => active.locator("video").evaluate((video: HTMLVideoElement) => video.readyState))
      .toBeGreaterThanOrEqual(2);
    await active.getByRole("button", { name: "Pause", exact: true }).tap();
    const scrollTop = await feed.evaluate((node: HTMLElement) => node.scrollTop);
    const range = active.getByRole("slider", {
      name: "Playback position",
      exact: true,
    });
    const box = await range.boundingBox();
    if (!box) throw new Error("Native range has no touch bounds");
    const y = box.y + box.height / 2;
    const x = box.x + box.width * 0.2;
    const end = box.x + box.width * 0.75;
    const before = await active
      .locator("video")
      .evaluate((video: HTMLVideoElement) => video.currentTime);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y, id: 1 }],
    });
    for (let step = 1; step <= 8; step++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + ((end - x) * step) / 8, y, id: 1 }],
      });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(() => active.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime))
      .toBeGreaterThan(before + 3);
    await expect(active).toHaveAttribute("data-video-id", catalog.videos[0]!.id);
    expect(await feed.evaluate((node: HTMLElement) => node.scrollTop)).toBeCloseTo(scrollTop, 0);
    await active.getByRole("button", { name: "Details", exact: true }).tap();
    const dialog = page.getByRole("dialog", { name: "Details", exact: true });
    await expect(dialog).toBeVisible();
    const panel = await dialog.boundingBox();
    if (!panel) throw new Error("Details has no touch bounds");
    const panelStart = await dialog.evaluate((node) => {
      const state = { finished: false };
      Object.assign(window, { clipsPanelGesture: state });
      node.addEventListener(
        "scrollend",
        () => {
          state.finished = true;
        },
        { once: true },
      );
      return node.scrollTop;
    });
    await drag(panel.x + panel.width * 0.6, panel.y + panel.height * 0.8, panel.y + 96);
    await expect
      .poll(() => dialog.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(panelStart + 100);
    await expect(active).toHaveAttribute("data-video-id", catalog.videos[0]!.id);
    expect(await feed.evaluate((node: HTMLElement) => node.scrollTop)).toBeCloseTo(scrollTop, 0);
    // A tap during native kinetic scrolling intentionally stops the fling.
    // Wait for the browser's own scrollend before starting the Close gesture.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { clipsPanelGesture: { finished: boolean } }).clipsPanelGesture
              .finished,
        ),
      )
      .toBe(true);
    await dialog.getByRole("button", { name: "Close", exact: true }).tap();
    await expect(dialog).not.toBeVisible();
    await expect(active.getByRole("button", { name: "Details", exact: true })).toBeFocused();
    const touches = await page.evaluate(
      () =>
        (
          window as unknown as {
            clipsTrustedTouches: { trusted: boolean; target: string }[];
          }
        ).clipsTrustedTouches,
    );
    expect(touches.length).toBeGreaterThanOrEqual(4);
    expect(touches.every((event) => event.trusted)).toBe(true);
    await testInfo.attach("emulated-touch-input-proof", {
      body: JSON.stringify({
        touches,
        stageHeight,
        scrollTop,
        note: "Browser/CDP trusted input in emulated Chromium mobile touch. Not physical iOS/Android, OS edge Back, pinch zoom, VoiceOver or TalkBack verification.",
      }),
      contentType: "application/json",
    });
    await page.screenshot({
      path: testInfo.outputPath("clips-emulated-touch.png"),
      fullPage: false,
    });
  } finally {
    await testInfo.attach("touch-final-state", {
      body: JSON.stringify(
        await page
          .evaluate(() => ({
            touches: (window as unknown as { clipsTrustedTouches: unknown }).clipsTrustedTouches,
            maxTouchPoints: navigator.maxTouchPoints,
            active: document
              .querySelector("[data-clip-active='true']")
              ?.getAttribute("data-clip-index"),
            feedScrollTop: document.querySelector("[data-clips-feed]")?.scrollTop,
            scrollY,
          }))
          .catch(() => null),
      ),
      contentType: "application/json",
    });
    await cdp.detach();
    await context.close();
    fixture("cleanup", { fixtureId: catalog.fixtureId });
  }
});
