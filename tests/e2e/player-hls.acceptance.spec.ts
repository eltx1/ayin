import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page, type Route } from "@playwright/test";
import type { PublicCreatorTvResponse } from "../../apps/web/src/lib/creator-tv";

const DB_HELPER = path.resolve(process.cwd(), "tests/e2e/db-helper.mjs");

type VideoFixture = { id: string; slug: string; channelId: string; sourceKey: string };
type HlsFixture = { enabled: boolean; fallbackKey: string; masterKey: string };
type HarnessState = {
  playCalls: number;
  pauseCalls: number;
  hlsAttachCalls: number;
  hlsLoadCalls: number;
  imaStarted: number;
  imaCompleted: number;
  imaDestroyed: number;
  hlsDestroyed: number;
  imaTags: string[];
  imaMuted: boolean[];
};

function db<T>(command: string, payload: Record<string, unknown> = {}): T {
  const output = execFileSync(process.execPath, [DB_HELPER, command, JSON.stringify(payload)], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  return JSON.parse(output) as T;
}

async function installMediaHarness(
  page: Page,
  options: {
    hlsMode?: "ready" | "malformed" | "unsupported";
    nativeHls?: boolean;
    ima?: boolean;
    holdImaStart?: number;
    deferImaSdk?: boolean;
    errorImaStart?: number;
    holdImaAfterCompleteStart?: number;
  } = {},
) {
  const hlsMode = options.hlsMode ?? "ready";
  const nativeHls = options.nativeHls ?? false;
  const ima = options.ima ?? false;
  const holdImaStart = options.holdImaStart ?? 0;
  const deferImaSdk = options.deferImaSdk ?? false;
  const errorImaStart = options.errorImaStart ?? 0;
  const holdImaAfterCompleteStart = options.holdImaAfterCompleteStart ?? 0;
  await page.addInitScript(
    ({
      hlsMode: mode,
      nativeHls: native,
      ima: useIma,
      holdImaStart,
      deferImaSdk,
      errorImaStart,
      holdImaAfterCompleteStart,
    }) => {
      const state = {
        playCalls: 0,
        pauseCalls: 0,
        hlsAttachCalls: 0,
        hlsLoadCalls: 0,
        imaStarted: 0,
        imaCompleted: 0,
        imaDestroyed: 0,
        hlsDestroyed: 0,
        imaTags: [] as string[],
        imaMuted: [] as boolean[],
      };
      Object.defineProperty(window, "__ayinHarness", { value: state, configurable: true });

      type HarnessMedia = HTMLMediaElement & {
        __ayinPaused?: boolean;
        __ayinCurrentTime?: number;
      };
      Object.defineProperty(HTMLMediaElement.prototype, "paused", {
        configurable: true,
        get() {
          return (this as HarnessMedia).__ayinPaused ?? true;
        },
      });
      Object.defineProperty(HTMLMediaElement.prototype, "duration", {
        configurable: true,
        get() {
          return 120;
        },
      });
      Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
        configurable: true,
        get() {
          return (this as HarnessMedia).__ayinCurrentTime ?? 0;
        },
        set(value: number) {
          (this as HarnessMedia).__ayinCurrentTime = Number.isFinite(value) ? value : 0;
        },
      });
      const originalCanPlayType = HTMLMediaElement.prototype.canPlayType;
      HTMLMediaElement.prototype.canPlayType = function (type: string) {
        if (type.toLowerCase().includes("mpegurl")) return native ? "probably" : "";
        return originalCanPlayType.call(this, type);
      };
      if (native) {
        const nativeSources = new WeakMap<HTMLMediaElement, string>();
        Object.defineProperty(HTMLMediaElement.prototype, "src", {
          configurable: true,
          get() {
            return nativeSources.get(this) ?? "";
          },
          set(value: string) {
            nativeSources.set(this, value);
            (this as HTMLMediaElement).dataset.nativeHlsSource = value;
          },
        });
      }
      HTMLMediaElement.prototype.play = function () {
        state.playCalls += 1;
        (this as HarnessMedia).__ayinPaused = false;
        this.dispatchEvent(new Event("play"));
        this.dispatchEvent(new Event("playing"));
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function () {
        state.pauseCalls += 1;
        const wasPaused = (this as HarnessMedia).__ayinPaused ?? true;
        (this as HarnessMedia).__ayinPaused = true;
        if (!wasPaused) this.dispatchEvent(new Event("pause"));
      };
      HTMLMediaElement.prototype.load = function () {
        queueMicrotask(() => {
          if (this.getAttribute("src") || native) {
            this.dispatchEvent(new Event("loadedmetadata"));
            this.dispatchEvent(new Event("canplay"));
          }
        });
      };

      class FakeHls {
        static Events = {
          MEDIA_ATTACHED: "media-attached",
          MANIFEST_PARSED: "manifest-parsed",
          LEVEL_SWITCHED: "level-switched",
          FRAG_BUFFERED: "frag-buffered",
          ERROR: "error",
        };
        static isSupported() {
          return mode !== "unsupported";
        }

        levels = [
          { width: 640, height: 360, bitrate: 800_000 },
          { width: 1280, height: 720, bitrate: 3_000_000 },
        ];
        currentLevel = -1;
        nextLevel = -1;
        media: HTMLVideoElement | null = null;
        listeners = new Map<string, Array<(...args: unknown[]) => void>>();

        constructor() {
          Object.defineProperty(window, "__ayinHlsInstance", {
            value: this,
            configurable: true,
          });
        }

        on(event: string, callback: (...args: unknown[]) => void) {
          this.listeners.set(event, [...(this.listeners.get(event) ?? []), callback]);
        }
        emit(event: string, data?: unknown) {
          for (const callback of this.listeners.get(event) ?? []) callback(event, data);
        }
        attachMedia(video: HTMLVideoElement) {
          state.hlsAttachCalls += 1;
          this.media = video;
          queueMicrotask(() => this.emit(FakeHls.Events.MEDIA_ATTACHED));
        }
        loadSource(url: string) {
          state.hlsLoadCalls += 1;
          if (this.media) this.media.dataset.hlsSource = url;
          queueMicrotask(() => {
            if (mode === "malformed") {
              this.emit(FakeHls.Events.ERROR, {
                fatal: true,
                type: "networkError",
                details: "manifestLoadError",
              });
              return;
            }
            this.emit(FakeHls.Events.MANIFEST_PARSED);
            this.currentLevel = 0;
            this.emit(FakeHls.Events.LEVEL_SWITCHED, { level: 0 });
          });
        }
        startLoad() {}
        recoverMediaError() {}
        destroy() {
          state.hlsDestroyed += 1;
        }
      }

      Object.defineProperty(window, "Hls", { value: FakeHls, configurable: true });

      if (useIma) {
        const events = {
          loaded: "LOADED",
          impression: "IMPRESSION",
          started: "STARTED",
          first: "FIRST_QUARTILE",
          midpoint: "MIDPOINT",
          third: "THIRD_QUARTILE",
          complete: "COMPLETE",
          click: "CLICK",
          pause: "CONTENT_PAUSE_REQUESTED",
          resume: "CONTENT_RESUME_REQUESTED",
          managerLoaded: "ADS_MANAGER_LOADED",
          error: "AD_ERROR",
        };
        class AdDisplayContainer {
          initialize() {}
        }
        class AdsManager {
          listeners = new Map<string, Array<(event: unknown) => void>>();
          addEventListener(type: string, listener: (event: unknown) => void) {
            this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
          }
          emit(type: string) {
            for (const listener of this.listeners.get(type) ?? []) listener({});
          }
          init() {}
          start() {
            state.imaStarted += 1;
            this.emit(events.pause);
            this.emit(events.started);
            if (state.imaStarted === holdImaStart) return;
            queueMicrotask(() => {
              if (state.imaStarted === errorImaStart) {
                this.emit(events.error);
                return;
              }
              state.imaCompleted += 1;
              this.emit(events.complete);
              if (state.imaStarted === holdImaAfterCompleteStart) return;
              this.emit(events.resume);
            });
          }
          destroy() {
            state.imaDestroyed += 1;
          }
        }
        class AdsLoader {
          listeners = new Map<string, Array<(event: unknown) => void>>();
          addEventListener(type: string, listener: (event: unknown) => void) {
            this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
          }
          removeEventListener(type: string, listener: (event: unknown) => void) {
            this.listeners.set(
              type,
              (this.listeners.get(type) ?? []).filter((item) => item !== listener),
            );
          }
          requestAds(request: { adTagUrl: string; willPlayMuted: boolean }) {
            state.imaTags.push(request.adTagUrl);
            state.imaMuted.push(request.willPlayMuted);
            const manager = new AdsManager();
            queueMicrotask(() => {
              for (const listener of this.listeners.get(events.managerLoaded) ?? []) {
                listener({ getAdsManager: () => manager });
              }
            });
          }
          contentComplete() {}
          destroy() {}
        }
        class AdsRequest {
          adTagUrl = "";
          linearAdSlotWidth = 0;
          linearAdSlotHeight = 0;
          nonLinearAdSlotWidth = 0;
          nonLinearAdSlotHeight = 0;
          willPlayMuted = false;
          setAdWillAutoPlay() {}
          setAdWillPlayMuted(value: boolean) {
            this.willPlayMuted = value;
          }
        }
        Object.defineProperty(window, deferImaSdk ? "__ayinPendingGoogle" : "google", {
          configurable: true,
          value: {
            ima: {
              AdDisplayContainer,
              AdsLoader,
              AdsRequest,
              AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: events.managerLoaded } },
              AdErrorEvent: { Type: { AD_ERROR: events.error } },
              AdEvent: {
                Type: {
                  CONTENT_PAUSE_REQUESTED: events.pause,
                  CONTENT_RESUME_REQUESTED: events.resume,
                  LOADED: events.loaded,
                  IMPRESSION: events.impression,
                  STARTED: events.started,
                  FIRST_QUARTILE: events.first,
                  MIDPOINT: events.midpoint,
                  THIRD_QUARTILE: events.third,
                  COMPLETE: events.complete,
                  CLICK: events.click,
                },
              },
              ViewMode: { NORMAL: "normal" },
            },
          },
        });
      }
    },
    {
      hlsMode,
      nativeHls,
      ima,
      holdImaStart,
      deferImaSdk,
      errorImaStart,
      holdImaAfterCompleteStart,
    },
  );
}

