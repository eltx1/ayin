import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test as base, type APIResponse, type Page } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
interface Catalog {
  fixtureId: string;
  accountId: string;
  profileId: string;
  alternateProfileId: string;
  email: string;
  password: string;
  videos: Record<"adult" | "kids", { id: string; title: string; slug: string }>;
}
function fixture<T = { ok: boolean }>(command: string, payload: object = {}): T {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/search-viewer-fixture.mjs"), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
const test = base.extend<{ catalog: Catalog }>({
  catalog: async ({ baseURL }, use) => {
    if (!baseURL) throw new Error("The standard Playwright baseURL is required.");
    const catalog = fixture<Catalog>("seed");
    try {
      await use(catalog);
    } finally {
      fixture("cleanup", { fixtureId: catalog.fixtureId });
    }
  },
});
test.use({ serviceWorkers: "block" });
const main = (page: Page) => page.locator("main:visible");
const mutate = (catalog: Catalog, command: string, input: object) =>
  fixture(command, { fixtureId: catalog.fixtureId, ...input });
async function login(page: Page, catalog: Catalog) {
  expect(
    (
      await page.request.post(`${API}/auth/login`, {
        headers: { origin: WEB },
        data: { email: catalog.email, password: catalog.password },
      })
    ).status(),
  ).toBe(200);
}
function watch(page: Page, catalog: Catalog, kind: "adult" | "kids", kids = false) {
  return page.goto(`/watch/${catalog.videos[kind].slug}?lang=en${kids ? "&kids=1" : ""}`);
}
async function noGeneralAffordances(page: Page) {
  await expect(main(page).locator('a[href^="/c/"], a[href*="/series/"]')).toHaveCount(0);
  await expect(main(page).locator("summary").filter({ hasText: "Comments" })).toHaveCount(0);
  await expect(main(page).getByRole("button", { name: /Like|Watch later|My list/i })).toHaveCount(
    0,
  );
}
async function holdPlayback(page: Page, slug: string) {
  let receive!: (response: APIResponse) => void;
  let release!: () => void;
  let finish!: () => void;
  const response = new Promise<APIResponse>((resolve) => {
    receive = resolve;
  });
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let used = false;
  await page.route(`${API}/public/videos/${slug}/playback*`, async (route) => {
    if (used) return route.continue();
    used = true;
    try {
      const actual = await route.fetch();
      receive(actual);
      await opened;
      await route.fulfill({ response: actual }).catch((error: Error) => {
        if (!/aborted|Invalid InterceptionId|already handled|Target.*closed/i.test(error.message))
          throw error;
      });
    } finally {
      finish();
    }
  });
  return { response, release, done };
}

// Auth, audience policy and playback responses use the actual API/database.
// Only decoder timing is controlled here; this is not decoded-media evidence.
async function mediaHarness(page: Page, deferPlayUntilReady = false) {
  await page.addInitScript((deferPlayUntilReady) => {
    type Media = HTMLMediaElement & { _time?: number; _paused?: boolean; _ready?: number };
    Object.defineProperties(HTMLMediaElement.prototype, {
      currentTime: {
        configurable: true,
        get() {
          return (this as Media)._time ?? 0;
        },
        set(value: number) {
          (this as Media)._time = value;
        },
      },
      duration: {
        configurable: true,
        get() {
          return 120;
        },
      },
      readyState: {
        configurable: true,
        get() {
          return (this as Media)._ready ?? 0;
        },
      },
      paused: {
        configurable: true,
        get() {
          return (this as Media)._paused ?? true;
        },
      },
    });
    HTMLMediaElement.prototype.load = function () {
      (this as Media)._time = 0;
      (this as Media)._ready = 0;
    };
    HTMLMediaElement.prototype.play = function () {
      const play = () => {
        (this as Media)._paused = false;
        this.dispatchEvent(new Event("play"));
      };
      if (deferPlayUntilReady && this.readyState < 1)
        return new Promise<void>((resolve) =>
          this.addEventListener(
            "canplay",
            () => {
              play();
              resolve();
            },
            { once: true },
          ),
        );
      play();
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      (this as Media)._paused = true;
      this.dispatchEvent(new Event("pause"));
    };
  }, deferPlayUntilReady);
  await page.route("http://media.invalid/**", (route) => route.abort());
}
async function ready(page: Page) {
  await page.locator("video:visible").evaluate((video: HTMLVideoElement & { _ready?: number }) => {
    video._ready = 4;
    video.dispatchEvent(new Event("loadedmetadata"));
    video.dispatchEvent(new Event("canplay"));
  });
}
async function currentTime(page: Page) {
  return page.locator("video:visible").evaluate((video: HTMLVideoElement) => video.currentTime);
}

test("authenticated Kids ordinary Watch deep link never embeds or requests the adult source", async ({
  page,
  catalog,
}, testInfo) => {
  mutate(catalog, "default-kids", { isKids: true });
  await login(page, catalog);
  const restricted: string[] = [];
  page.on("request", (request) => {
    if (/\/ads\/(video|page)\/|\/(comments|social)\/|e2e\/search-viewer\//.test(request.url()))
      restricted.push(request.url());
  });
  const response = await watch(page, catalog, "adult");
  const html = await response!.text();
  expect(html).not.toContain(catalog.videos.adult.title);
  expect(html).not.toContain(`e2e/search-viewer/${catalog.fixtureId}/adult.mp4`);
  expect(html).not.toContain("VideoObject");
  // Neutral Watch inherits the generic root-layout graph. It must not add
  // video-specific structured data before the current audience is verified.
  const structuredData = Array.from(
    html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
    (match) => JSON.parse(match[1]!) as unknown,
  );
  const schemaTypes = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.flatMap(schemaTypes);
    if (value === null || typeof value !== "object") return [];
    return Object.entries(value).flatMap(([key, nested]) =>
      key === "@type" ? [String(nested)] : schemaTypes(nested),
    );
  };
  expect(structuredData.flatMap(schemaTypes).sort()).toEqual([
    "ImageObject",
    "Organization",
    "WebSite",
  ]);
  await expect(
    main(page).getByRole("heading", { name: "Nothing here yet", exact: true }),
  ).toBeVisible();
  await expect(main(page).locator("video")).toHaveCount(0);
  await noGeneralAffordances(page);
  expect(restricted).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("watch-kids-ordinary-deep-link-neutral.png"),
    fullPage: true,
  });
});

