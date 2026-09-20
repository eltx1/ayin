import { expect, test, type Page } from "@playwright/test";

type HarnessState = {
  hlsConstructed: number;
  hlsDestroyed: number;
  playCalls: number;
  currentTime: number;
};

type LiveStatus = "READY" | "LIVE" | "ENDED";

function liveFixture(status: LiveStatus) {
  return {
    id: "00000000-0000-4000-8000-000000000074",
    title: "Task 74 live",
    description: "Live playback hardening acceptance",
    status,
    playbackUrl: "https://stream.mux.com/task-74.m3u8",
    scheduledStartAt: null,
    chatEnabled: true,
    adBreakHook: "IMA_CLIENT_BREAK",
    channel: {
      id: "00000000-0000-4000-8000-000000000075",
      handle: "task-74",
      name: "Task 74",
    },
  };
}

async function installLiveHarness(page: Page, nativeHls = false) {
  await page.addInitScript(
    ({ native }) => {
      const state = {
        hlsConstructed: 0,
        hlsDestroyed: 0,
        playCalls: 0,
        currentTime: 100,
      };
      Object.defineProperty(window, "__liveTask74", { value: state, configurable: true });

      Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
        configurable: true,
        get() {
          return state.currentTime;
        },
        set(value: number) {
          state.currentTime = value;
        },
      });
      Object.defineProperty(HTMLMediaElement.prototype, "paused", {
        configurable: true,
        get() {
          return false;
        },
      });
      Object.defineProperty(HTMLMediaElement.prototype, "seekable", {
        configurable: true,
        get() {
          return {
            length: 1,
            start: () => 60,
            end: () => 120,
          };
        },
      });
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
      HTMLMediaElement.prototype.canPlayType = function (type: string) {
        return native && type.toLowerCase().includes("mpegurl") ? "probably" : "";
      };
      HTMLMediaElement.prototype.load = function () {
        if (native) {
          queueMicrotask(() => {
            this.dispatchEvent(new Event("loadedmetadata"));
            this.dispatchEvent(new Event("canplay"));
          });
        }
      };
      HTMLMediaElement.prototype.play = function () {
        state.playCalls += 1;
        this.dispatchEvent(new Event("playing"));
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function () {
        this.dispatchEvent(new Event("pause"));
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
          return true;
        }

        levels = [{ width: 1280, height: 720, bitrate: 3_000_000 }];
        currentLevel = -1;
        nextLevel = -1;
        listeners = new Map<string, Array<(...args: unknown[]) => void>>();
        media: HTMLVideoElement | null = null;

        constructor() {
          state.hlsConstructed += 1;
          Object.defineProperty(window, "__liveTask74Hls", {
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
          this.media = video;
          queueMicrotask(() => this.emit(FakeHls.Events.MEDIA_ATTACHED));
        }
        loadSource(url: string) {
          if (this.media) this.media.dataset.hlsSource = url;
          queueMicrotask(() => this.emit(FakeHls.Events.MANIFEST_PARSED));
        }
        startLoad() {}
        recoverMediaError() {}
        destroy() {
          state.hlsDestroyed += 1;
        }
      }

      Object.defineProperty(window, "Hls", { value: FakeHls, configurable: true });
    },
    { native: nativeHls },
  );
}

async function state(page: Page): Promise<HarnessState> {
  return page.evaluate(() => (window as unknown as { __liveTask74: HarnessState }).__liveTask74);
}

