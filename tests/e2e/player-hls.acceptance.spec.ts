import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const DB_HELPER = path.resolve(process.cwd(), "tests/e2e/db-helper.mjs");

type VideoFixture = { id: string; slug: string; channelId: string; sourceKey: string };
type HlsFixture = { enabled: boolean; fallbackKey: string; masterKey: string };
type HarnessState = {
  playCalls: number;
  pauseCalls: number;
  hlsAttachCalls: number;
  hlsLoadCalls: number;
  imaStarted: number;
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
  options: { hlsMode?: "ready" | "malformed" | "unsupported"; nativeHls?: boolean; ima?: boolean } = {},
) {
  const hlsMode = options.hlsMode ?? "ready";
  const nativeHls = options.nativeHls ?? false;
  const ima = options.ima ?? false;
  await page.addInitScript(
    ({ hlsMode: mode, nativeHls: native, ima: useIma }) => {
      const state = {
        playCalls: 0,
        pauseCalls: 0,
        hlsAttachCalls: 0,
        hlsLoadCalls: 0,
        imaStarted: 0,
      };
      Object.defineProperty(window, "__ayinHarness", { value: state, configurable: true });

      const mediaPrototype = HTMLMediaElement.prototype as HTMLMediaElement & {
        __ayinPaused?: boolean;
        __ayinCurrentTime?: number;
      };
      Object.defineProperty(HTMLMediaElement.prototype, "paused", {
        configurable: true,
        get() {
          return (this as typeof mediaPrototype).__ayinPaused ?? true;
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
          return (this as typeof mediaPrototype).__ayinCurrentTime ?? 0;
        },
        set(value: number) {
          (this as typeof mediaPrototype).__ayinCurrentTime = Number.isFinite(value) ? value : 0;
        },
      });
      const originalCanPlayType = HTMLMediaElement.prototype.canPlayType;
      HTMLMediaElement.prototype.canPlayType = function (type: string) {
        if (type.toLowerCase().includes("mpegurl")) return native ? "probably" : "";
        return originalCanPlayType.call(this, type);
      };
      HTMLMediaElement.prototype.play = function () {
        state.playCalls += 1;
        (this as typeof mediaPrototype).__ayinPaused = false;
        this.dispatchEvent(new Event("play"));
        this.dispatchEvent(new Event("playing"));
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function () {
        state.pauseCalls += 1;
        const wasPaused = (this as typeof mediaPrototype).__ayinPaused ?? true;
        (this as typeof mediaPrototype).__ayinPaused = true;
        if (!wasPaused) this.dispatchEvent(new Event("pause"));
      };
      HTMLMediaElement.prototype.load = function () {
        const element = this;
        queueMicrotask(() => {
          if (element.getAttribute("src") || native) {
            element.dispatchEvent(new Event("loadedmetadata"));
            element.dispatchEvent(new Event("canplay"));
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
        destroy() {}
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
            queueMicrotask(() => {
              this.emit(events.complete);
              this.emit(events.resume);
            });
          }
          destroy() {}
        }
        class AdsLoader {
          listeners = new Map<string, Array<(event: unknown) => void>>();
          addEventListener(type: string, listener: (event: unknown) => void) {
            this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
          }
          requestAds() {
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
          setAdWillAutoPlay() {}
          setAdWillPlayMuted() {}
        }
        Object.defineProperty(window, "google", {
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
    { hlsMode, nativeHls, ima },
  );
}

async function harnessState(page: Page): Promise<HarnessState> {
  return page.evaluate(() =>
    (window as unknown as { __ayinHarness: HarnessState }).__ayinHarness,
  );
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

async function mockPreroll(page: Page, fixture: VideoFixture) {
  await page.route(`**/ads/video/decision/${fixture.id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        provider: "GOOGLE_IMA",
        tagUrl: "https://ads.invalid/task-41",
        preRollEnabled: true,
        midRollEnabled: false,
        postRollEnabled: false,
        midRollEverySec: 900,
        frequencyCapPerSession: 10,
        attribution: { videoId: fixture.id, channelId: fixture.channelId },
      }),
    });
  });
}

let fixture: VideoFixture;
let hlsFixture: HlsFixture;

test.describe.serial("Task 41 AYIN Player HLS acceptance", () => {
  test.beforeAll(() => {
    fixture = db<VideoFixture>("seed-player-video");
    hlsFixture = db<HlsFixture>("configure-hls-playback", {
      enabled: true,
      videoId: fixture.id,
    });
  });

  test.afterAll(() => {
    db("configure-hls-playback", { enabled: false });
  });

  test("HLS available defaults to AUTO, exposes only available levels, autoplays and keeps keyboard controls", async ({ page }) => {
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

    const stage = page.locator('[data-player-stage="true"]');
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
    await expect(page.locator("video")).toHaveAttribute("src", /canonical\.mp4$/);

    hlsFixture = db<HlsFixture>("configure-hls-playback", {
      enabled: true,
      videoId: fixture.id,
    });
  });

  test("malformed HLS manifest falls back once to the generation canonical MP4", async ({ page }) => {
    await installMediaHarness(page, { hlsMode: "malformed" });
    await mockNoAds(page, fixture.id);
    await page.goto(`/watch/${fixture.slug}`);

    await expect(page.locator("video")).toHaveAttribute("src", /fallback\.mp4$/);
    await expect.poll(async () => (await harnessState(page)).hlsLoadCalls).toBe(1);
    await page.waitForTimeout(150);
    expect((await harnessState(page)).hlsAttachCalls).toBe(1);
    await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(0);
  });

  test("native-HLS capability branch bypasses the JavaScript engine", async ({ page }) => {
    await installMediaHarness(page, { nativeHls: true });
    await mockNoAds(page, fixture.id);
    await page.goto(`/watch/${fixture.slug}`);

    await expect(page.locator("video")).toHaveAttribute("src", /master\.m3u8$/);
    await expect.poll(async () => (await harnessState(page)).hlsAttachCalls).toBe(0);
    await expect(page.getByLabel("Playback quality")).toHaveCount(0);
    await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(0);
  });

  test("Google IMA preroll completes on the same video element before HLS content resumes", async ({ page }) => {
    await installMediaHarness(page, { ima: true });
    await mockPreroll(page, fixture);
    await page.goto(`/watch/${fixture.slug}`);

    await expect.poll(async () => (await harnessState(page)).hlsLoadCalls).toBe(1);
    await expect.poll(async () => (await harnessState(page)).imaStarted).toBe(1);
    await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(0);
    await expect(page.locator("video")).toHaveCount(1);
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

    const start = page.getByRole("button", { name: "Play video" }).last();
    await expect(start).toBeVisible();
    expect((await harnessState(page)).imaStarted).toBe(0);
    await start.click();
    await expect.poll(async () => (await harnessState(page)).imaStarted).toBe(1);
    await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(0);
    await expect(page.locator("video")).toHaveAttribute("playsinline", "");
    await context.close();
  });

  test("fatal HLS failure during playback resumes MP4 without a duplicate VIDEO_START", async ({ page }) => {
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
      const hls = (window as unknown as {
        __ayinHlsInstance: { emit(event: string, data: unknown): void };
      }).__ayinHlsInstance;
      hls.emit("error", { fatal: true, type: "otherError", details: "fatalDecodeFailure" });
    });

    await expect(page.locator("video")).toHaveAttribute("src", /fallback\.mp4$/);
    await expect.poll(async () => (await harnessState(page)).playCalls).toBeGreaterThan(1);
    await page.waitForTimeout(3_300);

    expect(analyticsNames.filter((name) => name === "VIDEO_START")).toHaveLength(1);
    expect(analyticsNames.filter((name) => name === "VIDEO_HLS_FATAL")).toHaveLength(1);
    expect(analyticsNames.filter((name) => name === "VIDEO_FALLBACK")).toHaveLength(1);
  });
});
