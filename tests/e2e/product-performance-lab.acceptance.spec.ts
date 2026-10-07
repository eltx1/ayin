import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { performance as clock } from "node:perf_hooks";
import { expect, test, type Page } from "@playwright/test";
import { performanceLabProfiles } from "./performance-lab-profiles";
import { observeRuntime } from "./performance-lab-observer";
import { runtimeSourceEvidence } from "./performance-lab-provenance";

const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
type Fixture = {
  movieSlug: string;
  videoSlug: string;
  videos: number;
  databaseInventory: {
    accounts: number;
    channels: number;
    videos: number;
    movies: number;
    postgresVersionNumber: number;
  };
};
function fixture<T>(command: string, accountId: string): T {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve("tests/e2e/product-performance-fixture.mjs"),
        command,
        JSON.stringify({ accountId }),
      ],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
type Scenario = {
  name: string;
  route: string;
  url: string;
  readiness: string;
  interaction: string | null;
  ready: (page: Page) => Promise<void>;
  interact?: (page: Page) => Promise<void>;
};
function scenarios(data: Fixture): Scenario[] {
  return [
    {
      name: "home",
      route: "/",
      url: "/?lang=en",
      readiness:
        "One visible hero h1 and real discovery rows after the loading skeleton is removed",
      interaction: null,
      ready: async (page) => {
        await expect(page.locator("main h1:visible")).toHaveCount(1);
        await expect(
          page.getByRole("status", { name: "Loading AYIN discovery", exact: true }),
        ).toHaveCount(0);
        await expect(
          page.locator("#discovery").getByRole("heading", { level: 2 }).first(),
        ).toBeVisible();
      },
    },
    {
      name: "search",
      route: "/search",
      url: "/search?q=Runtime+laboratory&lang=en",
      readiness:
        "Seeded movie in the scoped Search results region and hydrated query field; suggestions measured only after trusted input",
      interaction: "Trusted keyboard replacement followed by actual debounced suggestion response",
      ready: async (page) => {
        await expect(
          page
            .getByRole("region", { name: "Search results for Runtime laboratory", exact: true })
            .locator(`a[data-tv-focus-id][href="/movies/${data.movieSlug}"]`),
        ).toBeVisible();
        await expect(page.getByRole("searchbox", { name: "Search AYIN", exact: true })).toHaveValue(
          "Runtime laboratory",
        );
      },
      interact: async (page) => {
        const input = page.getByRole("searchbox", { name: "Search AYIN", exact: true });
        await input.focus();
        await input.press("ControlOrMeta+A");
        const response = page.waitForResponse(
          (response) =>
            response.url().startsWith(`${API}/public/search/suggestions?`) &&
            new URL(response.url()).searchParams.get("q") === "Runtime laboratory movie",
        );
        await input.pressSequentially("Runtime laboratory movie", { delay: 10 });
        expect((await response).ok()).toBe(true);
        await expect(
          page
            .getByRole("list", { name: "Search suggestions", exact: true })
            .getByRole("link", { name: /Runtime laboratory movie/ }),
        ).toBeVisible();
      },
    },
    {
      name: "movie-detail",
      route: "/movies/:fixture",
      url: `/movies/${data.movieSlug}?lang=en`,
      readiness: "Seeded movie h1, synopsis and canonical Watch action from real catalog reads",
      interaction: null,
      ready: async (page) => {
        await expect(
          page.getByRole("heading", { level: 1, name: "Runtime laboratory movie", exact: true }),
        ).toBeVisible();
        await expect(page.getByRole("link", { name: "Watch movie", exact: true })).toHaveAttribute(
          "href",
          `/watch/${data.videoSlug}`,
        );
        await expect(
          page.getByText("Synthetic local catalog entry for controlled route measurements.", {
            exact: true,
          }),
        ).toBeVisible();
      },
    },
    {
      name: "watch-route",
      route: "/watch/:fixture",
      url: `/watch/${data.videoSlug}?lang=en`,
      readiness:
        "Seeded video h1, player DOM, resolved real social state and Comments disclosure; no decoded-media readiness assertion",
      interaction: "Open Comments with a trusted click and wait for the real empty-thread read",
      ready: async (page) => {
        await expect(
          page.getByRole("heading", { level: 1, name: "Runtime laboratory feature", exact: true }),
        ).toBeVisible();
        await expect(page.locator("main:visible video")).toHaveCount(1);
        await expect(page.locator('main:visible button[data-tv-focus-id$="-like"]')).toBeEnabled();
        await expect(
          page.locator("main:visible summary").filter({ hasText: "Comments" }),
        ).toBeVisible();
      },
      interact: async (page) => {
        await page.locator("main:visible summary").filter({ hasText: "Comments" }).click();
        await expect(page.getByText("Be the first to comment.", { exact: true })).toBeVisible();
      },
    },
    {
      name: "upload-workspace",
      route: "/upload",
      url: "/upload?lang=en",
      readiness:
        "Real creator identity resolved, video file picker enabled and format controls visible",
      interaction:
        "Trusted keyboard changes Standard video to AYIN Clip and back; no file or upload bytes",
      ready: async (page) => {
        await expect(
          page.getByRole("heading", { level: 1, name: "Upload a video", exact: true }),
        ).toBeVisible();
        await expect(page.locator('input[type="file"][accept^="video/"]')).toBeEnabled();
        await expect(
          page.getByRole("radiogroup", { name: "Video format", exact: true }),
        ).toBeVisible();
      },
      interact: async (page) => {
        const group = page.getByRole("radiogroup", { name: "Video format", exact: true });
        await group.getByRole("radio", { name: /Standard video/ }).focus();
        await page.keyboard.press("End");
        await expect(group.getByRole("radio", { name: /AYIN Clip/ })).toHaveAttribute(
          "aria-checked",
          "true",
        );
        await page.keyboard.press("Home");
        await expect(group.getByRole("radio", { name: /Standard video/ })).toHaveAttribute(
          "aria-checked",
          "true",
        );
      },
    },
    {
      name: "admin-overview",
      route: "/admin",
      url: "/admin?lang=en",
      readiness: "OPERATIONS session and eight real platform counters; overview reads settled",
      interaction: "Trusted keyboard search plus actual scoped administration search submission",
      ready: async (page) => {
        await expect(
          page.getByRole("heading", { level: 1, name: "Overview", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("region", { name: "Platform counters", exact: true }).locator("dd"),
        ).toHaveCount(8);
        await expect(
          page.getByRole("button", { name: "Refresh overview", exact: true }),
        ).toBeEnabled();
      },
      interact: async (page) => {
        await page
          .getByRole("textbox", { name: "Search administration", exact: true })
          .pressSequentially("Runtime laboratory", { delay: 10 });
        await page.getByRole("button", { name: "Search", exact: true }).click();
        await expect(
          page.getByRole("list", { name: "Search results", exact: true }).getByRole("link").first(),
        ).toBeVisible();
      },
    },
    {
      name: "studio-overview",
      route: "/studio",
      url: "/studio?lang=en",
      readiness: "Real overview counters include the 24 seeded owned videos and Refresh is enabled",
      interaction: "Trusted native More channel tools disclosure toggle",
      ready: async (page) => {
        const counters = page.locator('main:visible dl[aria-label="Channel counters"]');
        await expect(counters.locator("dd").first()).toHaveText(String(data.videos));
        await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
      },
      interact: async (page) => {
        await page
          .locator("main:visible summary")
          .filter({ hasText: "More channel tools" })
          .click();
        await expect(
          page
            .locator("main:visible details[open]")
            .getByRole("link", { name: "Creator TV", exact: true }),
        ).toBeVisible();
      },
    },
  ];
}

for (const profile of performanceLabProfiles)
  test(`controlled product runtime measurements ${profile.name}`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(420_000);
    const databaseUrl = new URL(process.env.TEST_DATABASE_URL ?? "");
    if (
      !["127.0.0.1", "localhost"].includes(databaseUrl.hostname) ||
      databaseUrl.pathname !== "/ayin_e2e"
    )
      throw new Error(
        "Product runtime lab requires isolated local ayin_e2e before any registration",
      );
    const selectedScope: unknown = testInfo.config.metadata.ayinProductRouteSelection;
    if (selectedScope !== undefined && selectedScope !== "search-and-watch")
      throw new Error("Unsupported product measurement route selection");
    const changedRoutesOnly = selectedScope === "search-and-watch";
    const source = await runtimeSourceEvidence(browser.version(), [
      "tests/e2e/product-performance-lab.acceptance.spec.ts",
      ...(changedRoutesOnly ? ["playwright.changed-routes.config.ts"] : []),
    ]);
    expect(
      source.trackedWorktreeClean,
      "Commit the measured test source before collecting formal evidence",
    ).toBe(true);
    const registration = await page.request.post(`${API}/auth/register`, {
      headers: { origin: WEB },
      data: {
        name: "Runtime laboratory creator",
        email: `product-runtime-${randomUUID()}@e2e.ayin.test`,
        password: "strong-pass-123",
      },
    });
    expect(registration.ok()).toBe(true);
    const accountId = (await registration.json()).user.account.id;
    const samples: unknown[] = [];
    let databaseInventory: Fixture["databaseInventory"] | null = null;
    let cleanupFailure: unknown = null;
    let completed = false,
      active: { scenario: string; sample: number } | null = null;
    try {
      const data = fixture<Fixture>("seed", accountId);
      databaseInventory = data.databaseInventory;
      const authentication = await page.context().storageState(); // In memory only.
      const selectedScenarios = scenarios(data).filter(
        (scenario) => !changedRoutesOnly || ["search", "watch-route"].includes(scenario.name),
      );
      for (const scenario of selectedScenarios)
        for (let sample = 1; sample <= 3; sample++) {
          active = { scenario: scenario.name, sample };
          const context = await browser.newContext({
            serviceWorkers: "block",
            viewport: profile.viewport,
            locale: "en-US",
            storageState: authentication,
          });
          let observation: Awaited<ReturnType<typeof observeRuntime>> | null = null;
          try {
            const target = await context.newPage();
            const measurement = await observeRuntime(target, profile);
            observation = measurement;
            const started = clock.now();
            const response = await target.goto(`${WEB}${scenario.url}`, {
              waitUntil: "domcontentloaded",
            });
            expect(response?.status()).toBe(200);
            await scenario.ready(target);
            const automationToRouteReadyMs = clock.now() - started;
            const ready = await measurement.snapshot();
            await target.waitForTimeout(1000); // Deliberate comparable observation window, not readiness.
            const settled = await measurement.snapshot();
            const interactionStartedMs = await target.evaluate(() => performance.now());
            if (scenario.interact) await scenario.interact(target);
            const interactionEndedMs = await target.evaluate(async () => {
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              );
              return performance.now();
            });
            if (scenario.interact) await target.waitForTimeout(250); // Buffered Event Timing delivery, outside the interaction window.
            const afterInteraction = await measurement.snapshot();
            samples.push({
              completed: true,
              scenario: scenario.name,
              route: scenario.route,
              sample,
              readiness: scenario.readiness,
              automationToRouteReadyMs,
              definedSettleMs: 1000,
              ready,
              settled,
              interaction:
                scenario.interaction === null
                  ? null
                  : {
                      description: scenario.interaction,
                      startedMs: interactionStartedMs,
                      endedMs: interactionEndedMs,
                      browserWindowIncludingAutomationMs: interactionEndedMs - interactionStartedMs,
                      rawEventTimingEntries: afterInteraction.observedEventTimingEntries.filter(
                        (entry) =>
                          entry.time >= interactionStartedMs && entry.time < interactionEndedMs,
                      ),
                    },
              afterInteraction,
            });
            await measurement.detach();
          } catch (error) {
            samples.push({
              completed: false,
              scenario: scenario.name,
              route: scenario.route,
              sample,
              interruptedObservation: (await observation?.snapshot().catch(() => null)) ?? null,
            });
            throw error;
          } finally {
            await context.close();
          }
        }
      completed = true;
      active = null;
    } finally {
      let cleaned = false,
        cleanupFailed = false;
      try {
        cleaned = fixture<{ cleaned: boolean }>("cleanup", accountId).cleaned;
      } catch (error) {
        cleanupFailed = true;
        cleanupFailure = error;
      } finally {
        const report = {
          schemaVersion: 3,
          collectionScope: changedRoutesOnly ? "changed-search-and-watch" : "seven-product-routes",
          plannedSamplesPerProfile: changedRoutesOnly ? 6 : 21,
          capturedAt: new Date().toISOString(),
          completed: completed && cleaned,
          interruptedAt: active,
          source,
          profile,
          environment:
            "Real local AppModule/PostgreSQL and production Next; already-running servers; route/data cache temperature not controlled; fresh authenticated browser context per route/sample",
          networkConditionCommand:
            "Network.emulateNetworkConditions (pinned-browser compatibility)",
          browserConfiguration: {
            cacheDisabled: true,
            serviceWorkers: "block",
            samplesPerRoute: 3,
            trace: testInfo.project.use.trace ?? "off",
            videoRecording: testInfo.project.use.video ?? "off",
            authenticated: true,
            locale: "en",
            parallelSampleContexts: 1,
          },
          fixture: {
            seedCompleted: databaseInventory !== null,
            databaseInventory,
            ownedVideos: 24,
            publishedVideos: 1,
            catalogMovies: 1,
            artwork: "No seeded artwork; native placeholder layout",
            media: "Unavailable synthetic source; route readiness only",
            adminRole: "OPERATIONS",
            cleaned,
            cleanupFailed,
          },
          limits: [
            "Three samples per route/profile are laboratory observations, not field percentiles, production performance or a physical mobile device",
            "Route readiness is an asserted DOM/API milestone; fixed settling and later interactions are separate windows",
            "Browser cache disabled and Service Worker blocked; cold-process startup and route/data cache temperature are not isolated; PWA startup unmeasured",
            "Watch source is unavailable. Media errors remain in report; player DOM does not prove decoded frames, playback startup or successful media delivery",
            "Upload measures workspace readiness and format controls only; no file inspection, byte transfer, processing, resumability or publication timing",
            "Raw trusted-input Event Timing entries above the 16ms observer threshold are not an aggregated INP or field CWV claim; absence is not zero latency",
            "CDP request totals include redirects, errors and in-flight work at each cutoff. Encoded bytes exclude unfinished transfers. Category labels allow attribution without retaining URLs or identities",
            "Browser request counts exclude server-side Next-to-API requests and do not measure DB query counts, plans, connection pressure or production scalability",
            "TTFB follows Navigation Timing; the pinned compatibility network emulation can delay delivery without changing responseStart as described in the original lab calibration",
            "No credentials, headers, storage state, request/response bodies, fixture identifiers or query text are written to reports",
            "No product optimization or before/after improvement is inferred from this baseline",
          ],
          samples,
        };
        const reportFamily = changedRoutesOnly ? "changed-routes" : "product";
        const filename = testInfo.outputPath(
          `performance-baseline-${reportFamily}-${profile.name}.json`,
        );
        await writeFile(filename, JSON.stringify(report, null, 2) + "\n");
        await testInfo.attach(`runtime-product-${profile.name}`, {
          path: filename,
          contentType: "application/json",
        });
      }
    }
    if (cleanupFailure) throw cleanupFailure;
  });