test.describe.serial("Task 74 live playback hardening", () => {
  test("hls.js path starts at live edge and reconnects after network/manifest interruption", async ({
    page,
  }) => {
    const analytics: string[] = [];
    await installLiveHarness(page);
    await page.route("**/live/task-74", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(liveFixture("LIVE")),
      });
    });
    await page.route("**/live/task-74/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ chatEnabled: true, messages: [] }),
      });
    });
    await page.route("**/analytics/events", async (route) => {
      const body = route.request().postDataJSON() as { events?: Array<{ eventName?: string }> };
      for (const event of body.events ?? []) if (event.eventName) analytics.push(event.eventName);
      await route.fulfill({ status: 202, contentType: "application/json", body: "{}" });
    });

    await page.goto("/live/task-74");
    await expect(page.locator('[data-live-player="true"]')).toBeVisible();
    await expect(page.locator("video")).toHaveAttribute(
      "data-hls-source",
      "https://stream.mux.com/task-74.m3u8",
    );
    await expect.poll(async () => (await state(page)).playCalls).toBeGreaterThan(0);
    await expect.poll(async () => (await state(page)).currentTime).toBeGreaterThan(119);
    await expect(page.getByRole("slider")).toHaveCount(0);

    await page.waitForTimeout(350);
    await page.locator("video").evaluate((video) => video.dispatchEvent(new Event("waiting")));
    await page.waitForTimeout(80);
    await page.locator("video").evaluate((video) => video.dispatchEvent(new Event("playing")));

    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.getByText("Connection lost. Waiting for network…")).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => (await state(page)).hlsConstructed).toBeGreaterThan(1);

    await page.evaluate(() => {
      const hls = (
        window as unknown as {
          __liveTask74Hls: { emit(event: string, data: unknown): void };
        }
      ).__liveTask74Hls;
      hls.emit("error", {
        fatal: true,
        type: "networkError",
        details: "manifestLoadError",
      });
    });
    await expect
      .poll(async () => (await state(page)).hlsConstructed, { timeout: 5_000 })
      .toBeGreaterThan(2);
    await page.waitForTimeout(3_200);
    expect(analytics).toContain("LIVE_PLAY_START");
    expect(analytics).toContain("LIVE_STARTUP");
    expect(analytics).toContain("LIVE_REBUFFER");
    expect(analytics).toContain("LIVE_RECONNECT");
    expect(analytics).toContain("LIVE_DURATION");
  });

  test("native-HLS capability path bypasses hls.js and retains live controls", async ({ page }) => {
    await installLiveHarness(page, true);
    await page.route("**/live/task-74", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(liveFixture("LIVE")),
      });
    });
    await page.route("**/live/task-74/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ chatEnabled: true, messages: [] }),
      });
    });

    await page.goto("/live/task-74");
    await expect(page.locator("video")).toHaveAttribute(
      "data-native-hls-source",
      "https://stream.mux.com/task-74.m3u8",
    );
    expect((await state(page)).hlsConstructed).toBe(0);
    await expect(page.getByRole("button", { name: "Fullscreen" })).toBeVisible();
    await expect(page.getByText("Live edge")).toBeVisible();
  });

  test("provider ENDED stops live recovery and records an end reason", async ({ page }) => {
    const analytics: string[] = [];
    await installLiveHarness(page);
    let requestCount = 0;
    await page.route("**/live/task-74", async (route) => {
      requestCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(liveFixture(requestCount === 1 ? "LIVE" : "ENDED")),
      });
    });
    await page.route("**/live/task-74/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ chatEnabled: true, messages: [] }),
      });
    });
    await page.route("**/analytics/events", async (route) => {
      const body = route.request().postDataJSON() as { events?: Array<{ eventName?: string }> };
      for (const event of body.events ?? []) if (event.eventName) analytics.push(event.eventName);
      await route.fulfill({ status: 202, contentType: "application/json", body: "{}" });
    });

    await page.goto("/live/task-74");
    await expect.poll(async () => (await state(page)).playCalls).toBeGreaterThan(0);
    const constructedBeforeEnd = (await state(page)).hlsConstructed;

    await expect(page.getByText("This live stream has ended."), { timeout: 8_000 }).toBeVisible();
    await page.waitForTimeout(3_200);

    expect((await state(page)).hlsConstructed).toBe(constructedBeforeEnd);
    expect(analytics).toContain("LIVE_END");
    expect(analytics).toContain("LIVE_PLAY_COMPLETE");
  });

  test("stream-not-started path does not load the live manifest and can refresh into LIVE", async ({
    page,
  }) => {
    await installLiveHarness(page);
    let status: LiveStatus = "READY";
    await page.route("**/live/task-74", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(liveFixture(status)),
      });
    });
    await page.route("**/live/task-74/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ chatEnabled: true, messages: [] }),
      });
    });

    await page.goto("/live/task-74");
    await expect(
      page.getByText("The encoder is ready. Waiting for playable live output…"),
    ).toBeVisible();
    expect((await state(page)).hlsConstructed).toBe(0);

    status = "LIVE";
    await page.getByRole("button", { name: "Check now" }).click();
    await expect(page.locator('[data-live-player="true"]')).toBeVisible();
    await expect.poll(async () => (await state(page)).hlsConstructed).toBe(1);
  });
});