async function harnessState(page: Page): Promise<HarnessState> {
  return page.evaluate(() => (window as unknown as { __ayinHarness: HarnessState }).__ayinHarness);
}

async function mockNoAds(page: Page, videoId: string) {
  await page.route(`**/ads/video/decision/${videoId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ enabled: false }),
    });
  });
}

async function mockPreroll(
  page: Page,
  fixture: VideoFixture,
  tagUrl = "https://ads.invalid/task-41",
  allBreaks = false,
) {
  await page.route(`**/ads/video/decision/${fixture.id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        provider: "GOOGLE_IMA",
        tagUrl,
        preRollEnabled: true,
        midRollEnabled: allBreaks,
        postRollEnabled: allBreaks,
        midRollEverySec: allBreaks ? 10 : 900,
        frequencyCapPerSession: 10,
        attribution: { videoId: fixture.id, channelId: fixture.channelId },
      }),
    });
  });
}

let fixture: VideoFixture;

test.describe.serial("Task 41 AYIN Player HLS acceptance", () => {
  test.beforeAll(() => {
    fixture = db<VideoFixture>("seed-player-video");
    db<HlsFixture>("configure-hls-playback", {
      enabled: true,
      videoId: fixture.id,
    });
  });

  test.afterAll(() => {
    db("configure-hls-playback", { enabled: false });
  });

  test("HLS available defaults to AUTO, exposes only available levels, autoplays and keeps keyboard controls", async ({
    page,
  }) => {
    await installMediaHarness(page);
    await mockNoAds(page, fixture.id);
    await page.goto(`/watch/${fixture.slug}`);

    const quality = page.getByLabel("Playback quality");
    await expect(quality).toBeVisible();
    await expect(quality.locator("option")).toHaveText(["Auto", "360p", "720p"]);
    await expect(quality).toHaveValue("AUTO");
    await expect.poll(async () => (await harnessState(page)).hlsLoadCalls).toBe(1);
    await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(0);

    await quality.selectOption("level-1");
    await expect(quality).toHaveValue("level-1");

    const player = page.getByRole("region", { name: "HLS Player E2E player", exact: true });
    await expect(player).toHaveCount(1);
    const stage = player.locator('[data-player-stage="true"]');
    await expect(stage).toHaveCount(1);
    await stage.focus();
    await page.keyboard.press("k");
    await expect.poll(async () => (await harnessState(page)).pauseCalls).toBeGreaterThan(0);
    await page.keyboard.press("k");
    await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(1);
  });

  test("HLS unavailable at the platform gate remains canonical MP4", async ({ page }) => {
    db("configure-hls-playback", { enabled: false });
    await installMediaHarness(page);
    await mockNoAds(page, fixture.id);
    await page.goto(`/watch/${fixture.slug}`);

    await expect(page.getByLabel("Playback quality")).toHaveCount(0);
    await expect.poll(async () => (await harnessState(page)).hlsAttachCalls).toBe(0);
    await expect(page.locator("video:visible")).toHaveAttribute("src", /canonical\.mp4$/);

    db<HlsFixture>("configure-hls-playback", {
      enabled: true,
      videoId: fixture.id,
    });
  });

  test("malformed HLS manifest falls back once to the generation canonical MP4", async ({
    page,
  }) => {
    await installMediaHarness(page, { hlsMode: "malformed" });
    await mockNoAds(page, fixture.id);
    await page.goto(`/watch/${fixture.slug}`);

    await expect(page.locator("video:visible")).toHaveAttribute("src", /fallback\.mp4$/);
    await expect.poll(async () => (await harnessState(page)).hlsLoadCalls).toBe(1);
    await page.waitForTimeout(150);
    expect((await harnessState(page)).hlsAttachCalls).toBe(1);
    await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(0);
  });

  test("native-HLS capability branch bypasses the JavaScript engine", async ({ page }) => {
    await installMediaHarness(page, { nativeHls: true });
    await mockNoAds(page, fixture.id);
    await page.goto(`/watch/${fixture.slug}`);

    await expect(page.locator("video:visible")).toHaveAttribute(
      "data-native-hls-source",
      /master\.m3u8$/,
    );
    await expect.poll(async () => (await harnessState(page)).hlsAttachCalls).toBe(0);
    await expect(page.getByLabel("Playback quality")).toHaveCount(0);
    await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(0);
  });

  test("Google IMA preroll completes on the same video element before HLS content resumes", async ({
    page,
  }) => {
    await installMediaHarness(page, { ima: true });
    await mockPreroll(page, fixture);
    await page.goto(`/watch/${fixture.slug}`);

    await expect.poll(async () => (await harnessState(page)).hlsLoadCalls).toBe(1);
    await expect.poll(async () => (await harnessState(page)).imaStarted).toBe(1);
    await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(0);
    await expect(page.locator("video:visible")).toHaveCount(1);
  });

  for (const breakMode of ["PRE_ROLL", "MID_ROLL", "POST_ROLL", "PAUSED_MID_ROLL"] as const) {
    test(`Watch focus during active ${breakMode} preserves content intent and destroys the old ad`, async ({
      page,
    }) => {
      const holdImaStart = breakMode === "PRE_ROLL" ? 1 : 2;
      await installMediaHarness(page, { ima: true, holdImaStart });
      await mockPreroll(page, fixture, "https://ads.invalid/held-lifecycle", true);
      await page.goto(`/watch/${fixture.slug}`);
      await expect.poll(async () => (await harnessState(page)).imaStarted).toBe(1);
      if (breakMode !== "PRE_ROLL") {
        await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(0);
        await page.locator("video:visible").evaluate((video: HTMLVideoElement, mode) => {
          if (mode === "PAUSED_MID_ROLL") video.pause();
          if (mode === "POST_ROLL") {
            video.pause();
            Object.defineProperty(video, "ended", { configurable: true, value: true });
            video.currentTime = 120;
            video.dispatchEvent(new Event("ended"));
          } else {
            video.currentTime = 15;
            video.dispatchEvent(new Event("timeupdate"));
          }
        }, breakMode);
        await expect.poll(async () => (await harnessState(page)).imaStarted).toBe(2);
      }
      const shouldPlay = breakMode === "PRE_ROLL" || breakMode === "MID_ROLL";
      await expect(page.locator("video:visible")).toHaveAttribute(
        "data-ayin-ad-content-intent",
        shouldPlay ? "playing" : "paused",
      );
      const before = await harnessState(page);
      const revoked = await page.locator("video:visible").evaluate((video: HTMLVideoElement) => {
        // The harness controls decoder readiness; use real metadata readiness
        // semantics so the previous native-paused-only snapshot would fail.
        Object.defineProperty(video, "readyState", { configurable: true, value: 4 });
        const root = video.closest<HTMLElement>("[data-private-viewer-state]")!;
        window.dispatchEvent(new Event("blur"));
        return {
          hidden: !root.checkVisibility(),
          paused: video.paused,
          source: video.getAttribute("src"),
          adIntent: video.dataset.ayinAdContentIntent,
        };
      });
      expect(revoked).toEqual({ hidden: true, paused: true, source: null, adIntent: undefined });
      const stopped = await harnessState(page);
      expect(stopped.imaDestroyed).toBeGreaterThan(before.imaDestroyed);
      expect(stopped.hlsDestroyed).toBeGreaterThan(before.hlsDestroyed);
      expect(stopped.playCalls).toBe(before.playCalls);
      await expect(page.locator("video:visible")).toHaveCount(0);
      // A fresh decision has no ad. The recovered content intent alone controls
      // resumption; no previous manager, source or policy decision is reused.
      await mockNoAds(page, fixture.id);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.locator("video:visible")).toHaveCount(1);
      await expect
        .poll(async () => (await harnessState(page)).hlsLoadCalls)
        .toBeGreaterThan(before.hlsLoadCalls);
      if (shouldPlay)
        await expect
          .poll(async () => (await harnessState(page)).playCalls)
          .toBeGreaterThan(before.playCalls);
      else {
        await page.waitForTimeout(150);
        expect((await harnessState(page)).playCalls).toBe(before.playCalls);
        await expect
          .poll(() =>
            page.locator("video:visible").evaluate((video: HTMLVideoElement) => video.paused),
          )
          .toBe(true);
      }
      expect((await harnessState(page)).imaStarted).toBe(holdImaStart);
    });
  }

  test("Watch revokes pending IMA initialization without losing requested content playback", async ({
    page,
  }) => {
    await installMediaHarness(page, { ima: true, deferImaSdk: true });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sdkUrl = "https://imasdk.googleapis.com/js/sdkloader/ima3.js";
    await page.route(sdkUrl, async (route) => {
      await held;
      await route.fulfill({
        contentType: "application/javascript",
        body: "/* controlled IMA lifecycle fixture */",
      });
    });
    try {
      await mockPreroll(page, fixture);
      await page.goto(`/watch/${fixture.slug}`, { waitUntil: "domcontentloaded" });
      await expect(page.locator(`script[src="${sdkUrl}"]`)).toHaveCount(1);
      await expect(page.locator("video:visible")).toHaveAttribute(
        "data-ayin-ad-content-intent",
        "playing",
      );
      const revoked = await page.locator("video:visible").evaluate((video: HTMLVideoElement) => {
        Object.defineProperty(video, "readyState", { configurable: true, value: 4 });
        const root = video.closest<HTMLElement>("[data-private-viewer-state]")!;
        window.dispatchEvent(new Event("blur"));
        return {
          hidden: !root.checkVisibility(),
          source: video.getAttribute("src"),
          intent: video.dataset.ayinAdContentIntent,
        };
      });
      expect(revoked).toEqual({ hidden: true, source: null, intent: undefined });
      await page.evaluate(() =>
        Object.defineProperty(window, "google", {
          configurable: true,
          value: (window as unknown as { __ayinPendingGoogle: unknown }).__ayinPendingGoogle,
        }),
      );
      const settled = page.waitForResponse(sdkUrl);
      release();
      await settled;
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
      expect((await harnessState(page)).imaStarted).toBe(0);
      expect((await harnessState(page)).playCalls).toBe(0);
      await expect(page.locator("video:visible")).toHaveCount(0);
      await mockNoAds(page, fixture.id);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(0);
      expect((await harnessState(page)).imaStarted).toBe(0);
    } finally {
      release();
    }
  });

  test("Watch preserves restored unmuted intent when a failed preroll remains eligible", async ({
    page,
  }) => {
    await installMediaHarness(page, { ima: true, errorImaStart: 1 });
    await mockPreroll(page, fixture);
    await page.goto(`/watch/${fixture.slug}`);
    await expect.poll(async () => (await harnessState(page)).imaStarted).toBe(1);
    await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(0);
    expect((await harnessState(page)).imaMuted).toEqual([true]);
    await expect
      .poll(() => page.locator("video:visible").evaluate((video: HTMLVideoElement) => video.muted))
      .toBe(true);
    await page.locator('[data-player-stage="true"]:visible').focus();
    await page.keyboard.press("m");
    await expect
      .poll(() => page.locator("video:visible").evaluate((video: HTMLVideoElement) => video.muted))
      .toBe(false);
    const priorPlayCalls = (await harnessState(page)).playCalls;
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    await expect.poll(async () => (await harnessState(page)).imaStarted).toBe(2);
    await expect
      .poll(async () => (await harnessState(page)).playCalls)
      .toBeGreaterThan(priorPlayCalls);
    expect((await harnessState(page)).imaMuted).toEqual([true, false]);
    await expect
      .poll(() => page.locator("video:visible").evaluate((video: HTMLVideoElement) => video.muted))
      .toBe(false);
  });

  test("Watch does not request completed preroll or midroll again after current-viewer revalidation", async ({
    page,
  }) => {
    await installMediaHarness(page, { ima: true });
    await mockPreroll(page, fixture, "https://ads.invalid/completed-breaks", true);
    let decisions = 0;
    page.on("request", (request) => {
      if (request.url().endsWith(`/ads/video/decision/${fixture.id}`)) decisions++;
    });
    await page.goto(`/watch/${fixture.slug}`);
    await expect.poll(async () => (await harnessState(page)).imaStarted).toBe(1);
    await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(0);
    await page.locator("video:visible").evaluate((video: HTMLVideoElement) => {
      video.currentTime = 15;
      video.dispatchEvent(new Event("timeupdate"));
    });
    await expect.poll(async () => (await harnessState(page)).imaStarted).toBe(2);
    await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(1);
    const before = await harnessState(page);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    await expect.poll(() => decisions).toBe(2);
    await expect
      .poll(async () => (await harnessState(page)).playCalls)
      .toBeGreaterThan(before.playCalls);
    await page.locator("video:visible").evaluate((video: HTMLVideoElement) => {
      video.currentTime = 16;
      video.dispatchEvent(new Event("timeupdate"));
    });
    await page.waitForTimeout(150);
    expect((await harnessState(page)).imaStarted).toBe(2);
    expect((await harnessState(page)).imaTags).toHaveLength(2);
  });

  test("an interrupted IMA pod does not retain a completed break after one individual ad completes", async ({
    page,
  }) => {
    await installMediaHarness(page, { ima: true, holdImaAfterCompleteStart: 1 });
    await mockPreroll(page, fixture);
    await page.goto(`/watch/${fixture.slug}`);
    await expect.poll(async () => (await harnessState(page)).imaCompleted).toBe(1);
    expect((await harnessState(page)).playCalls).toBe(0);
    await expect(page.locator("video:visible")).toHaveAttribute(
      "data-ayin-ad-content-intent",
      "playing",
    );
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    await expect.poll(async () => (await harnessState(page)).imaStarted).toBe(2);
    await expect.poll(async () => (await harnessState(page)).imaCompleted).toBe(2);
    await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(0);
  });

  test("IMA receives the restrictive tag intact and resumes content under the safe consent default", async ({
    page,
  }) => {
    await installMediaHarness(page, { ima: true });
    await mockPreroll(
      page,
      fixture,
      "https://securepubads.g.doubleclick.net/gampad/ads?iu=%2F123%2Fvideo&npa=1&tfua=1&tfcd=1&rdp=1&tfat=2",
    );
    await page.goto(`/watch/${fixture.slug}`);
    await expect.poll(async () => (await harnessState(page)).imaStarted).toBe(1);
    const state = await harnessState(page);
    expect(state.imaTags).toHaveLength(1);
    const tag = new URL(state.imaTags[0]!);
    for (const key of ["ltd", "npa", "tfua", "tfcd", "rdp"])
      expect(tag.searchParams.get(key)).toBe("1");
    expect(tag.searchParams.get("tfat")).toBe("1");
    expect(tag.searchParams.get("iu")).toBe("/123/video");
    await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(0);
    await expect(page.locator("video:visible")).toHaveCount(1);
  });

  for (const tfat of ["1", "2"] as const) {
    test(`IMA preserves current TFAT=${tfat} and content playback under the limited default`, async ({
      page,
    }) => {
      await installMediaHarness(page, { ima: true });
      await mockPreroll(
        page,
        fixture,
        `https://securepubads.g.doubleclick.net/gampad/ads?iu=%2F123%2Fvideo&tfat=${tfat}`,
      );
      await page.goto(`/watch/${fixture.slug}`);
      await expect.poll(async () => (await harnessState(page)).imaStarted).toBe(1);
      const state = await harnessState(page);
      expect(state.imaTags).toHaveLength(1);
      const tag = new URL(state.imaTags[0]!);
      expect(tag.searchParams.get("tfat")).toBe(tfat);
      expect(tag.searchParams.get("npa")).toBe("1");
      expect(tag.searchParams.get("ltd")).toBe("1");
      await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(0);
      await expect(page.locator("video:visible")).toHaveCount(1);
    });
  }

  test("Creator TV resets ad ownership for new programs while same-video URL refresh keeps position", async ({
    page,
  }) => {
    type TvFixture = {
      fixtureId: string;
      channelId: string;
      handle: string;
      videos: VideoFixture[];
    };
    const helper = path.resolve(process.cwd(), "tests/e2e/ad-lifecycle-fixture.mjs");
    const seed = (command: string, payload = {}) =>
      JSON.parse(
        execFileSync(process.execPath, [helper, command, JSON.stringify(payload)], {
          cwd: process.cwd(),
          env: process.env,
          encoding: "utf8",
        }),
      );
    const tv = seed("seed") as TvFixture;
    try {
      const response = await page.request.get(
        `http://127.0.0.1:3001/public/channels/${tv.handle}/tv`,
      );
      expect(response.ok()).toBe(true);
      const initial = (await response.json()) as PublicCreatorTvResponse;
      expect(initial.schedule.nowPlaying).not.toBeNull();
      const first = initial.schedule.nowPlaying!;
      const second = initial.schedule.guide.find((item) => item.video.id !== first.video.id)!;
      expect(second).toBeTruthy();
      await installMediaHarness(page, { ima: true });
      const events: Array<{ videoId: string; slot: string; eventType: string }> = [];
      await page.route("**/ads/video/events", async (route) => {
        events.push(route.request().postDataJSON());
        await route.fulfill({ json: { accepted: true } });
      });
      for (const video of tv.videos)
        await mockPreroll(page, video, "https://ads.invalid/lifecycle", true);
      await page.goto(`/c/${tv.handle}/tv`);
      await expect.poll(async () => (await harnessState(page)).imaStarted).toBe(1);
      await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(0);
      const video = page.locator("main video");
      await video.evaluate((element: HTMLVideoElement) => {
        element.currentTime = 15;
        element.dispatchEvent(new Event("timeupdate"));
      });
      await expect.poll(async () => (await harnessState(page)).imaStarted).toBe(2);
      await expect
        .poll(() => events.filter((event) => event.eventType === "COMPLETE").length)
        .toBe(2);

      // A refreshed URL is still the same logical video. It must not remount
      // progress/media state, replay preroll, or replay its already-used midroll.
      let nextData = structuredClone(initial);
      nextData.schedule.nowPlaying!.video.source.objectKey = first.video.source.objectKey.replace(
        ".mp4",
        "-refreshed.mp4",
      );
      await page.route(`**/public/channels/${tv.handle}/tv`, (route) =>
        route.fulfill({ json: nextData }),
      );
      await video.evaluate((element: HTMLVideoElement) => {
        element.dataset.originalMedia = "yes";
        element.currentTime = 45;
      });
      await page.getByRole("button", { name: /^Next:/ }).focus();
      await page.getByRole("button", { name: /^Next:/ }).press("Enter");
      await expect(video).toHaveAttribute("src", /-refreshed\.mp4/);
      await expect(video).toHaveAttribute("data-original-media", "yes");
      expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBe(45);
      expect((await harnessState(page)).imaStarted).toBe(2);

      nextData = structuredClone(initial);
      nextData.schedule.nowPlaying = { ...second, playbackOffsetMs: 0 };
      await page.getByRole("button", { name: /^Next:/ }).focus();
      await page.getByRole("button", { name: /^Next:/ }).press("Enter");
      await expect(video).toHaveAttribute(
        "src",
        new RegExp(second.video.source.objectKey.replaceAll(".", "\\.")),
      );
      await expect(video).not.toHaveAttribute("data-original-media", "yes");
      await expect.poll(async () => (await harnessState(page)).imaStarted).toBe(3);
      await expect
        .poll(
          () =>
            events.filter(
              (event) => event.videoId === second.video.id && event.eventType === "COMPLETE",
            ).length,
        )
        .toBe(1);
      await video.evaluate((element: HTMLVideoElement) => {
        element.currentTime = 15;
        element.dispatchEvent(new Event("timeupdate"));
      });
      await expect.poll(async () => (await harnessState(page)).imaStarted).toBe(4);
      await expect
        .poll(
          () =>
            events.filter(
              (event) => event.videoId === second.video.id && event.eventType === "COMPLETE",
            ).length,
        )
        .toBe(2);
      await video.evaluate((element) => element.dispatchEvent(new Event("ended")));
      await expect.poll(async () => (await harnessState(page)).imaStarted).toBe(5);
      await expect
        .poll(
          () =>
            events.filter(
              (event) => event.videoId === second.video.id && event.eventType === "COMPLETE",
            ).length,
        )
        .toBe(3);
      expect(
        events
          .filter((event) => event.eventType === "START")
          .map((event) => [event.videoId, event.slot]),
      ).toEqual([
        [first.video.id, "PRE_ROLL"],
        [first.video.id, "MID_ROLL"],
        [second.video.id, "PRE_ROLL"],
        [second.video.id, "MID_ROLL"],
        [second.video.id, "POST_ROLL"],
      ]);
    } finally {
      await page.goto("about:blank").catch(() => undefined);
      seed("cleanup", tv);
    }
  });

  test("page placements redecide only on route or device category changes", async ({ page }) => {
    await installMediaHarness(page);
    await mockNoAds(page, fixture.id);
    const decisions: Array<{ route: string | null; device: string | null }> = [];
    const events: string[] = [];
    await page.route("**/ads/page/decision/**", async (route) => {
      const url = new URL(route.request().url());
      decisions.push({
        route: url.searchParams.get("route"),
        device: url.searchParams.get("device"),
      });
      await route.fulfill({
        json: {
          enabled: true,
          demand: {
            provider: "HOUSE",
            imageUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
            altText: "Synthetic house",
            clickUrl: null,
          },
          fallback: null,
        },
      });
    });
    await page.route("**/ads/page/events", async (route) => {
      events.push(route.request().postDataJSON().eventType);
      await route.fulfill({ json: {} });
    });
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(`/watch/${fixture.slug}`);
    await expect(page.getByRole("img", { name: "Synthetic house" })).toBeVisible();
    expect(decisions).toEqual([{ route: `/watch/${fixture.slug}`, device: "DESKTOP" }]);
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(decisions).toHaveLength(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => decisions.length).toBe(2);
    expect(decisions[1]!.device).toBe("MOBILE");
    // Next's supported native history API retains this tree and publishes a
    // new pathname; the placement must no longer use its previous route.
    await page.evaluate(() => window.history.pushState({}, "", "/watch/synthetic-retained-route"));
    await expect.poll(() => decisions.length).toBe(3);
    expect(decisions[2]).toEqual({ route: "/watch/synthetic-retained-route", device: "MOBILE" });
    await expect.poll(() => events.filter((event) => event === "IMPRESSION").length).toBe(3);
  });

  test("leaving while page REQUEST telemetry is pending cannot create a house impression", async ({
    page,
  }) => {
    await installMediaHarness(page);
    await mockNoAds(page, fixture.id);
    let requestRoute: Route | undefined;
    const events: string[] = [];
    await page.route("**/ads/page/decision/**", (route) =>
      route.fulfill({
        json:
          new URL(route.request().url()).searchParams.get("route") === `/watch/${fixture.slug}`
            ? {
                enabled: true,
                demand: {
                  provider: "HOUSE",
                  imageUrl: "https://media.invalid/synthetic-house.png",
                  altText: "Synthetic house",
                  clickUrl: null,
                },
                fallback: null,
              }
            : { enabled: false },
      }),
    );
    await page.route("**/ads/page/events", async (route) => {
      const type = route.request().postDataJSON().eventType;
      events.push(type);
      if (type === "REQUEST") requestRoute = route;
      else await route.fulfill({ json: {} });
    });
    await page.goto(`/watch/${fixture.slug}`);
    await expect.poll(() => Boolean(requestRoute)).toBe(true);
    await page.locator('a[href="/"]').first().click();
    await expect(page).toHaveURL(/\/$/);
    await requestRoute!.fulfill({ json: {} });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    expect(events).toEqual(["REQUEST"]);
    await expect(page.getByRole("img", { name: "Synthetic house" })).toHaveCount(0);
  });

  test("already-loaded GPT always receives a mounted host and is destroyed on device change and exit", async ({
    page,
  }) => {
    await installMediaHarness(page);
    await mockNoAds(page, fixture.id);
    await page.addInitScript(() => {
      const state = { displayed: 0, destroyed: 0, missingHost: false };
      Object.assign(window, { __ayinMountedGpt: state });
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          const marker = document.createElement("script");
          marker.type = "application/json";
          marker.src = "https://pagead2.googlesyndication.com/tag/js/gpt.js";
          document.head.append(marker);
          const pubads = {
            setPrivacySettings() {},
            addEventListener() {},
            removeEventListener() {},
          };
          Object.assign(window, {
            googletag: {
              cmd: {
                push(callback: () => void) {
                  callback();
                },
              },
              defineSlot() {
                return {
                  setConfig() {
                    return this;
                  },
                  addService() {
                    return this;
                  },
                };
              },
              pubads() {
                return pubads;
              },
              enableServices() {},
              display(id: string) {
                state.displayed++;
                state.missingHost ||= !document.getElementById(id);
              },
              destroySlots() {
                state.destroyed++;
              },
            },
          });
        },
        { once: true },
      );
    });
    await page.route("https://pagead2.googlesyndication.com/**", (route) => route.abort());
    await page.route("**/ads/page/events", (route) => route.fulfill({ json: {} }));
    await page.route("**/ads/page/decision/**", (route) =>
      route.fulfill({
        json:
          new URL(route.request().url()).searchParams.get("route") === `/watch/${fixture.slug}`
            ? {
                enabled: true,
                demand: { provider: "GOOGLE_GPT", adUnitPath: "/123/synthetic" },
                sizes: [[300, 250]],
                responsive: [],
                fallback: null,
              }
            : { enabled: false },
      }),
    );
    const state = () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __ayinMountedGpt: { displayed: number; destroyed: number; missingHost: boolean };
            }
          ).__ayinMountedGpt,
      );
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(`/watch/${fixture.slug}`);
    await page
      .locator("aside")
      .filter({ has: page.locator('[id^="ayin-ad-"]') })
      .scrollIntoViewIfNeeded();
    await expect.poll(async () => (await state()).displayed).toBe(1);
    expect((await state()).missingHost).toBe(false);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => (await state()).displayed).toBe(2);
    expect((await state()).destroyed).toBe(1);
    await page.locator('a[href="/"]').first().click();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(async () => (await state()).destroyed).toBe(2);
  });

  test("mobile preroll preserves the user-gesture gate with HLS", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await installMediaHarness(page, { ima: true });
    await mockPreroll(page, fixture);
    await page.goto(`/watch/${fixture.slug}`);

    const start = page.locator('button[aria-label="Play video"][data-tv-focusable="true"]');
    await expect(start).toBeVisible();
    await expect(start).toBeEnabled();
    expect((await harnessState(page)).imaStarted).toBe(0);
    await start.click();
    await expect.poll(async () => (await harnessState(page)).imaStarted).toBe(1);
    await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(0);
    await expect(page.locator("video:visible")).toHaveAttribute("playsinline", "");
    await context.close();
  });

  test("fatal HLS failure during playback resumes MP4 without a duplicate VIDEO_START", async ({
    page,
  }) => {
    const analyticsNames: string[] = [];
    await installMediaHarness(page);
    await mockNoAds(page, fixture.id);
    await page.route("**/analytics/events", async (route) => {
      const body = route.request().postDataJSON() as { events?: Array<{ eventName?: string }> };
      for (const event of body.events ?? []) {
        if (event.eventName) analyticsNames.push(event.eventName);
      }
      await route.fulfill({ status: 202, contentType: "application/json", body: "{}" });
    });
    await page.goto(`/watch/${fixture.slug}`);
    await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(0);

    await page.evaluate(() => {
      const hls = (
        window as unknown as {
          __ayinHlsInstance: { emit(event: string, data: unknown): void };
        }
      ).__ayinHlsInstance;
      hls.emit("error", { fatal: true, type: "otherError", details: "fatalDecodeFailure" });
    });

    await expect(page.locator("video:visible")).toHaveAttribute("src", /fallback\.mp4$/);
    await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(1);
    await page.waitForTimeout(3_300);

    expect(analyticsNames.filter((name) => name === "VIDEO_START")).toHaveLength(1);
    expect(analyticsNames.filter((name) => name === "VIDEO_HLS_FATAL")).toHaveLength(1);
    expect(analyticsNames.filter((name) => name === "VIDEO_FALLBACK")).toHaveLength(1);
  });
});
