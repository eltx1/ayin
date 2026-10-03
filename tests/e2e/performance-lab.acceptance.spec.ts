import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { performance as clock } from "node:perf_hooks";
import { expect, test } from "@playwright/test";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
const profiles = [
  {
    name: "desktop-unthrottled",
    viewport: { width: 1440, height: 1000 },
    cpuRate: 1,
    latencyMs: 0,
    downloadBytesPerSecond: -1,
    uploadBytesPerSecond: -1,
  },
  {
    name: "mobile-constrained",
    viewport: { width: 390, height: 844 },
    cpuRate: 4,
    latencyMs: 150,
    downloadBytesPerSecond: 200_000,
    uploadBytesPerSecond: 96_000,
  },
];
for (const profile of profiles)
  test(`controlled runtime measurements ${profile.name}`, async ({ page, browser }, testInfo) => {
    test.setTimeout(180_000);
    const url = new URL(process.env.TEST_DATABASE_URL ?? "");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
      throw new Error("Lab requires isolated local ayin_e2e");
    const db = (command: string, payload: object) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [path.resolve("tests/e2e/db-helper.mjs"), command, JSON.stringify(payload)],
          { env: process.env, encoding: "utf8" },
        ),
      );
    db("reset", {});
    const registered = await page.request.post(`${API}/auth/register`, {
      headers: { origin: WEB },
      data: {
        name: "Runtime lab creator",
        email: `runtime-${profile.name}@e2e.ayin.test`,
        password: "strong-pass-123",
      },
    });
    expect(registered.ok()).toBe(true);
    const user = (await registered.json()).user;
    const fixture = db("seed-creator-analytics", { accountId: user.account.id });
    const authentication = await page.context().storageState(); // Memory only; never written to a report.
    const apiMeasurements: Array<{
      days: number;
      sample: number;
      durationMs: number;
      jsonBodyBytes: number;
      views: number;
      audienceRows: number;
    }> = [];
    for (const days of [7, 28, 90, 365])
      for (let sample = 1; sample <= 3; sample++) {
        const start = clock.now(),
          response = await page.request.get(`${API}/creator/studio/analytics?days=${days}`);
        expect(response.ok()).toBe(true);
        const body = await response.body(),
          data = JSON.parse(body.toString());
        expect(data.periodDays).toBe(days);
        apiMeasurements.push({
          days,
          sample,
          durationMs: clock.now() - start,
          jsonBodyBytes: body.length,
          views: data.views,
          audienceRows: data.cohorts.audienceDaily.length,
        });
      }
    const queryPlans = db("measure-analytics-query-plans", { accountId: user.account.id });
    const samples: unknown[] = [];
    for (const route of ["/browse", "/studio/analytics"])
      for (let sample = 1; sample <= 3; sample++) {
        const context = await browser.newContext({
          serviceWorkers: "block",
          viewport: profile.viewport,
          storageState: authentication,
        });
        try {
          const target = await context.newPage(),
            cdp = await context.newCDPSession(target);
          await cdp.send("Network.enable");
          await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuRate });
          const network = {
            latency: profile.latencyMs,
            downloadThroughput: profile.downloadBytesPerSecond,
            uploadThroughput: profile.uploadBytesPerSecond,
          };
          // Current CDP marks this command deprecated, but the pinned browser
          // does not implement its replacement. Conditions are still applied,
          // and the exact compatibility command is recorded in the report.
          await cdp.send("Network.emulateNetworkConditions", {
            offline: false,
            ...network,
            connectionType: "cellular4g",
          });
          await cdp.send("Performance.enable");
          const initial = Object.fromEntries(
            (await cdp.send("Performance.getMetrics")).metrics.map(
              (item: { name: string; value: number }) => [item.name, item.value],
            ),
          );
          const requests = new Map<
            string,
            { category: string; status: number | null; encodedBytes: number; failed: boolean }
          >();
          cdp.on("Network.requestWillBeSent", (event) => {
            const url = new URL(event.request.url),
              extension = path.extname(url.pathname);
            const category =
              url.origin === API
                ? "api"
                : extension === ".js"
                  ? "script"
                  : extension === ".css"
                    ? "stylesheet"
                    : /\.(woff2?|ttf)$/.test(extension)
                      ? "font"
                      : /\.(png|svg|webp|jpe?g|ico)$/.test(extension)
                        ? "image"
                        : "document-or-other";
            requests.set(event.requestId, {
              category,
              status: null,
              encodedBytes: 0,
              failed: false,
            });
          });
          cdp.on("Network.responseReceived", (event) => {
            const request = requests.get(event.requestId);
            if (request) request.status = event.response.status;
          });
          cdp.on("Network.loadingFinished", (event) => {
            const request = requests.get(event.requestId);
            if (request) request.encodedBytes = event.encodedDataLength;
          });
          cdp.on("Network.loadingFailed", (event) => {
            const request = requests.get(event.requestId);
            if (request) request.failed = true;
          });
          await target.addInitScript(() => {
            const state = {
              supportedObservers: [...PerformanceObserver.supportedEntryTypes],
              lcpMs: null as number | null,
              shifts: [] as Array<{ time: number; value: number }>,
              longTasks: [] as Array<{ time: number; duration: number }>,
              events: [] as Array<{ name: string; duration: number; interactionId: number }>,
            };
            (window as unknown as { __ayinLab: typeof state }).__ayinLab = state;
            const observe = (type: string, receive: (entries: PerformanceEntry[]) => void) => {
              if (!PerformanceObserver.supportedEntryTypes.includes(type)) return;
              const observer = new PerformanceObserver((list) => receive(list.getEntries()));
              observer.observe({
                type,
                buffered: true,
                ...(type === "event" ? { durationThreshold: 16 } : {}),
              });
            };
            observe("largest-contentful-paint", (entries) => {
              for (const entry of entries) state.lcpMs = entry.startTime;
            });
            observe("layout-shift", (entries) => {
              for (const entry of entries) {
                const shift = entry as PerformanceEntry & {
                  value: number;
                  hadRecentInput: boolean;
                };
                if (!shift.hadRecentInput && state.shifts.length < 1000)
                  state.shifts.push({ time: shift.startTime, value: shift.value });
              }
            });
            observe("longtask", (entries) => {
              for (const entry of entries)
                if (state.longTasks.length < 1000)
                  state.longTasks.push({ time: entry.startTime, duration: entry.duration });
            });
            observe("event", (entries) => {
              for (const entry of entries) {
                const event = entry as PerformanceEntry & { interactionId: number };
                if (event.interactionId && state.events.length < 1000)
                  state.events.push({
                    name: event.name,
                    duration: event.duration,
                    interactionId: event.interactionId,
                  });
              }
            });
          });
          const started = clock.now();
          const response = await target.goto(`${WEB}${route}?lang=en`, {
            waitUntil: "domcontentloaded",
          });
          expect(response?.status()).toBe(200);
          const main = target.getByRole("main");
          await expect(main.getByRole("heading", { level: 1 })).toHaveCount(1);
          if (route === "/studio/analytics") await expect(main.getByRole("tablist")).toBeVisible();
          else await expect(main.getByRole("heading", { level: 1 })).toHaveText("Explore AYIN");
          await target.waitForTimeout(1000); // Defined settling window, not a score or synchronization fallback.
          const readyMs = clock.now() - started;
          const beforeInteractions = await target.evaluate(() => performance.now());
          if (route === "/studio/analytics") {
            await main.getByRole("tab", { name: "Audience", exact: true }).click();
            const region = main.getByRole("region", {
              name: "Audience return cohorts",
              exact: true,
            });
            await expect(region.locator("tbody tr")).toHaveCount(20);
            await main
              .getByRole("navigation", { name: "Audience return cohorts", exact: true })
              .getByRole("button", { name: "Next", exact: true })
              .click();
            await expect(region.locator("tbody tr")).toHaveCount(7);
            await main.getByRole("tab", { name: "Playback quality", exact: true }).click();
            await expect(main.getByRole("tabpanel", { name: "Playback quality" })).toBeVisible();
            await target.waitForTimeout(250); // Allow buffered Event Timing delivery after actual inputs.
          }
          const timings = await target.evaluate(() => {
            const state = (
              window as unknown as {
                __ayinLab: {
                  supportedObservers: string[];
                  lcpMs: number | null;
                  shifts: Array<{ time: number; value: number }>;
                  longTasks: Array<{ time: number; duration: number }>;
                  events: Array<{ name: string; duration: number; interactionId: number }>;
                };
              }
            ).__ayinLab;
            const navigation = performance.getEntriesByType(
              "navigation",
            )[0] as PerformanceNavigationTiming;
            let maximum = 0,
              session = 0,
              sessionStart = 0,
              previous = 0;
            for (const shift of state.shifts) {
              if (shift.time - previous > 1000 || shift.time - sessionStart > 5000) {
                session = 0;
                sessionStart = shift.time;
              }
              session += shift.value;
              previous = shift.time;
              maximum = Math.max(maximum, session);
            }
            return {
              ttfbMs: navigation.responseStart - navigation.requestStart,
              domContentLoadedMs: navigation.domContentLoadedEventEnd,
              fcpMs: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
              observedLcpMs: state.lcpMs,
              observerAvailability: state.supportedObservers,
              observedClsMaxSessionWindow: state.supportedObservers.includes("layout-shift")
                ? maximum
                : null,
              longTasks: state.longTasks,
              observedEventTimingEntries: state.events,
              domElements: document.querySelectorAll("*").length,
            };
          });
          const measured = Object.fromEntries(
            (await cdp.send("Performance.getMetrics")).metrics.map(
              (item: { name: string; value: number }) => [item.name, item.value],
            ),
          );
          const byCategory: Record<
            string,
            { requests: number; failed: number; encodedBytes: number }
          > = {};
          for (const request of requests.values()) {
            const group = (byCategory[request.category] ??= {
              requests: 0,
              failed: 0,
              encodedBytes: 0,
            });
            group.requests++;
            group.failed += Number(
              request.failed || (request.status !== null && request.status >= 400),
            );
            group.encodedBytes += request.encodedBytes;
          }
          samples.push({
            route,
            sample,
            readyIncludingDefinedSettleMs: readyMs,
            beforeInteractionsMs: beforeInteractions,
            ...timings,
            cpu: Object.fromEntries(
              ["ScriptDuration", "TaskDuration", "LayoutDuration"].map((key) => {
                const before = initial[key],
                  after = measured[key];
                return [
                  key,
                  {
                    beforeSeconds: before ?? null,
                    afterSeconds: after ?? null,
                    deltaMs:
                      typeof before === "number" && typeof after === "number" && after >= before
                        ? (after - before) * 1000
                        : null,
                  },
                ];
              }),
            ),
            rendererJsHeapUsedBytes: measured.JSHeapUsedSize ?? null,
            network: byCategory,
          });
          await cdp.detach();
        } finally {
          await context.close();
        }
      }
    const report = {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      source: {
        commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(),
        node: process.version,
        chromium: browser.version(),
      },
      environment:
        "isolated CI/local PostgreSQL and production Next output; local server warmed by suite; fresh browser context per sample",
      profile,
      networkConditionCommand: "Network.emulateNetworkConditions (pinned-browser compatibility)",
      fixture: {
        analyticsViews: fixture.views,
        exposedRows: fixture.exposedRows,
        seededCompleteDays: 28,
      },
      limits: [
        "Three samples per route; no field population or percentile certification",
        "CPU slowdown is relative to the CI host, not a physical mobile device",
        "Browser HTTP cache disabled and Service Worker blocked; PWA startup/cache not measured",
        "Navigation/observer/CDP metrics are laboratory observations, not production CWV compliance",
        "Raw Event Timing entries after actual tab/paging inputs are not aggregated or labelled as INP",
        "Encoded network bytes are CDP request totals, not all later dynamic resources or a CDN model",
        "API context reads are unthrottled and include client transfer/JSON body receipt; not server-only query timing",
        "No headers/cookies/storage state/response bodies or account/profile/video IDs are persisted",
        "Real fixture projections test reads; scheduled aggregation/provider/player/upload/concurrency remain separate",
      ],
      apiMeasurements,
      queryPlans,
      samples,
    };
    const filename = testInfo.outputPath(`performance-baseline-${profile.name}.json`);
    await writeFile(filename, JSON.stringify(report, null, 2) + "\n");
    await testInfo.attach(`runtime-baseline-${profile.name}`, {
      path: filename,
      contentType: "application/json",
    });
  });
