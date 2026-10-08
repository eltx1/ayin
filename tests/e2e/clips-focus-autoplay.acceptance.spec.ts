import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

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
test.use({
  serviceWorkers: "block",
  contextOptions: { reducedMotion: "no-preference" },
  viewport: { width: 1440, height: 900 },
});

test("focus preserves the current deliberate pause, then scrolling resumes normal Clips autoplay", async ({
  page,
}, testInfo) => {
  const catalog = fixture<Catalog>("seed");
  try {
    expect(
      (
        await page.request.post(`${API}/auth/login`, {
          headers: { origin: WEB },
          data: { email: catalog.email, password: catalog.password },
        })
      ).status(),
    ).toBe(200);
    await installMedia(page);
    await page.goto("/clips?lang=en");
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(
      false,
    );
    const current = page.locator(
      `[data-clip-item='true'][data-video-id='${catalog.videos[0]!.id}']`,
    );
    const next = page.locator(`[data-clip-item='true'][data-video-id='${catalog.videos[1]!.id}']`);
    await expect(current).toHaveAttribute("data-clip-active", "true");
    await expect
      .poll(() =>
        current
          .locator("video")
          .evaluate((video: HTMLVideoElement) => !video.paused && video.readyState >= 2),
      )
      .toBe(true);
    await current.locator(`[data-tv-focus-id="clip-${catalog.videos[0]!.id}-play"]`).click();
    await expect(next.locator("video")).toHaveCount(0);
    const revoked = await page.evaluate(() => {
      const videos = [...document.querySelectorAll("video")];
      window.dispatchEvent(new Event("blur"));
      return videos.every((video) => video.paused && !video.hasAttribute("src"));
    });
    expect(revoked).toBe(true);
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(current).toHaveAttribute("data-clip-active", "true");
    await expect
      .poll(() => current.locator("video").evaluate((video: HTMLVideoElement) => video.readyState))
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(() => current.locator("video").evaluate((video: HTMLVideoElement) => video.paused))
      .toBe(true);
    // The next Clip was paused only because it was offscreen at suspension.
    await next.evaluate((node) => node.scrollIntoView({ block: "center", behavior: "instant" }));
    await expect(next).toHaveAttribute("data-clip-active", "true");
    await expect
      .poll(() =>
        next
          .locator("video")
          .evaluate((video: HTMLVideoElement) => !video.paused && video.currentTime > 0),
      )
      .toBe(true);
    // Returning is a new feed activation, not a permanent retained pause.
    await current.evaluate((node) => node.scrollIntoView({ block: "center", behavior: "instant" }));
    await expect(current).toHaveAttribute("data-clip-active", "true");
    await expect
      .poll(() =>
        current
          .locator("video")
          .evaluate((video: HTMLVideoElement) => !video.paused && video.currentTime > 0),
      )
      .toBe(true);
    await testInfo.attach("clips-focus-autoplay", {
      body: JSON.stringify(
        await current.locator("video").evaluate((video: HTMLVideoElement) => ({
          paused: video.paused,
          currentTime: video.currentTime,
          readyState: video.readyState,
          reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        })),
      ),
      contentType: "application/json",
    });
  } finally {
    fixture("cleanup", { fixtureId: catalog.fixtureId });
  }
});
