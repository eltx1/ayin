import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
interface Catalog {
  fixtureId: string;
  accountId: string;
  profileId: string;
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
test.use({
  serviceWorkers: "block",
  contextOptions: { reducedMotion: "reduce" },
  viewport: { width: 1440, height: 900 },
});

test("metadata-ready zero before a held saved-progress read cannot replace Clips resume across focus", async ({
  page,
}, testInfo) => {
  const catalog = fixture<Catalog>("seed");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured = false;
  let delivered = false;
  let progressReads = 0;
  const videoId = catalog.videos[0]!.id;
  try {
    expect(
      (
        await page.request.post(`${API}/auth/login`, {
          headers: { origin: WEB },
          data: { email: catalog.email, password: catalog.password },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await page.request.put(`${API}/watch/progress/${videoId}`, {
          headers: { origin: WEB, "x-ayin-expected-account": catalog.accountId },
          data: {
            profileId: catalog.profileId,
            expectedRevision: null,
            positionMs: 7_000,
            durationMs: 30_000,
          },
        })
      ).status(),
    ).toBe(200);
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
    await page.route(`${API}/watch/progress/${videoId}?*`, async (route) => {
      progressReads++;
      if (captured) return route.continue();
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      expect((await actual.json()).positionMs).toBe(7_000);
      captured = true;
      await held;
      await route.fulfill({ response: actual }).catch(() => undefined);
      delivered = true;
    });
    await page.goto("/clips?lang=en");
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(
      true,
    );
    const video = page.locator(`[data-clip-item='true'][data-video-id='${videoId}'] video`);
    await expect.poll(() => captured).toBe(true);
    await expect
      .poll(() => video.evaluate((media: HTMLVideoElement) => media.readyState))
      .toBeGreaterThanOrEqual(1);
    expect(
      await video.evaluate((media: HTMLVideoElement) => ({
        time: media.currentTime,
        paused: media.paused,
      })),
    ).toEqual({ time: 0, paused: true });
    const revoked = await video.evaluate((media: HTMLVideoElement) => {
      window.dispatchEvent(new Event("blur"));
      return media.paused && !media.hasAttribute("src");
    });
    expect(revoked).toBe(true);
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => progressReads).toBe(2);
    await expect.poll(() => video.evaluate((media: HTMLVideoElement) => media.currentTime)).toBe(7);
    release();
    await expect.poll(() => delivered).toBe(true);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await video.evaluate((media: HTMLVideoElement) => media.currentTime)).toBe(7);
    const stored = await page.request.get(
      `${API}/watch/progress/${videoId}?profileId=${catalog.profileId}`,
      { headers: { "x-ayin-expected-account": catalog.accountId } },
    );
    expect(stored.status()).toBe(200);
    expect((await stored.json()).positionMs).toBe(7_000);
    await testInfo.attach("clips-resume-authority", {
      body: JSON.stringify({
        progressReads,
        restoredPositionMs: 7_000,
        staleResponseDelivered: delivered,
      }),
      contentType: "application/json",
    });
  } finally {
    release();
    fixture("cleanup", { fixtureId: catalog.fixtureId });
  }
});
