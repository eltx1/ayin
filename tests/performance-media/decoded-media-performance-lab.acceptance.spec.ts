import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance as clock } from "node:perf_hooks";
import { expect, test } from "@playwright/test";
import { performanceLabProfiles } from "../e2e/performance-lab-profiles";
import { observeRuntime } from "../e2e/performance-lab-observer";
import { runtimeSourceEvidence } from "../e2e/performance-lab-provenance";

const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
type DatabaseInventory = {
  accounts: number;
  channels: number;
  videos: number;
  movies: number;
  postgresVersionNumber: number;
};
type MediaState = {
  inputs: Array<{ time: number; trusted: boolean }>;
  events: Array<{
    name: string;
    time: number;
    currentTime: number;
    readyState: number;
    errorCode: number | null;
  }>;
  frames: Array<{
    time: number;
    mediaTime: number;
    presentedFrames: number;
    width: number;
    height: number;
  }>;
  supportsFrameCallback: boolean;
};
declare global {
  interface Window {
    __ayinDecodedLab: MediaState;
  }
}
function db<T>(command: string, accountId: string): T {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve("tests/e2e/product-performance-fixture.mjs"),
        command,
        JSON.stringify({ accountId, media: "decoded-webm" }),
      ],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
for (const profile of performanceLabProfiles)
  test(`native decoded Watch startup ${profile.name}`, async ({ page, browser }, testInfo) => {
    test.setTimeout(180_000);
    const database = new URL(process.env.TEST_DATABASE_URL ?? "");
    if (
      !["127.0.0.1", "localhost"].includes(database.hostname) ||
      database.pathname !== "/ayin_e2e"
    )
      throw new Error("Decoded startup lab requires isolated local ayin_e2e");
    const source = await runtimeSourceEvidence(browser.version(), [
      "tests/performance-media/decoded-media-performance-lab.acceptance.spec.ts",
      "tests/performance-media/serve-next-with-fixture.mjs",
      "playwright.native-media.config.ts",
      "tests/e2e/fixtures/clips-viewport.webm",
    ]);
    expect(source.trackedWorktreeClean).toBe(true);
    const bytes = await readFile(path.resolve("tests/e2e/fixtures/clips-viewport.webm"));
    const mediaUrl = `${WEB}/__ayin_native_runtime_lab__/clips-viewport.webm`;
    const fixtureAliasOrigin = process.env.AYIN_LAB_MEDIA_ALIAS_ORIGIN ?? "http://media.invalid";
    if (!["http://media.invalid", WEB].includes(fixtureAliasOrigin))
      throw new Error("Only the recorded synthetic fixture origin is allowed");
    const stagedBytes = await readFile(
      path.resolve("apps/web/public/__ayin_native_runtime_lab__/clips-viewport.webm"),
    );
    expect(
      stagedBytes.equals(bytes),
      "Staged local Next fixture must equal the accepted media bytes",
    ).toBe(true);
    let accountId: string | null = null,
      completed = false,
      cleaned = false,
      activeSample: number | null = null;
    const samples: unknown[] = [];
    let databaseInventory: DatabaseInventory | null = null;
    try {
      const registration = await page.request.post(`${API}/auth/register`, {
        headers: { origin: WEB },
        data: {
          name: "Runtime laboratory creator",
          email: `product-runtime-${randomUUID()}@e2e.ayin.test`,
          password: "strong-pass-123",
        },
      });
      expect(registration.ok()).toBe(true);
      accountId = (await registration.json()).user.account.id;
      const fixture = db<{
        videoSlug: string;
        sourceObjectKey: string;
        databaseInventory: DatabaseInventory;
      }>("seed", accountId!);
      databaseInventory = fixture.databaseInventory;
      const authentication = await page.context().storageState();
      for (let sample = 1; sample <= 3; sample++) {
        activeSample = sample;
        const context = await browser.newContext({
          viewport: profile.viewport,
          serviceWorkers: "block",
          locale: "en-US",
          storageState: authentication,
        });
        let observation: Awaited<ReturnType<typeof observeRuntime>> | null = null;
        let interruptedNativeMedia: (() => Promise<MediaState | null>) | null = null;
        const served: Array<{
          method: string;
          status: number;
          range: boolean;
          declaredBodyBytes: number | null;
        }> = [];
        try {
          const target = await context.newPage();
          interruptedNativeMedia = () => target.evaluate(() => window.__ayinDecodedLab ?? null);
          target.on("response", (response) => {
            if (response.url() !== mediaUrl) return;
            const headers = response.headers(),
              length = Number(headers["content-length"]);
            served.push({
              method: response.request().method(),
              status: response.status(),
              range: Boolean(response.request().headers().range),
              declaredBodyBytes: Number.isSafeInteger(length) && length >= 0 ? length : null,
            });
          });
          // Only redirect this one synthetic fixture URL. The browser itself
          // transfers and decodes the real loopback response under the CDP profile.
          await target.route(
            (url) =>
              url.origin === fixtureAliasOrigin && url.pathname === `/${fixture.sourceObjectKey}`,
            (route) =>
              route.fulfill({
                status: 307,
                headers: { location: mediaUrl, "cache-control": "no-store" },
                body: "",
              }),
          );
          const measurement = await observeRuntime(target, profile);
          observation = measurement;
          await target.addInitScript(() => {
            const inVisibleMain = (video: HTMLVideoElement) => {
              const main = video.closest("main");
              return Boolean(
                main &&
                main.getClientRects().length &&
                getComputedStyle(main).visibility !== "hidden" &&
                !video.closest('[hidden], [aria-hidden="true"]'),
              );
            };
            const state: MediaState = (window.__ayinDecodedLab = {
              inputs: [],
              events: [],
              frames: [],
              supportsFrameCallback: "requestVideoFrameCallback" in HTMLVideoElement.prototype,
            });
            document.addEventListener(
              "click",
              (event) => {
                if (
                  event.target instanceof Element &&
                  event.target.closest('[aria-label="Play video"], [aria-label="Play"]')
                )
                  state.inputs.push({ time: performance.now(), trusted: event.isTrusted });
              },
              true,
            );
            for (const name of [
              "loadedmetadata",
              "loadeddata",
              "canplay",
              "playing",
              "waiting",
              "stalled",
              "error",
            ])
              document.addEventListener(
                name,
                (event) => {
                  if (
                    !(event.target instanceof HTMLVideoElement) ||
                    !inVisibleMain(event.target) ||
                    state.events.length >= 100
                  )
                    return;
                  state.events.push({
                    name,
                    time: performance.now(),
                    currentTime: event.target.currentTime,
                    readyState: event.target.readyState,
                    errorCode: event.target.error?.code ?? null,
                  });
                },
                true,
              );
            const observed = new WeakSet<HTMLVideoElement>();
            new MutationObserver(() => {
              for (const video of document.querySelectorAll("video")) {
                if (observed.has(video) || !state.supportsFrameCallback) continue;
                observed.add(video);
                const frame: VideoFrameRequestCallback = (time, metadata) => {
                  if (inVisibleMain(video))
                    state.frames.push({
                      time,
                      mediaTime: metadata.mediaTime,
                      presentedFrames: metadata.presentedFrames,
                      width: metadata.width,
                      height: metadata.height,
                    });
                  if (state.frames.length < 12) video.requestVideoFrameCallback(frame);
                };
                video.requestVideoFrameCallback(frame);
              }
            }).observe(document, { childList: true, subtree: true });
          });
          const started = clock.now();
          const response = await target.goto(`${WEB}/watch/${fixture.videoSlug}`, {
            waitUntil: "domcontentloaded",
          });
          expect(response?.status()).toBe(200);
          await expect(
            target.getByRole("heading", {
              level: 1,
              name: "Runtime laboratory feature",
              exact: true,
            }),
          ).toBeVisible();
          await expect(target.locator("main:visible video")).toHaveCount(1);
          const automationToRouteDomMs = clock.now() - started;
          // Preserve the application's initial autoplay request and browser policy.
          // A real trusted click is a fallback only after no automatic advancing
          // frame was observed and the actual element remains paused.
          let startupMode: "automatic" | "trusted-play-fallback" = "automatic";
          const automaticObservationWindowMs = 10_000;
          const advancing = () =>
            target.evaluate(
              () =>
                window.__ayinDecodedLab.events.some((entry) => entry.name === "playing") &&
                window.__ayinDecodedLab.frames.some(
                  (entry, index, frames) =>
                    index > 0 && entry.mediaTime > frames[index - 1]!.mediaTime,
                ),
            );
          const automatic = await expect
            .poll(advancing, { timeout: automaticObservationWindowMs })
            .toBe(true)
            .then(
              () => true,
              () => false,
            );
          if (!automatic) {
            const state = await target
              .locator("main:visible video")
              .evaluate((video: HTMLVideoElement) => ({
                paused: video.paused,
                errorCode: video.error?.code ?? null,
              }));
            expect(state.errorCode).toBeNull();
            expect(
              state.paused,
              "Do not interrupt an already-playing element to manufacture an input-startup sample",
            ).toBe(true);
            const play = target.getByRole("button", { name: "Play video", exact: true });
            await expect(play).toBeVisible();
            startupMode = "trusted-play-fallback";
            await play.click();
            await expect
              .poll(
                () =>
                  target.evaluate(() => {
                    const state = window.__ayinDecodedLab,
                      input = state.inputs[0];
                    return Boolean(
                      input?.trusted &&
                      state.events.some(
                        (entry) => entry.name === "playing" && entry.time >= input.time,
                      ) &&
                      state.frames.some(
                        (entry, index, frames) =>
                          index > 0 &&
                          entry.time >= input.time &&
                          entry.mediaTime > frames[index - 1]!.mediaTime,
                      ),
                    );
                  }),
                { timeout: 30_000 },
              )
              .toBe(true);
          }
          const startupObserved = await target
            .locator("main:visible video")
            .evaluate((video: HTMLVideoElement) => {
              const state = window.__ayinDecodedLab;
              return {
                ...state,
                currentTime: video.currentTime,
                duration: video.duration,
                videoWidth: video.videoWidth,
                videoHeight: video.videoHeight,
                errorCode: video.error?.code ?? null,
                preload: video.preload,
                muted: video.muted,
              };
            });
          expect(startupObserved.videoWidth).toBe(96);
          expect(startupObserved.videoHeight).toBe(160);
          expect(startupObserved.duration).toBeGreaterThan(29);
          expect(startupObserved.duration).toBeLessThan(31);
          expect(startupObserved.errorCode).toBeNull();
          expect(startupObserved.inputs).toHaveLength(startupMode === "automatic" ? 0 : 1);
          const input = startupObserved.inputs[0] ?? null;
          const playing = startupObserved.events.find(
            (entry) => entry.name === "playing" && (input === null || entry.time >= input.time),
          );
          const firstAdvancing = startupObserved.frames.find(
            (entry, index, frames) =>
              index > 0 &&
              entry.mediaTime > frames[index - 1]!.mediaTime &&
              (input === null || entry.time >= input.time),
          );
          expect(playing).toBeDefined();
          expect(firstAdvancing).toBeDefined();
          await target.getByRole("button", { name: "Pause", exact: true }).click();
          await target.waitForTimeout(250); // Buffered observer delivery, excluded from startup timings.
          const observed = await measurement.snapshot();
          expect(
            served.some((entry) => entry.method === "GET" && (entry.declaredBodyBytes ?? 0) > 0),
          ).toBe(true);
          expect(served.every((entry) => entry.status === 200 || entry.status === 206)).toBe(true);
          samples.push({
            completed: true,
            sample,
            automationToRouteDomMs,
            startupMode,
            automaticObservationWindowMs,
            navigationToFirstPlayingMs: playing!.time,
            navigationToFirstObservedAdvancingFrameMs: firstAdvancing!.time,
            navigationToFirstObservedFrameMs: startupObserved.frames[0]?.time ?? null,
            trustedClickToPlayingMs: input === null ? null : playing!.time - input.time,
            trustedClickToFirstObservedAdvancingFrameMs:
              input === null ? null : firstAdvancing!.time - input.time,
            nativeMedia: startupObserved,
            localHttpResponses: served,
            observed,
          });
          await measurement.detach();
        } catch (error) {
          samples.push({
            completed: false,
            sample,
            localHttpResponses: served,
            interruptedObservation: (await observation?.snapshot().catch(() => null)) ?? null,
            interruptedNativeMedia: (await interruptedNativeMedia?.().catch(() => null)) ?? null,
          });
          throw error;
        } finally {
          await context.close();
        }
      }
      completed = true;
      activeSample = null;
    } finally {
      try {
        if (accountId) cleaned = db<{ cleaned: boolean }>("cleanup", accountId).cleaned;
      } finally {
        const report = {
          schemaVersion: 1,
          capturedAt: new Date().toISOString(),
          completed: completed && cleaned,
          interruptedAtSample: activeSample,
          source,
          profile,
          environment:
            "Real local AppModule/PostgreSQL and production Next; already-running servers; route/data cache temperature not controlled",
          browserConfiguration: {
            cacheDisabled: true,
            trace: "off",
            videoRecording: "off",
            serviceWorkers: "block",
            samplesPerProfile: 3,
            authenticated: true,
            locale: "en",
            parallelSampleContexts: 1,
          },
          networkConditionCommand:
            "Network.emulateNetworkConditions (pinned-browser compatibility)",
          fixture: {
            databaseInventory,
            file: "clips-viewport.webm",
            sha256: createHash("sha256").update(bytes).digest("hex"),
            bytes: bytes.length,
            codec: "VP8",
            audioStreams: 0,
            deliveredMimeType: "video/webm",
            fixtureAliasOrigin,
            apiCanonicalDeclaration:
              "video/mp4; synthetic fixture alias only, not a verified MP4 encoding",
            durationSeconds: 30,
            width: 96,
            height: 160,
            transport:
              "Native browser HTTP to local Next static serving on http://127.0.0.1:3000 after a test-only fixture-origin 307 redirect; CSP preserved",
            databaseFixtureCleaned: cleaned,
            temporaryMediaCleanup:
              "Must be verified separately after the dedicated Next wrapper exits; the external run controller asserts the staging directory is absent and retains the result",
          },
          limits: [
            "Three laboratory samples per profile, not field percentiles or a physical mobile device",
            "Route DOM readiness, first observed native frame and trusted-click playback milestones are separate",
            "Advancement requires increasing mediaTime across two frame callbacks, not merely a positive resumed position. Contexts are fresh but reuse the same synthetic profile per configured profile; actual native media times remain recorded",
            "The exact VP8 fixture has no audio stream; automatic startup does not establish autoplay behavior for production media with audio",
            "A frame callback observes presentation scheduling of a decoded frame; this does not certify a physical screen's first photon",
            "The application retains its actual autoplay request and native preload setting. Automatic startup has null trusted-click timings; only a still-paused player after the recorded ten-second observation window receives trusted Play. This fallback is not asserted to be an autoplay-policy rejection. Preloaded frames can precede a click, so click-to-playing is not cold-download startup",
            "Only one synthetic VP8 WebM is served through a test-only redirect from the recorded local/invalid fixture alias and existing canonical MP4 fixture declaration (as in Clips acceptance). No production MP4/HLS encoding, ABR, CDN, R2, ads provider, upload, concurrency or field startup claim",
            "Original synthetic source request is redirected by Playwright without a media body; actual media bytes arrive through the browser's loopback HTTP request under the recorded CDP conditions",
            "Observer network labels retain the original fixture-origin redirect and local Next media responses; response status/range/declared length are recorded separately",
            "Local HTTP declaredBodyBytes comes from Content-Length and is not a byte-exact browser receipt guarantee; CDP completion state and native frames are separate observations",
            "No media prototypes are replaced, no mocked play event or fake readyState is used, and no production provider configuration changes",
            "Raw Event Timing and renderer counters are laboratory observations, not field INP or a before/after improvement",
          ],
          samples,
        };
        const file = testInfo.outputPath(`performance-baseline-decoded-${profile.name}.json`);
        await writeFile(file, JSON.stringify(report, null, 2) + "\n");
        await testInfo.attach(`decoded-startup-${profile.name}`, {
          path: file,
          contentType: "application/json",
        });
      }
    }
  });
