import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

interface Fixture {
  fixtureId: string;
  channelId: string;
  videoId: string;
  slug: string;
  title: string;
}

const media = path.resolve(process.cwd(), "tests/e2e/fixtures/clips-viewport.webm");
const fixtureScript = path.resolve(process.cwd(), "tests/e2e/player-localization-fixture.mjs");
let fixture: Fixture;
let hlsDirectory: string;
let hlsState: { previousFlag: unknown } | undefined;

function fixtureCommand<T>(command: string, input: object = {}): T {
  return JSON.parse(
    execFileSync(process.execPath, [fixtureScript, command, JSON.stringify(input)], {
      env: process.env,
      encoding: "utf8",
    }),
  ) as T;
}

const copy = {
  en: {
    play: "Play",
    pause: "Pause",
    seek: "Seek video",
    speed: "Playback speed",
    captions: "Captions and subtitles",
    unmute: "Tap to unmute",
    fullscreen: "Fullscreen",
    quality: "Playback quality",
    auto: "Auto",
    error: "AYIN could not play this MP4 source.",
    tap: "Tap to play",
  },
  ar: {
    play: "تشغيل",
    pause: "إيقاف مؤقت",
    seek: "الانتقال داخل الفيديو",
    speed: "سرعة التشغيل",
    captions: "التسميات التوضيحية والترجمة",
    unmute: "اضغط لتفعيل الصوت",
    fullscreen: "ملء الشاشة",
    quality: "جودة التشغيل",
    auto: "تلقائي",
    error: "تعذّر على AYIN تشغيل ملف MP4 هذا.",
    tap: "اضغط للتشغيل",
  },
} as const;

const captionFixtures = [
  { language: "en", label: "Original English", text: "The sea story · Original captions" },
  { language: "ar", label: "العربية الأصلية", text: "حكاية البحر · ترجمة أصلية" },
  { language: "ja", label: "日本語", text: "海の記憶 · 日本語の字幕" },
] as const;