test("same-profile Kids change after auth is governed by authoritative playback policy", async ({
  page,
  catalog,
}) => {
  await login(page, catalog);
  let changed = false;
  const restricted: string[] = [];
  page.on("request", (request) => {
    if (/\/ads\/(video|page)\/|\/(comments|social)\//.test(request.url()))
      restricted.push(request.url());
  });
  await page.route(`${API}/public/videos/${catalog.videos.kids.slug}/playback*`, async (route) => {
    expect(new URL(route.request().url()).searchParams.get("expectedProfileId")).toBe(
      catalog.profileId,
    );
    expect(route.request().headers()["x-ayin-expected-account"]).toBe(catalog.accountId);
    if (!changed) {
      changed = true;
      mutate(catalog, "default-kids", { isKids: true });
    }
    await route.continue();
  });
  await watch(page, catalog, "kids");
  await expect(
    main(page).getByRole("heading", { name: catalog.videos.kids.title, exact: true }),
  ).toBeVisible();
  await noGeneralAffordances(page);
  for (const href of await main(page)
    .locator('a[href*="/watch/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href"))))
    expect(href).toContain("kids=1");
  expect(restricted).toEqual([]);
});

test("anonymous general playback remains available and explicit Kids remains restrictive", async ({
  page,
  catalog,
}) => {
  await watch(page, catalog, "adult");
  await expect(
    main(page).getByRole("heading", { name: catalog.videos.adult.title, exact: true }),
  ).toBeVisible();
  await expect(main(page).locator("video")).toHaveCount(1);
  await watch(page, catalog, "adult", true);
  await expect(
    main(page).getByRole("heading", { name: "Nothing here yet", exact: true }),
  ).toBeVisible();
  await expect(main(page).locator("video")).toHaveCount(0);
  await watch(page, catalog, "kids", true);
  await expect(
    main(page).getByRole("heading", { name: catalog.videos.kids.title, exact: true }),
  ).toBeVisible();
  await noGeneralAffordances(page);
});

for (const transition of ["profile", "account"] as const) {
  test(`late adult playback cannot escape a ${transition} change to Kids`, async ({
    page,
    catalog,
  }) => {
    const next = transition === "account" ? fixture<Catalog>("seed") : catalog;
    await login(page, catalog);
    const gate = await holdPlayback(page, catalog.videos.adult.slug);
    try {
      await watch(page, catalog, "adult");
      expect((await gate.response).status()).toBe(200);
      await expect(main(page).locator("video")).toHaveCount(0);
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      if (transition === "profile") mutate(catalog, "switch-default", { alternate: true });
      mutate(next, "default-kids", { isKids: true });
      if (transition === "account") await login(page, next);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(
        main(page).getByRole("heading", { name: "Nothing here yet", exact: true }),
      ).toBeVisible();
      gate.release();
      await gate.done;
      await expect(
        main(page).getByRole("heading", { name: catalog.videos.adult.title, exact: true }),
      ).toHaveCount(0);
      await expect(main(page).locator("video")).toHaveCount(0);
    } finally {
      gate.release();
      if (transition === "account") fixture("cleanup", { fixtureId: next.fixtureId });
    }
  });
}

test("mounted Watch conceals and releases its source synchronously before Kids revalidation", async ({
  page,
  catalog,
}, testInfo) => {
  await mediaHarness(page);
  await login(page, catalog);
  await watch(page, catalog, "adult");
  await expect(
    main(page).getByRole("heading", { name: catalog.videos.adult.title, exact: true }),
  ).toBeVisible();
  await ready(page);
  const immediate = await page
    .locator("video:visible")
    .evaluate(async (video: HTMLVideoElement) => {
      video.currentTime = 37;
      await video.play();
      const root = video.closest<HTMLElement>("[data-private-viewer-state]")!;
      window.dispatchEvent(new Event("blur"));
      return {
        concealed: !root.checkVisibility(),
        paused: video.paused,
        source: video.getAttribute("src"),
      };
    });
  expect(immediate).toEqual({ concealed: true, paused: true, source: null });
  mutate(catalog, "default-kids", { isKids: true });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    main(page).getByRole("heading", { name: "Nothing here yet", exact: true }),
  ).toBeVisible();
  await expect(main(page).locator("video")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("watch-profile-change-releases-source.png"),
    fullPage: true,
  });
});

test("same viewer revalidation preserves intentional seek to zero even when checkpoint fails", async ({
  page,
  catalog,
}) => {
  await mediaHarness(page);
  await login(page, catalog);
  expect(
    (
      await page.request.put(`${API}/watch/progress/${catalog.videos.adult.id}`, {
        headers: { origin: WEB, "x-ayin-expected-account": catalog.accountId },
        data: { profileId: catalog.profileId, positionMs: 42000, durationMs: 120000 },
      })
    ).status(),
  ).toBe(200);
  await page.route(`${API}/watch/progress/${catalog.videos.adult.id}*`, (route) =>
    route.request().method() === "PUT" ? route.abort("failed") : route.continue(),
  );
  await watch(page, catalog, "adult");
  await expect(
    main(page).getByRole("heading", { name: catalog.videos.adult.title, exact: true }),
  ).toBeVisible();
  await ready(page);
  await expect.poll(() => currentTime(page)).toBe(42);
  await page.locator(`[data-tv-focus-id="player-seek-${catalog.videos.adult.id}"]`).focus();
  await page.keyboard.press("Home");
  await expect.poll(() => currentTime(page)).toBe(0);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(
    main(page).getByRole("heading", { name: catalog.videos.adult.title, exact: true }),
  ).toBeVisible();
  await ready(page);
  await expect.poll(() => currentTime(page)).toBe(0);
});

test("persistent audience conflicts stop after one automatic revalidation and support explicit retry", async ({
  page,
  catalog,
}) => {
  await login(page, catalog);
  let requests = 0;
  await page.route(`${API}/public/videos/${catalog.videos.adult.slug}/playback*`, (route) => {
    requests++;
    return route.fulfill({ status: 409, json: { error: { code: "PLAYBACK_VIEWER_CHANGED" } } });
  });
  await watch(page, catalog, "adult");
  await expect(
    main(page).getByRole("heading", { name: "Video unavailable", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(300);
  expect(requests).toBe(2);
  await expect(main(page).locator("video")).toHaveCount(0);
  await main(page).getByRole("button", { name: "Try again", exact: true }).click();
  await expect.poll(() => requests).toBe(4);
  await expect(
    main(page).getByRole("heading", { name: "Video unavailable", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(300);
  expect(requests).toBe(4);
});

interface PlaybackEvent {
  eventName: string;
  videoId?: string;
  positionMs?: number;
  durationDeltaMs?: number;
}
async function observeAcceptedAnalytics(page: Page) {
  const events: PlaybackEvent[] = [];
  await page.route(`${API}/analytics/events`, async (route) => {
    const payload = route.request().postDataJSON() as { events: PlaybackEvent[] };
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    expect((await response.json()).accepted).toBe(payload.events.length);
    events.push(...payload.events);
    await route.fulfill({ response });
  });
  return events;
}
const countEvent = (events: PlaybackEvent[], videoId: string, name: string) =>
  events.filter((event) => event.videoId === videoId && event.eventName === name).length;
async function checkpointAt(page: Page, videoId: string, seconds: number) {
  const response = page.waitForResponse(
    (response) =>
      response.url().includes(`/watch/progress/${videoId}`) &&
      response.request().method() === "PUT",
  );
  await page.locator("video:visible").evaluate((video: HTMLVideoElement, seconds) => {
    video.currentTime = seconds;
    video.pause();
  }, seconds);
  expect((await response).status()).toBe(200);
}

test("same-viewer source revalidation keeps one impression/start and grants no credit for seeks", async ({
  page,
  catalog,
}) => {
  await mediaHarness(page);
  const events = await observeAcceptedAnalytics(page);
  await login(page, catalog);
  await watch(page, catalog, "adult");
  await expect(
    main(page).getByRole("heading", { name: catalog.videos.adult.title, exact: true }),
  ).toBeVisible();
  await ready(page);
  await expect.poll(() => countEvent(events, catalog.videos.adult.id, "VIDEO_START")).toBe(1);
  expect(countEvent(events, catalog.videos.adult.id, "CONTENT_IMPRESSION")).toBe(1);
  await page.locator('[data-player-stage="true"]:visible').focus();
  for (let seek = 0; seek < 3; seek++) await page.keyboard.press("ArrowRight");
  await expect.poll(() => currentTime(page)).toBe(30);
  await checkpointAt(page, catalog.videos.adult.id, 30);
  await expect
    .poll(() =>
      events.filter(
        (event) =>
          event.videoId === catalog.videos.adult.id && event.eventName === "VIDEO_PROGRESS",
      ),
    )
    .toEqual([expect.objectContaining({ positionMs: 30000, durationDeltaMs: 0 })]);
  await page.locator("video:visible").evaluate((video: HTMLVideoElement) => video.play());
  const gate = await holdPlayback(page, catalog.videos.adult.slug);
  try {
    const stopped = await page.locator("video:visible").evaluate((video: HTMLVideoElement) => {
      const root = video.closest<HTMLElement>("[data-private-viewer-state]")!;
      window.dispatchEvent(new Event("blur"));
      return {
        hidden: !root.checkVisibility(),
        source: video.getAttribute("src"),
        paused: video.paused,
      };
    });
    expect(stopped).toEqual({ hidden: true, source: null, paused: true });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    expect((await gate.response).status()).toBe(200);
    await expect(main(page).locator("video")).toHaveCount(0);
    gate.release();
    await gate.done;
    await expect(
      main(page).getByRole("heading", { name: catalog.videos.adult.title, exact: true }),
    ).toBeVisible();
    await ready(page);
    await expect.poll(() => currentTime(page)).toBe(30);
    await expect
      .poll(() => page.locator("video:visible").evaluate((video: HTMLVideoElement) => video.paused))
      .toBe(false);
    await checkpointAt(page, catalog.videos.adult.id, 31);
    await expect
      .poll(() =>
        events.filter(
          (event) =>
            event.videoId === catalog.videos.adult.id && event.eventName === "VIDEO_PROGRESS",
        ),
      )
      .toEqual([
        expect.objectContaining({ positionMs: 30000, durationDeltaMs: 0 }),
        expect.objectContaining({ positionMs: 31000, durationDeltaMs: 1000 }),
      ]);
    expect(countEvent(events, catalog.videos.adult.id, "CONTENT_IMPRESSION")).toBe(1);
    expect(countEvent(events, catalog.videos.adult.id, "VIDEO_START")).toBe(1);
  } finally {
    gate.release();
  }
});

test("verified profile/account changes and a replacement video at the same slug get fresh accounting", async ({
  page,
  catalog,
}) => {
  const next = fixture<Catalog>("seed");
  // Reauthored reset coverage: ephemeral presentation belongs to the verified
  // viewer and actual video just like accounting; it must not cross either.
  const customizePresentation = async () => {
    await page.getByLabel("Playback speed", { exact: true }).selectOption("1.5");
    await page.locator("video:visible").evaluate((video: HTMLVideoElement) => {
      video.volume = 0.23;
    });
  };
  const expectDefaultPresentation = () =>
    expect
      .poll(() =>
        page.locator("video:visible").evaluate((video: HTMLVideoElement) => ({
          rate: video.playbackRate,
          volume: video.volume,
        })),
      )
      .toEqual({ rate: 1, volume: 1 });
  try {
    await mediaHarness(page);
    const events = await observeAcceptedAnalytics(page);
    await login(page, catalog);
    await watch(page, catalog, "adult");
    await expect(
      main(page).getByRole("heading", { name: catalog.videos.adult.title, exact: true }),
    ).toBeVisible();
    await ready(page);
    await expect.poll(() => countEvent(events, catalog.videos.adult.id, "VIDEO_START")).toBe(1);
    for (const [index, change] of ["profile", "account"].entries()) {
      await customizePresentation();
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      if (change === "profile") mutate(catalog, "switch-default", { alternate: true });
      else await login(page, next);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(
        main(page).getByRole("heading", { name: catalog.videos.adult.title, exact: true }),
      ).toBeVisible();
      await ready(page);
      await expectDefaultPresentation();
      await expect
        .poll(() => countEvent(events, catalog.videos.adult.id, "VIDEO_START"))
        .toBe(index + 2);
      expect(countEvent(events, catalog.videos.adult.id, "CONTENT_IMPRESSION")).toBe(index + 2);
    }
    // Even a replacement viewer denied playback must retire the prior scope.
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    mutate(catalog, "default-kids", { isKids: true });
    await login(page, catalog);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      main(page).getByRole("heading", { name: "Nothing here yet", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await login(page, next);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      main(page).getByRole("heading", { name: catalog.videos.adult.title, exact: true }),
    ).toBeVisible();
    await ready(page);
    await expect.poll(() => countEvent(events, catalog.videos.adult.id, "VIDEO_START")).toBe(4);
    expect(countEvent(events, catalog.videos.adult.id, "CONTENT_IMPRESSION")).toBe(4);

    // Paused intent belongs to this actual video, not its stable slug.
    await customizePresentation();
    await page.locator("video:visible").evaluate((video: HTMLVideoElement) => video.pause());
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    const replacement = fixture<Catalog>("swap-video-slugs", { fixtureId: catalog.fixtureId });
    expect(replacement.videos.adult.slug).toBe(catalog.videos.adult.slug);
    expect(replacement.videos.adult.id).not.toBe(catalog.videos.adult.id);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      main(page).getByRole("heading", { name: replacement.videos.adult.title, exact: true }),
    ).toBeVisible();
    await ready(page);
    await expectDefaultPresentation();
    await expect.poll(() => countEvent(events, replacement.videos.adult.id, "VIDEO_START")).toBe(1);
    expect(countEvent(events, replacement.videos.adult.id, "CONTENT_IMPRESSION")).toBe(1);
    expect(countEvent(events, catalog.videos.adult.id, "VIDEO_START")).toBe(4);
  } finally {
    fixture("cleanup", { fixtureId: next.fixtureId });
  }
});

test("same-viewer focus preserves a deliberate pause until the viewer presses play", async ({
  page,
  catalog,
}) => {
  await mediaHarness(page);
  await login(page, catalog);
  await watch(page, catalog, "adult");
  await expect(
    main(page).getByRole("heading", { name: catalog.videos.adult.title, exact: true }),
  ).toBeVisible();
  await ready(page);
  await expect
    .poll(() => page.locator("video:visible").evaluate((video: HTMLVideoElement) => video.paused))
    .toBe(false);
  await page.locator("video:visible").evaluate((video: HTMLVideoElement) => video.pause());
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(
    main(page).getByRole("heading", { name: catalog.videos.adult.title, exact: true }),
  ).toBeVisible();
  await ready(page);
  // Let any queued player activation run before verifying retained pause.
  await page.waitForTimeout(100);
  await expect
    .poll(() => page.locator("video:visible").evaluate((video: HTMLVideoElement) => video.paused))
    .toBe(true);
  await page.locator('[data-player-stage="true"]:visible').focus();
  await page.keyboard.press("Space");
  await expect
    .poll(() => page.locator("video:visible").evaluate((video: HTMLVideoElement) => video.paused))
    .toBe(false);
});

test("same-viewer focus before metadata preserves the initial autoplay intent", async ({
  page,
  catalog,
}) => {
  await mediaHarness(page, true);
  await login(page, catalog);
  await watch(page, catalog, "adult");
  await expect(
    main(page).getByRole("heading", { name: catalog.videos.adult.title, exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.locator("video:visible").evaluate((video: HTMLVideoElement) => video.readyState),
    )
    .toBe(0);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(
    main(page).getByRole("heading", { name: catalog.videos.adult.title, exact: true }),
  ).toBeVisible();
  await ready(page);
  await expect
    .poll(() => page.locator("video:visible").evaluate((video: HTMLVideoElement) => video.paused))
    .toBe(false);
});

async function holdProgressRead(page: Page, videoId: string, ordinal: number) {
  let count = 0;
  let received!: (response: APIResponse) => void;
  let release!: () => void;
  let finished!: () => void;
  const response = new Promise<APIResponse>((resolve) => {
    received = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await page.route(`${API}/watch/progress/${videoId}*`, async (route) => {
    if (route.request().method() !== "GET" || ++count !== ordinal) return route.continue();
    try {
      const actual = await route.fetch();
      received(actual);
      await held;
      await route.fulfill({ response: actual }).catch((error: Error) => {
        if (!/aborted|Invalid InterceptionId|already handled|Target.*closed/i.test(error.message))
          throw error;
      });
    } finally {
      finished();
    }
  });
  return { response, release, done };
}
async function seedSavedPosition(page: Page, catalog: Catalog, positionMs: number) {
  const response = await page.request.put(`${API}/watch/progress/${catalog.videos.adult.id}`, {
    headers: { origin: WEB, "x-ayin-expected-account": catalog.accountId },
    data: { profileId: catalog.profileId, positionMs, durationMs: 120000 },
  });
  expect(response.status()).toBe(200);
}

test("metadata-ready zero before a held saved17 read cannot override fresh resume after focus", async ({
  page,
  catalog,
}) => {
  await mediaHarness(page);
  await login(page, catalog);
  await seedSavedPosition(page, catalog, 17000);
  const gate = await holdProgressRead(page, catalog.videos.adult.id, 1);
  try {
    await watch(page, catalog, "adult");
    expect((await (await gate.response).json()).positionMs).toBe(17000);
    await ready(page);
    expect(await currentTime(page)).toBe(0);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    await expect(
      main(page).getByRole("heading", { name: catalog.videos.adult.title, exact: true }),
    ).toBeVisible();
    await ready(page);
    await expect.poll(() => currentTime(page)).toBe(17);
    gate.release();
    await gate.done;
    await expect.poll(() => currentTime(page)).toBe(17);
    const saved = await page.request.get(
      `${API}/watch/progress/${catalog.videos.adult.id}?profileId=${catalog.profileId}`,
    );
    expect((await saved.json()).positionMs).toBe(17000);
  } finally {
    gate.release();
  }
});

test("repeated early focus preserves a prior intentional zero while replacement progress is held", async ({
  page,
  catalog,
}) => {
  await mediaHarness(page);
  await login(page, catalog);
  await seedSavedPosition(page, catalog, 17000);
  const gate = await holdProgressRead(page, catalog.videos.adult.id, 2);
  await page.route(`${API}/watch/progress/${catalog.videos.adult.id}*`, (route) =>
    route.request().method() === "PUT" ? route.abort("failed") : route.fallback(),
  );
  try {
    await watch(page, catalog, "adult");
    await ready(page);
    await expect.poll(() => currentTime(page)).toBe(17);
    await page.locator(`[data-tv-focus-id="player-seek-${catalog.videos.adult.id}"]`).focus();
    await page.keyboard.press("Home");
    await expect.poll(() => currentTime(page)).toBe(0);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    expect((await (await gate.response).json()).positionMs).toBe(17000);
    // The replacement has not received metadata or its resume response. Its
    // default zero is not allowed to erase the retained explicit zero's intent.
    await expect
      .poll(() =>
        page.locator("video:visible").evaluate((video: HTMLVideoElement) => video.readyState),
      )
      .toBe(0);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    await expect(
      main(page).getByRole("heading", { name: catalog.videos.adult.title, exact: true }),
    ).toBeVisible();
    await ready(page);
    await expect.poll(() => currentTime(page)).toBe(0);
    gate.release();
    await gate.done;
    await expect.poll(() => currentTime(page)).toBe(0);
    const saved = await page.request.get(
      `${API}/watch/progress/${catalog.videos.adult.id}?profileId=${catalog.profileId}`,
    );
    expect((await saved.json()).positionMs).toBe(17000);
  } finally {
    gate.release();
  }
});