// These tests use actual native decoding and hls.js. Only synthetic media bytes
// and the no-ad decision are supplied locally; no media methods are replaced.
async function installMedia(
  page: Page,
  failSource = false,
  failHls = false,
  codec: "vp9" | "avc" = "vp9",
) {
  const observed = { hlsRequests: 0 };
  await page.route("**/ads/video/decision/**", (route) =>
    route.fulfill({ json: { enabled: false, reason: "TEST_NO_ADS" } }),
  );
  await page.route(`**/e2e/player-locale/${fixture.fixtureId}/**`, async (route) => {
    const filename = path.basename(new URL(route.request().url()).pathname);
    const headers = { "access-control-allow-origin": "*", "accept-ranges": "bytes" };
    if (filename.endsWith(".vtt")) {
      const caption = captionFixtures.find((item) => filename === `${item.language}.vtt`)!;
      return route.fulfill({
        contentType: "text/vtt",
        headers,
        body: `WEBVTT\n\n00:00.000 --> 00:30.000 line:90% position:50% align:center\n${caption.text}\n`,
      });
    }
    if (
      filename.endsWith(".m3u8") ||
      filename.endsWith(".ts") ||
      filename.endsWith(".m4s") ||
      filename.endsWith("-init.mp4")
    ) {
      observed.hlsRequests += 1;
      const file = filename === "master.m3u8" ? `${codec}-master.m3u8` : filename;
      if (failHls || !readdirSync(hlsDirectory).includes(file)) return route.abort();
      return route.fulfill({
        contentType: filename.endsWith(".m3u8")
          ? "application/vnd.apple.mpegurl"
          : filename.endsWith(".ts")
            ? "video/mp2t"
            : "video/mp4",
        headers,
        body: readFileSync(path.join(hlsDirectory, file)),
      });
    }
    if (failSource) return route.abort();
    const bytes = readFileSync(media);
    const range = route
      .request()
      .headers()
      .range?.match(/^bytes=(\d+)-(\d*)$/);
    if (!range) return route.fulfill({ contentType: "video/webm", headers, body: bytes });
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    if (start > end)
      return route.fulfill({
        status: 416,
        headers: { ...headers, "content-range": `bytes */${bytes.length}` },
      });
    return route.fulfill({
      status: 206,
      contentType: "video/webm",
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${bytes.length}` },
      body: bytes.subarray(start, end + 1),
    });
  });
  return observed;
}

async function visit(page: Page, locale: "en" | "ar") {
  await page.goto(`${locale === "ar" ? "/ar" : ""}/watch/${fixture.slug}`);
  await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  await expect(page.locator("[data-player-stage] video")).toHaveCount(1);
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  const screenshotPath = info.outputPath(name);
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" });
  await info.attach(name, { path: screenshotPath, contentType: "image/png" });
  const nativeState = await page
    .locator("[data-player-stage] video")
    .evaluate((node: HTMLVideoElement) => ({
      locale: document.documentElement.lang,
      direction: document.documentElement.dir,
      viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
      paused: node.paused,
      currentTime: node.currentTime,
      duration: node.duration,
      readyState: node.readyState,
      decodedFrames: node.getVideoPlaybackQuality().totalVideoFrames,
      videoWidth: node.videoWidth,
      videoHeight: node.videoHeight,
      playbackRate: node.playbackRate,
      mediaOwner: node.dataset.localeOwner ?? null,
      nativeError: node.error?.code ?? null,
      tracks: Array.from(node.textTracks).map((track) => ({
        language: track.language,
        mode: track.mode,
        cues: track.cues?.length ?? 0,
        activeCues: Array.from(track.activeCues ?? []).map((item) => {
          const cue = item as VTTCue;
          return {
            text: cue.text,
            start: cue.startTime,
            end: cue.endTime,
            line: cue.line,
            position: cue.position,
            align: cue.align,
          };
        }),
      })),
    }));
  await info.attach(name.replace(/\.png$/, "-native.json"), {
    body: Buffer.from(JSON.stringify(nativeState, null, 2)),
    contentType: "application/json",
  });
}

function playerError(page: Page) {
  // Next's route announcer has its own alert role outside the player.
  return page.locator("[data-player-stage]").locator("..").getByRole("alert");
}

async function verifyCueContrast(page: Page, info: TestInfo, locale: string) {
  const palette = await page.locator("[data-player-stage] video").evaluate((node) => {
    // ::cue has no reliable getComputedStyle pseudo-element API. Inspect the
    // matching native cue CSS rule, then check its worst-case video contrast.
    const result = { color: "", background: "" };
    for (const sheet of document.styleSheets) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules) {
        if (!(rule instanceof CSSStyleRule)) continue;
        const matches = rule.selectorText.split(",").some((selector) => {
          const value = selector.trim();
          return value.endsWith("::cue") && node.matches(value.slice(0, -5));
        });
        if (matches) {
          if (rule.style.color) result.color = rule.style.color;
          if (rule.style.backgroundColor) result.background = rule.style.backgroundColor;
        }
      }
    }
    return result.color && result.background ? result : null;
  });
  expect(palette).not.toBeNull();
  const parse = (color: string) => (color.match(/[\d.]+/g) ?? []).map(Number);
  const foreground = parse(palette!.color);
  const background = parse(palette!.background);
  expect(foreground).toHaveLength(3);
  expect(background).toHaveLength(4);
  const alpha = background[3]!;
  const worstBackground = background.slice(0, 3).map((value) => value * alpha + 255 * (1 - alpha));
  const luminance = (rgb: number[]) =>
    rgb
      .map((value) => {
        const component = value / 255;
        return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
  const ratio = (luminance(foreground) + 0.05) / (luminance(worstBackground) + 0.05);
  expect(ratio).toBeGreaterThanOrEqual(4.5);
  await info.attach(`player-${locale}-cue-contrast.json`, {
    body: Buffer.from(
      JSON.stringify({ ...palette, worstCaseVideo: "white", contrastRatio: ratio }, null, 2),
    ),
    contentType: "application/json",
  });
}

async function verifyQualityControls(
  page: Page,
  locale: "en" | "ar",
  info: TestInfo,
  codec: "vp9" | "avc" = "vp9",
) {
  const quality = page.getByLabel(copy[locale].quality, { exact: true });
  await expect(quality).toBeVisible();
  await expect(quality.locator('option[value="AUTO"]')).toHaveText(copy[locale].auto);
  const video = page.locator("[data-player-stage] video");
  await expect
    .poll(() =>
      video.evaluate((node: HTMLVideoElement) => node.getVideoPlaybackQuality().totalVideoFrames),
    )
    .toBeGreaterThan(0);
  await expect(quality).toBeVisible();
  await video.evaluate((node: HTMLVideoElement) => {
    node.dataset.localeOwner = "original";
    node.pause();
    node.currentTime = 12;
  });
  await quality.selectOption({ label: "320p" });
  await expect(quality).toHaveValue("level-1");
  await expect(video).toHaveAttribute("data-locale-owner", "original");
  await expect
    .poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime))
    .toBeCloseTo(12, 1);
  await video.evaluate((node: HTMLVideoElement) => node.play());
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.videoHeight)).toBe(320);
  const switchedTime = await video.evaluate((node: HTMLVideoElement) => {
    node.pause();
    return node.currentTime;
  });
  expect(switchedTime).toBeGreaterThanOrEqual(12);
  expect(switchedTime).toBeLessThan(16);
  await quality.selectOption("AUTO");
  await expect(quality).toHaveValue("AUTO");
  await quality.focus();
  await screenshot(page, info, `player-${locale}-${codec}-hls-quality.png`);
}

test.use({ serviceWorkers: "block", contextOptions: { reducedMotion: "reduce" } });
test.describe.serial("EN/AR decoded player controls", () => {
  test.beforeAll(() => {
    fixture = fixtureCommand<Fixture>("seed");
    hlsDirectory = mkdtempSync(path.join(os.tmpdir(), "ayin-player-locale-hls-"));
    for (const height of [160, 320]) {
      execFileSync("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        media,
        "-vf",
        `scale=${height * 0.6}:${height}`,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "48",
        "-an",
        "-hls_time",
        "4",
        "-hls_list_size",
        "0",
        "-hls_segment_filename",
        `${hlsDirectory}/${height}p-%03d.ts`,
        `${hlsDirectory}/${height}p.m3u8`,
      ]);
      execFileSync("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        media,
        "-vf",
        `scale=${height * 0.6}:${height}`,
        "-c:v",
        "libvpx-vp9",
        "-deadline",
        "realtime",
        "-cpu-used",
        "8",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "40",
        "-an",
        "-hls_time",
        "4",
        "-hls_list_size",
        "0",
        "-hls_segment_type",
        "fmp4",
        "-hls_fmp4_init_filename",
        `${height}p-vp9-init.mp4`,
        "-hls_segment_filename",
        `${hlsDirectory}/${height}p-vp9-%03d.m4s`,
        `${hlsDirectory}/${height}p-vp9.m3u8`,
      ]);
    }
    writeFileSync(
      path.join(hlsDirectory, "vp9-master.m3u8"),
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=160000,RESOLUTION=96x160,CODECS="vp09.00.10.08"\n160p-vp9.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=320000,RESOLUTION=192x320,CODECS="vp09.00.10.08"\n320p-vp9.m3u8\n',
    );
    writeFileSync(
      path.join(hlsDirectory, "avc-master.m3u8"),
      "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=160000,RESOLUTION=96x160\n160p.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=320000,RESOLUTION=192x320\n320p.m3u8\n",
    );
  });

  test.afterAll(() => {
    if (fixture) fixtureCommand("cleanup", { ...fixture, ...hlsState });
    if (hlsDirectory) rmSync(hlsDirectory, { recursive: true, force: true });
  });

  for (const locale of ["en", "ar"] as const) {
    for (const width of [390, 1440]) {
      test(`${locale} ${width}: native frames, keyboard, captions, speed and unclipped controls`, async ({
        page,
      }, info) => {
        await page.setViewportSize({ width, height: width > 720 ? 1100 : 900 });
        await installMedia(page);
        await visit(page, locale);
        expect(
          await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
        ).toBe(true);
        const text = copy[locale];
        const video = page.locator("[data-player-stage] video");
        const stage = page.locator("[data-player-stage]");
        await expect
          .poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState))
          .toBeGreaterThanOrEqual(2);
        await expect
          .poll(() => video.evaluate((node: HTMLVideoElement) => node.paused))
          .toBe(false);
        await video.evaluate((node: HTMLVideoElement) => node.pause());
        await page
          .getByRole("button", {
            name: locale === "ar" ? "تشغيل الفيديو" : "Play video",
            exact: true,
          })
          .click();
        await stage.focus();
        await expect
          .poll(() =>
            video.evaluate(
              (node: HTMLVideoElement) => node.getVideoPlaybackQuality().totalVideoFrames,
            ),
          )
          .toBeGreaterThan(0);
        await expect(page.getByRole("button", { name: text.pause, exact: true })).toBeVisible();
        await page.keyboard.press("k");
        await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
        await video.evaluate((node: HTMLVideoElement) => {
          node.currentTime = 20;
        });
        await expect
          .poll(() => video.evaluate((node: HTMLVideoElement) => node.seeking))
          .toBe(false);
        await page.keyboard.press("j");
        await expect
          .poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime))
          .toBeCloseTo(10, 1);
        await page.keyboard.press("l");
        await expect
          .poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime))
          .toBeCloseTo(20, 1);
        await page.getByLabel(text.speed, { exact: true }).selectOption("1.25");
        expect(await video.evaluate((node: HTMLVideoElement) => node.playbackRate)).toBe(1.25);
        await page.getByLabel(text.speed, { exact: true }).focus();
        await page.keyboard.press("ArrowDown");
        await expect(page.getByLabel(text.speed, { exact: true })).toBeFocused();
        expect(await video.evaluate((node: HTMLVideoElement) => node.playbackRate)).toBe(1.5);
        await page.keyboard.press("ArrowUp");
        expect(await video.evaluate((node: HTMLVideoElement) => node.playbackRate)).toBe(1.25);
        await page
          .getByLabel(text.captions, { exact: true })
          .selectOption({ label: "العربية الأصلية" });
        await expect
          .poll(() => video.evaluate((node: HTMLVideoElement) => node.textTracks[0]?.mode))
          .toBe("showing");
        await expect
          .poll(() =>
            video.evaluate((node: HTMLVideoElement) => node.textTracks[0]?.cues?.length ?? 0),
          )
          .toBeGreaterThan(0);
        await stage.focus();
        await page.keyboard.press("c");
        await expect
          .poll(() => video.evaluate((node: HTMLVideoElement) => node.textTracks[0]?.mode))
          .toBe("disabled");
        await page.keyboard.press("c");
        await expect
          .poll(() => video.evaluate((node: HTMLVideoElement) => node.textTracks[0]?.mode))
          .toBe("showing");
        if (width > 720) {
          const chapters = page.getByLabel(locale === "ar" ? "الفصول" : "Chapters", {
            exact: true,
          });
          await chapters.selectOption("15000");
          await expect
            .poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime))
            .toBeCloseTo(15, 1);
          await chapters.focus();
          await page.keyboard.press("ArrowUp");
          await expect(chapters).toBeFocused();
          await expect
            .poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime))
            .toBe(0);
          await video.evaluate((node: HTMLVideoElement) => {
            node.currentTime = 20;
          });
        }
        const seek = page.getByLabel(text.seek, { exact: true });
        await seek.focus();
        await page.keyboard.press("ArrowLeft");
        await expect(seek).toBeFocused();
        expect(await video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeLessThan(20);
        await stage.focus();
        await page.keyboard.press("m");
        const muted = await video.evaluate((node: HTMLVideoElement) => node.muted);
        if (!muted) await page.keyboard.press("m");
        await page.keyboard.press("k");
        await expect(page.getByRole("button", { name: text.unmute, exact: true })).toBeVisible();
        await page.getByRole("button", { name: text.unmute, exact: true }).click();
        expect(await video.evaluate((node: HTMLVideoElement) => node.muted)).toBe(false);
        await stage.focus();
        await page.keyboard.press("k");
        const fullscreen = page.getByRole("button", { name: text.fullscreen, exact: true });
        await fullscreen.focus();
        await expect(fullscreen).toBeFocused();
        await fullscreen.press("Enter");
        await expect
          .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
          .toBe(true);
        await stage.focus();
        await page.keyboard.press("f");
        await expect
          .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
          .toBe(false);
        await fullscreen.focus();
        const bounds = await fullscreen.boundingBox();
        expect(bounds?.x).toBeGreaterThanOrEqual(0);
        expect((bounds?.x ?? width) + (bounds?.width ?? 1)).toBeLessThanOrEqual(width);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await expect(page.locator('[data-player-stage] strong[dir="auto"]')).toHaveText(
          fixture.title,
        );
        if (width > 720) {
          await verifyCueContrast(page, info, locale);
          for (const caption of captionFixtures) {
            const captions = page.getByLabel(text.captions, { exact: true });
            await captions.selectOption({ label: caption.label });
            await captions.focus();
            await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
            await expect
              .poll(() =>
                video.evaluate((node: HTMLVideoElement, language) => {
                  const track = Array.from(node.textTracks).find(
                    (candidate) => candidate.language === language,
                  );
                  const cue = track?.activeCues?.[0] as VTTCue | undefined;
                  return cue
                    ? {
                        text: cue.text,
                        start: cue.startTime,
                        end: cue.endTime,
                        line: cue.line,
                        position: cue.position,
                        align: cue.align,
                        snapToLines: cue.snapToLines,
                      }
                    : null;
                }, caption.language),
              )
              .toEqual({
                text: caption.text,
                start: 0,
                end: 30,
                line: 90,
                position: 50,
                align: "center",
                snapToLines: false,
              });
            const mediaBounds = await video.boundingBox();
            const controlBounds = await page
              .getByLabel(locale === "ar" ? "عناصر التحكم في التشغيل" : "Playback controls", {
                exact: true,
              })
              .boundingBox();
            expect(controlBounds?.y).toBeGreaterThanOrEqual(
              (mediaBounds?.y ?? 0) + (mediaBounds?.height ?? 0),
            );
            expect(await video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
            expect(
              await video.evaluate((node: HTMLVideoElement) => {
                const bounds = node.getBoundingClientRect();
                return (
                  document.elementFromPoint(
                    bounds.left + bounds.width / 2,
                    bounds.top + bounds.height * 0.9,
                  ) === node
                );
              }),
            ).toBe(true);
            await screenshot(page, info, `player-${locale}-desktop-cue-${caption.language}.png`);
          }
          await page
            .getByLabel(text.captions, { exact: true })
            .selectOption({ label: "العربية الأصلية" });
          await fullscreen.focus();
        }
        await screenshot(page, info, `player-${locale}-${width}-decoded-keyboard.png`);
      });
    }

    test(`${locale}: fatal source banner has no covering autoplay CTA`, async ({ page }, info) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await installMedia(page, true);
      await visit(page, locale);
      await expect(playerError(page)).toHaveText(copy[locale].error);
      await expect(page.getByText(copy[locale].tap, { exact: true })).toHaveCount(0);
      await expect
        .poll(() =>
          page
            .locator("[data-player-stage] video")
            .evaluate((node: HTMLVideoElement) => Boolean(node.error)),
        )
        .toBe(true);
      const stageBounds = await page.locator("[data-player-stage]").boundingBox();
      const errorBounds = await playerError(page).boundingBox();
      expect(errorBounds?.y).toBeGreaterThanOrEqual(
        (stageBounds?.y ?? 0) + (stageBounds?.height ?? 0),
      );
      await screenshot(page, info, `player-${locale}-fatal-uncovered.png`);
      // A native reload of the same recovered source must clear the error gate
      // without replacing the media owner or leaving the gesture retry hidden.
      await installMedia(page);
      const video = page.locator("[data-player-stage] video");
      await video.evaluate((node: HTMLVideoElement) => {
        node.dataset.localeOwner = "recovered";
        node.load();
      });
      await expect(playerError(page)).toHaveCount(0);
      const retry = page.getByRole("button").filter({ hasText: copy[locale].tap });
      await expect(retry).toBeVisible();
      await retry.press("Enter");
      await expect(video).toHaveAttribute("data-locale-owner", "recovered");
      await expect
        .poll(() =>
          video.evaluate(
            (node: HTMLVideoElement) => node.getVideoPlaybackQuality().totalVideoFrames,
          ),
        )
        .toBeGreaterThan(0);
    });

    test(`${locale}: a simulated autoplay-policy rejection keeps the localized user gesture retry`, async ({
      page,
    }, info) => {
      // Only this case injects two explicit NotAllowedError rejections. The retry
      // delegates to the real browser play() and must decode the synthetic source.
      await page.addInitScript(() => {
        const nativePlay = HTMLMediaElement.prototype.play;
        let rejected = 0;
        HTMLMediaElement.prototype.play = function () {
          if (rejected++ < 2)
            return Promise.reject(new DOMException("Synthetic gesture policy", "NotAllowedError"));
          return nativePlay.call(this);
        };
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await installMedia(page);
      await visit(page, locale);
      const retry = page.getByRole("button").filter({ hasText: copy[locale].tap });
      await expect(retry).toBeVisible();
      await expect(retry).toBeEnabled();
      await expect(playerError(page)).toHaveCount(0);
      await retry.focus();
      const retryBounds = await retry.boundingBox();
      const stageBounds = await page.locator("[data-player-stage]").boundingBox();
      expect(retryBounds?.x).toBeGreaterThanOrEqual(stageBounds?.x ?? 0);
      expect((retryBounds?.x ?? 0) + (retryBounds?.width ?? 0)).toBeLessThanOrEqual(
        (stageBounds?.x ?? 0) + (stageBounds?.width ?? 0),
      );
      expect(retryBounds?.y).toBeGreaterThanOrEqual(stageBounds?.y ?? 0);
      expect((retryBounds?.y ?? 0) + (retryBounds?.height ?? 0)).toBeLessThanOrEqual(
        (stageBounds?.y ?? 0) + (stageBounds?.height ?? 0),
      );
      await retry.click({ trial: true });
      await screenshot(page, info, `player-${locale}-gesture-retry.png`);
      await retry.press("Enter");
      await expect(retry).toHaveCount(0);
      await expect
        .poll(() =>
          page
            .locator("[data-player-stage] video")
            .evaluate((node: HTMLVideoElement) => node.getVideoPlaybackQuality().totalVideoFrames),
        )
        .toBeGreaterThan(0);
    });
  }

  // Reauthored after source recovery: selected tracks alone do not establish
  // rendered captions. Require the expected active native cue after remount.
  for (const locale of ["en", "ar"] as const) {
    test(`${locale}: reauthorization restores presentation preferences and the active Japanese cue`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: 390, height: 900 });
      await installMedia(page, false, true);
      await visit(page, locale);
      const video = page.locator("[data-player-stage] video");
      await expect
        .poll(() =>
          video.evaluate(
            (node: HTMLVideoElement) => node.getVideoPlaybackQuality().totalVideoFrames,
          ),
        )
        .toBeGreaterThan(0);
      await video.evaluate((node: HTMLVideoElement) => {
        node.pause();
        node.currentTime = 5;
        node.volume = 0.23;
        node.muted = true;
        node.dataset.recoveryOwner = "original";
      });
      await page.getByLabel(copy[locale].speed, { exact: true }).selectOption("1.5");
      await page
        .getByLabel(copy[locale].captions, { exact: true })
        .selectOption({ label: "日本語" });
      const expectedCue = captionFixtures.find((caption) => caption.language === "ja")!.text;
      const activeCue = () =>
        video.evaluate((node: HTMLVideoElement) => {
          const track = Array.from(node.textTracks).find((item) => item.language === "ja");
          return {
            seeking: node.seeking,
            mode: track?.mode,
            text: Array.from(track?.activeCues ?? []).map((cue) => (cue as VTTCue).text),
          };
        });
      await expect
        .poll(activeCue)
        .toEqual({ seeking: false, mode: "showing", text: [expectedCue] });
      await page.evaluate(() => {
        window.dispatchEvent(new Event("blur"));
        window.dispatchEvent(new Event("focus"));
      });
      await expect(video).not.toHaveAttribute("data-recovery-owner", "original");
      await expect
        .poll(() =>
          video.evaluate((node: HTMLVideoElement) => ({
            position: node.currentTime,
            paused: node.paused,
            rate: node.playbackRate,
            volume: node.volume,
            muted: node.muted,
          })),
        )
        .toEqual({ position: 5, paused: true, rate: 1.5, volume: 0.23, muted: true });
      await expect(
        page.getByLabel(copy[locale].captions, { exact: true }).locator("option:checked"),
      ).toHaveText("日本語");
      await expect
        .poll(activeCue)
        .toEqual({ seeking: false, mode: "showing", text: [expectedCue] });
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await screenshot(page, info, `player-${locale}-reauthorized-preferences.png`);
    });
  }

  for (const locale of ["en", "ar"] as const) {
    for (const codec of ["vp9", "avc"] as const) {
      test(`${locale}: real ${codec} HLS quality choices preserve media ownership`, async ({
        page,
      }, info) => {
        const mime =
          codec === "avc" ? 'video/mp4; codecs="avc1.42c00a"' : 'video/mp4; codecs="vp09.00.10.08"';
        const supported = await page.evaluate((value) => MediaSource.isTypeSupported(value), mime);
        test.skip(
          !supported,
          `This browser has no ${codec} MediaSource decoder; ${codec} rendition switching is not certified.`,
        );
        if (!hlsState) hlsState = fixtureCommand("enable-hls", fixture);
        await page.setViewportSize({ width: 390, height: 844 });
        await installMedia(page, false, false, codec);
        await visit(page, locale);
        await verifyQualityControls(page, locale, info, codec);
      });
    }

    test(`${locale}: unavailable HLS falls back to decoded native source`, async ({ page }) => {
      if (!hlsState) hlsState = fixtureCommand("enable-hls", fixture);
      const observed = await installMedia(page, false, true);
      await visit(page, locale);
      const video = page.locator("[data-player-stage] video");
      await expect.poll(() => observed.hlsRequests).toBeGreaterThan(0);
      await expect(video).toHaveAttribute("src", /canonical\.mp4$/);
      await expect
        .poll(() =>
          video.evaluate(
            (node: HTMLVideoElement) => node.getVideoPlaybackQuality().totalVideoFrames,
          ),
        )
        .toBeGreaterThan(0);
      await expect(playerError(page)).toHaveCount(0);
      await expect(page.getByLabel(copy[locale].quality, { exact: true })).toHaveCount(0);
    });
  }
});
