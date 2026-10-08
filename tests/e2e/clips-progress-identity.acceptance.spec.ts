import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  expect,
  test,
  type APIResponse,
  type ElementHandle,
  type Page,
  type Route,
} from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
const seededClipIds = new Set<string>();

test.use({
  serviceWorkers: "block",
  contextOptions: { reducedMotion: "reduce" },
  viewport: { width: 1440, height: 900 },
});

test.afterEach(() => {
  if (!seededClipIds.size) return;
  const videoIds = [...seededClipIds];
  const result = fixture<{ count: number }>("hide-clips", { videoIds });
  expect(result.count).toBe(videoIds.length);
  seededClipIds.clear();
});

interface Identity {
  account: { id: string; displayName: string };
  profile: { id: string };
}
interface Clip {
  id: string;
  slug: string;
  title: string;
}
interface Rows {
  progress: { profileId: string; videoId: string; positionMs: number }[];
  history: { profileId: string; videoId: string; viewCount: number }[];
}
interface ProgressRequest {
  method: string;
  keepalive: boolean;
  aborted: boolean;
  accountId: string | null;
  profileId: string | null;
  positionMs?: number;
  expectedRevision?: string | null;
  status?: number;
}
function fixture<T>(command: string, input: object = {}): T {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/player-progress-fixture.mjs"), command, JSON.stringify(input)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
function seedClips(): Clip[] {
  // Require the isolated test database even though the shared seed helper also
  // supports DATABASE_URL. Every account in this suite is synthetic.
  if (!process.env.TEST_DATABASE_URL) throw new Error("An isolated TEST_DATABASE_URL is required.");
  const clips = JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/db-helper.mjs"), "seed-clips-viewer", "{}"],
      { env: process.env, encoding: "utf8" },
    ),
  ).items as Clip[];
  for (const clip of clips) seededClipIds.add(clip.id);
  return clips;
}
function rows(clip: Clip): Rows {
  return fixture<Rows>("rows", { videoId: clip.id });
}
function media(page: Page, clip: Clip) {
  return page.locator(`[data-clip-item='true'][data-video-id='${clip.id}'] video`);
}
async function register(page: Page, label: string): Promise<Identity> {
  const suffix = `clips-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: {
      name: `Progress ${suffix}`,
      email: `progress-${suffix}@example.test`,
      password: "strong-pass-123",
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).user;
}
async function seedProgress(page: Page, clip: Clip, identity: Identity, positionMs: number) {
  const response = await page.request.put(`${API}/watch/progress/${clip.id}`, {
    headers: { origin: WEB, "x-ayin-expected-account": identity.account.id },
    data: { profileId: identity.profile.id, positionMs, durationMs: 30_000 },
  });
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ revision: string }>;
}
// Real browser, auth cookies, API and PostgreSQL; only media decoding/readiness
// and timing are controlled. This is not decoded-playback or device coverage.
async function mediaHarness(page: Page, resetOnLoad = false, nativeSeeking = false) {
  await page.addInitScript(
    ({ reset, nativeSeeking }) => {
      type Media = HTMLMediaElement & { _time?: number; _paused?: boolean; _ready?: number };
      const nativeSeeks: { videoId: string | null; position: number }[] = [];
      Object.assign(window, { clipsNativeSeeks: nativeSeeks });
      Object.defineProperties(HTMLMediaElement.prototype, {
        currentTime: {
          configurable: true,
          get() {
            return (this as Media)._time ?? 0;
          },
          set(value: number) {
            (this as Media)._time = value;
            if (nativeSeeking && this.readyState >= 1) {
              const video = this as HTMLMediaElement;
              // Browsers dispatch seeking asynchronously for both script-owned
              // resume/reset assignments and deliberate native-control seeks.
              queueMicrotask(() => {
                nativeSeeks.push({
                  videoId: video.closest("[data-video-id]")?.getAttribute("data-video-id") ?? null,
                  position: video.currentTime,
                });
                video.dispatchEvent(new Event("seeking"));
                video.dispatchEvent(new Event("seeked"));
              });
            }
          },
        },
        duration: {
          configurable: true,
          get() {
            return 30;
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
      const lifecycle = { loadCalls: 0, releaseLoads: 0 };
      Object.assign(window, { clipsMediaLifecycle: lifecycle });
      HTMLMediaElement.prototype.load = function () {
        lifecycle.loadCalls++;
        if (!this.getAttribute("src")) lifecycle.releaseLoads++;
        if (reset) {
          (this as Media)._time = 0;
          (this as Media)._ready = 0;
        }
      };
      HTMLMediaElement.prototype.play = function () {
        (this as Media)._paused = false;
        this.dispatchEvent(new Event("play"));
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function () {
        if (this.paused) return;
        (this as Media)._paused = true;
        this.dispatchEvent(new Event("pause"));
      };
      const original = window.fetch;
      const pending = new Set<Promise<unknown>>();
      const requests: ProgressRequest[] = [];
      Object.assign(window, { clipsProgressPending: pending, clipsProgressRequests: requests });
      window.fetch = (...args) => {
        const promise = original(...args);
        if (String(args[0]).includes("/watch/progress/")) {
          const init = args[1];
          const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
          const recorded: ProgressRequest = {
            method: init?.method ?? "GET",
            keepalive: init?.keepalive ?? false,
            aborted: Boolean(init?.signal?.aborted),
            accountId: new Headers(init?.headers).get("x-ayin-expected-account"),
            profileId:
              body?.profileId ??
              new URL(String(args[0]), location.href).searchParams.get("profileId"),
            ...(body
              ? { positionMs: body.positionMs, expectedRevision: body.expectedRevision }
              : {}),
          };
          requests.push(recorded);
          init?.signal?.addEventListener(
            "abort",
            () => {
              recorded.aborted = true;
            },
            { once: true },
          );
          pending.add(promise);
          void promise.then(
            (response) => {
              recorded.status = response.status;
              pending.delete(promise);
            },
            () => pending.delete(promise),
          );
        }
        return promise;
      };
    },
    { reset: resetOnLoad, nativeSeeking },
  );
  await page.route("http://media.invalid/**", (route) => route.abort());
  await page.route("**/media-test/**", (route) => route.abort());
}
async function settle(page: Page) {
  await page.evaluate(async () => {
    // Promise continuations may enqueue a reconciliation read or queued write.
    for (let pass = 0; pass < 3; pass++) {
      await Promise.allSettled([
        ...(window as unknown as { clipsProgressPending: Set<Promise<unknown>> })
          .clipsProgressPending,
      ]);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    }
  });
}
async function ready(page: Page, clip: Clip) {
  await media(page, clip).evaluate((video: HTMLVideoElement & { _ready?: number }) => {
    video._ready = 4;
    video.dispatchEvent(new Event("loadedmetadata"));
    video.dispatchEvent(new Event("canplay"));
  });
}
async function position(page: Page, clip: Clip, value?: number, event?: string) {
  // A nonzero test checkpoint represents actual viewing by the current owner,
  // not metadata-only resume on an offscreen element. Pure native seek tests
  // assign currentTime directly below so they prove the seek-only path too.
  if (
    value !== undefined &&
    (await media(page, clip).evaluate((video: HTMLVideoElement) => video.paused))
  )
    await page.locator(`[data-tv-focus-id="clip-${clip.id}-play"]`).click();
  return media(page, clip).evaluate(
    (video: HTMLVideoElement, input) => {
      if (input.value !== undefined) video.currentTime = input.value;
      if (input.event) video.dispatchEvent(new Event(input.event));
      return video.currentTime;
    },
    { value, event },
  );
}
async function refocus(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}
async function openClips(page: Page, clip: Clip, resetOnLoad = false, nativeSeeking = false) {
  const current = await page.request.get(`${API}/auth/me`);
  expect(current.status()).toBe(200);
  const identity = (await current.json()) as Identity;
  await mediaHarness(page, resetOnLoad, nativeSeeking);
  await page.goto("/clips?lang=en");
  await expect(page.getByRole("heading", { name: "AYIN Clips", exact: true })).toBeVisible();
  await expect(media(page, clip)).toHaveCount(1);
  await expect(page.locator("[data-private-viewer-identity]:visible")).toContainText(
    identity.account.displayName,
  );
}

test("Clips baseline: a silent shared-cookie switch never writes A playback into B", async ({
  page,
  context,
}) => {
  const [clip] = seedClips();
  await register(page, "silent-a");
  await openClips(page, clip);
  await settle(page);
  await ready(page, clip);
  await position(page, clip, 17);
  const other = await context.newPage();
  const b = await register(other, "silent-b");
  // Cookie replacement is real and intentionally has no focus/identity signal.
  await position(page, clip, undefined, "pause");
  await settle(page);
  expect(rows(clip).progress.filter((row) => row.profileId === b.profile.id)).toEqual([]);
  expect(rows(clip).history.filter((row) => row.profileId === b.profile.id)).toEqual([]);
});

async function requestLog(page: Page) {
  return page.evaluate(
    () => (window as unknown as { clipsProgressRequests: ProgressRequest[] }).clipsProgressRequests,
  );
}
async function fulfillHeld(route: Route, response: APIResponse) {
  await route.fulfill({ response }).catch((error: Error) => {
    if (!/aborted|Invalid InterceptionId|already handled|Target.*closed/i.test(error.message))
      throw error;
  });
}
function holdRead(page: Page, clip: Clip) {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured: APIResponse | undefined;
  let used = false;
  const setup = page.route(`${API}/watch/progress/${clip.id}*`, async (route) => {
    if (used || route.request().method() !== "GET") return route.continue();
    used = true;
    captured = await route.fetch();
    await waiting;
    await fulfillHeld(route, captured);
  });
  return { setup, release: () => release(), captured: () => captured };
}
function nextProgressRead(page: Page, clip: Clip) {
  return page.waitForResponse(
    (response) =>
      response.url().includes(`/watch/progress/${clip.id}`) &&
      response.request().method() === "GET",
  );
}

function nextOwnerClipRead(page: Page, identity: Identity) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/public/clips" &&
      url.searchParams.get("expectedProfileId") === identity.profile.id &&
      response.request().headers()["x-ayin-expected-account"] === identity.account.id &&
      response.status() === 200
    );
  });
}

async function expectRetiredClipOwner(page: Page, clip: Clip, retired: ElementHandle) {
  const retirement = await retired.evaluate((node) => {
    const video = node as HTMLVideoElement;
    return {
      connected: video.isConnected,
      hasSource: video.hasAttribute("src"),
      paused: video.paused,
    };
  });
  expect(retirement).toEqual({ connected: false, hasSource: false, paused: true });
  expect(await media(page, clip).evaluate((current, old) => current !== old, retired)).toBe(true);
  // Metadata must not reapply the retired owner's time while B's saved read is held.
  await ready(page, clip);
  await expect.poll(() => position(page, clip)).toBe(0);
  return { ...retirement, replacementIsDifferent: true };
}

test("retained Clips reset old time when focus verifies a different real account", async ({
  page,
  context,
}) => {
  const [clip] = seedClips();
  const a = await register(page, "focus-a");
  await seedProgress(page, clip, a, 17_000);
  await openClips(page, clip);
  await settle(page);
  await ready(page, clip);
  await expect.poll(() => position(page, clip)).toBe(17);
  const other = await context.newPage();
  const b = await register(other, "focus-b");
  await refocus(page);
  await expect(page.locator("[data-private-viewer-identity]:visible")).toContainText(
    b.account.displayName,
  );
  await settle(page);
  await ready(page, clip);
  await expect.poll(() => position(page, clip)).toBe(0);
  await position(page, clip, undefined, "pause");
  await settle(page);
  expect(rows(clip).progress.filter((row) => row.profileId === b.profile.id)).toEqual([]);
  expect(rows(clip).history.filter((row) => row.profileId === b.profile.id)).toEqual([]);
  expect(rows(clip).progress.find((row) => row.profileId === a.profile.id)?.positionMs).toBe(
    17_000,
  );
});

test("Clips profile change resumes only the new profile and saves with its exact scope", async ({
  page,
}) => {
  const [clip] = seedClips();
  const a = await register(page, "profiles");
  await seedProgress(page, clip, a, 17_000);
  await openClips(page, clip);
  await settle(page);
  await ready(page, clip);
  await expect.poll(() => position(page, clip)).toBe(17);
  const second = fixture<{ id: string }>("default-profile", { accountId: a.account.id });
  await seedProgress(page, clip, { ...a, profile: second }, 13_000);
  await refocus(page);
  await settle(page);
  await ready(page, clip);
  await expect.poll(() => position(page, clip)).toBe(13);
  await position(page, clip, 19, "pause");
  await settle(page);
  const saved = rows(clip);
  expect(saved.progress.find((row) => row.profileId === a.profile.id)?.positionMs).toBe(17_000);
  expect(saved.progress.find((row) => row.profileId === second.id)?.positionMs).toBe(19_000);
  expect((await requestLog(page)).filter((item) => item.method === "PUT")).toEqual([
    expect.objectContaining({
      accountId: a.account.id,
      profileId: second.id,
      positionMs: 19_000,
      status: 200,
    }),
  ]);
});

test("a held A Clips progress GET cannot resume or contaminate B", async ({ page, context }) => {
  const [clip] = seedClips();
  const a = await register(page, "late-read-a");
  await seedProgress(page, clip, a, 17_000);
  const held = holdRead(page, clip);
  await held.setup;
  try {
    await openClips(page, clip);
    await expect.poll(() => Boolean(held.captured())).toBe(true);
    expect((await held.captured()!.json()).profileId).toBe(a.profile.id);
    await ready(page, clip);
    const other = await context.newPage();
    const b = await register(other, "late-read-b");
    await seedProgress(other, clip, b, 13_000);
    await refocus(page);
    await expect(page.locator("[data-private-viewer-identity]:visible")).toContainText(
      b.account.displayName,
    );
    held.release();
    await settle(page);
    await ready(page, clip);
    await expect.poll(() => position(page, clip)).toBe(13);
    await position(page, clip, 19, "pause");
    await settle(page);
    expect(rows(clip).progress.find((row) => row.profileId === a.profile.id)?.positionMs).toBe(
      17_000,
    );
    expect(rows(clip).progress.find((row) => row.profileId === b.profile.id)?.positionMs).toBe(
      19_000,
    );
  } finally {
    held.release();
  }
});

test("a held A Clips write ACK cannot block or acknowledge B checkpoints", async ({
  page,
  context,
}) => {
  const [clip] = seedClips();
  const a = await register(page, "late-ack-a");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let aCommitted = false;
  let heldOnce = false;
  await page.route(`${API}/watch/progress/${clip.id}*`, async (route) => {
    if (heldOnce || route.request().method() !== "PUT") return route.continue();
    heldOnce = true;
    const response = await route.fetch();
    expect((await response.json()).profileId).toBe(a.profile.id);
    aCommitted = true;
    await held;
    await fulfillHeld(route, response);
  });
  try {
    await openClips(page, clip);
    await settle(page);
    await ready(page, clip);
    await position(page, clip, 17, "pause");
    await expect.poll(() => aCommitted).toBe(true);
    const other = await context.newPage();
    const b = await register(other, "late-ack-b");
    const bRead = nextProgressRead(page, clip);
    await refocus(page);
    await bRead;
    await expect(page.locator("[data-private-viewer-identity]:visible")).toContainText(
      b.account.displayName,
    );
    await ready(page, clip);
    await position(page, clip, 13, "pause");
    // Do not await all fetches while A's ACK is deliberately held.
    await expect
      .poll(() => rows(clip).progress.find((row) => row.profileId === b.profile.id)?.positionMs)
      .toBe(13_000);
    release();
    await settle(page);
    await position(page, clip, 19, "pause");
    await settle(page);
    expect(rows(clip).progress.find((row) => row.profileId === a.profile.id)?.positionMs).toBe(
      17_000,
    );
    expect(rows(clip).progress.find((row) => row.profileId === b.profile.id)?.positionMs).toBe(
      19_000,
    );
    expect(
      (await requestLog(page))
        .filter((item) => item.method === "PUT")
        .map(({ accountId, profileId, positionMs }) => ({ accountId, profileId, positionMs })),
    ).toEqual([
      { accountId: a.account.id, profileId: a.profile.id, positionMs: 17_000 },
      { accountId: b.account.id, profileId: b.profile.id, positionMs: 13_000 },
      { accountId: b.account.id, profileId: b.profile.id, positionMs: 19_000 },
    ]);
  } finally {
    release();
  }
});

test("Clips freshness: a before-commit delayed checkpoint loses to a newer same-owner API update", async ({
  page,
}) => {
  const [clip] = seedClips();
  const a = await register(page, "before-commit");
  const initial = await seedProgress(page, clip, a, 13_000);
  let progressReads = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && request.url().includes(`/watch/progress/${clip.id}`))
      progressReads++;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured = false;
  const outcomes: {
    positionMs: number;
    expectedRevision?: string | null;
    status: number;
    code?: string;
  }[] = [];
  await page.route(`${API}/watch/progress/${clip.id}*`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const body = route.request().postDataJSON();
    if (!captured) {
      captured = true;
      await held;
    }
    const response = await route.fetch();
    const result = await response.json();
    outcomes.push({
      positionMs: body.positionMs,
      expectedRevision: body.expectedRevision,
      status: response.status(),
      ...(result.error?.code ? { code: result.error.code } : {}),
    });
    await fulfillHeld(route, response);
  });
  try {
    await openClips(page, clip);
    await settle(page);
    await ready(page, clip);
    await expect.poll(() => position(page, clip)).toBe(13);
    const beforeProgressReads = progressReads;
    await position(page, clip, 17, "pause");
    await expect.poll(() => captured).toBe(true);
    const newer = await seedProgress(page, clip, a, 23_000);
    expect(newer.revision).not.toBe(initial.revision);
    const winning = rows(clip);
    const reconciled = nextProgressRead(page, clip);
    release();
    // The explicit checkpoint below proves which revision the browser read;
    // Chromium may release the transient GET body before DevTools reads it.
    expect((await reconciled).status()).toBe(200);
    await settle(page);
    expect(progressReads).toBe(beforeProgressReads + 1);
    expect(outcomes).toEqual([
      {
        positionMs: 17_000,
        expectedRevision: initial.revision,
        status: 409,
        code: "WATCH_PROGRESS_CONFLICT",
      },
    ]);
    expect(rows(clip)).toEqual(winning);
    expect(await position(page, clip)).toBe(17);
    await expect(page.locator("[data-private-viewer-identity]:visible")).toContainText(
      a.account.displayName,
    );
    await position(page, clip, 7, "pause");
    await settle(page);
    expect(outcomes[1]).toEqual({
      positionMs: 7_000,
      expectedRevision: newer.revision,
      status: 200,
    });
    expect(outcomes).toHaveLength(2);
    expect(rows(clip).progress[0]?.positionMs).toBe(7_000);
    expect(rows(clip).history).toEqual(winning.history);
    expect(progressReads).toBe(beforeProgressReads + 1);
  } finally {
    release();
    await test.info().attach("clips-freshness-commit-order", {
      body: JSON.stringify({ outcomes, rows: rows(clip) }),
      contentType: "application/json",
    });
  }
});

test("Clips conflict refresh discards queued intent until a new explicit rewind checkpoint", async ({
  page,
}) => {
  const [clip] = seedClips();
  const a = await register(page, "conflict-rewind");
  let identityReads = 0;
  let progressReads = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured = false;
  const writes: { positionMs: number; expectedRevision: string | null; status: number }[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/auth/me")) identityReads++;
  });
  await page.route(`${API}/watch/progress/${clip.id}*`, async (route) => {
    if (route.request().method() === "GET") {
      progressReads++;
      return route.continue();
    }
    if (route.request().method() !== "PUT") return route.continue();
    const body = route.request().postDataJSON();
    if (!captured) {
      captured = true;
      await held;
    }
    const response = await route.fetch();
    writes.push({
      positionMs: body.positionMs,
      expectedRevision: body.expectedRevision,
      status: response.status(),
    });
    await fulfillHeld(route, response);
  });
  try {
    await openClips(page, clip);
    await settle(page);
    await ready(page, clip);
    const beforeIdentityReads = identityReads;
    const beforeProgressReads = progressReads;
    await position(page, clip, 17, "pause");
    await expect.poll(() => captured).toBe(true);
    await position(page, clip, 19, "pause");
    const newer = await seedProgress(page, clip, a, 23_000);
    const reconciled = nextProgressRead(page, clip);
    release();
    await reconciled;
    await settle(page);
    expect(writes).toEqual([{ positionMs: 17_000, expectedRevision: null, status: 409 }]);
    expect(progressReads).toBe(beforeProgressReads + 1);
    expect(identityReads).toBe(beforeIdentityReads);
    expect(rows(clip).progress[0]?.positionMs).toBe(23_000);
    expect(await position(page, clip)).toBe(19);
    await page.evaluate(() => {
      const now = Date.now;
      Date.now = () => now() + 60_000;
    });
    await position(page, clip, undefined, "timeupdate");
    await settle(page);
    expect(writes).toHaveLength(1);
    await position(page, clip, 7, "seeking");
    await position(page, clip, undefined, "seeked");
    await position(page, clip, undefined, "pause");
    await settle(page);
    expect(writes).toEqual([
      { positionMs: 17_000, expectedRevision: null, status: 409 },
      { positionMs: 7_000, expectedRevision: newer.revision, status: 200 },
    ]);
    expect(rows(clip).progress[0]?.positionMs).toBe(7_000);
    expect(rows(clip).history[0]?.viewCount).toBe(1);
    expect(identityReads).toBe(beforeIdentityReads);
  } finally {
    release();
  }
});

test("Clips pause and ended save scoped progress and completion without duplicate views", async ({
  page,
}) => {
  const [clip] = seedClips();
  const a = await register(page, "pause-ended");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openClips(page, clip);
  await settle(page);
  await ready(page, clip);
  await position(page, clip, 13, "pause");
  await settle(page);
  expect(rows(clip).progress[0]?.positionMs).toBe(13_000);
  await position(page, clip, 30, "ended");
  await settle(page);
  expect(rows(clip).progress[0]?.positionMs).toBe(30_000);
  expect(rows(clip).history).toEqual([{ profileId: a.profile.id, videoId: clip.id, viewCount: 1 }]);
  const read = await page.request.get(
    `${API}/watch/progress/${clip.id}?profileId=${a.profile.id}`,
    { headers: { "x-ayin-expected-account": a.account.id } },
  );
  expect(read.status()).toBe(200);
  expect((await read.json()).completedAt).toEqual(expect.any(String));
  const writes = (await requestLog(page)).filter((item) => item.method === "PUT");
  expect(writes).toHaveLength(2);
  expect(writes[0]).toMatchObject({
    accountId: a.account.id,
    profileId: a.profile.id,
    positionMs: 13_000,
    expectedRevision: null,
    status: 200,
  });
  expect(writes[1]).toMatchObject({
    accountId: a.account.id,
    profileId: a.profile.id,
    positionMs: 30_000,
    expectedRevision: expect.any(String),
    status: 200,
  });
  expect(errors).toEqual([]);
});

for (const event of ["pagehide", "blur-hidden"] as const) {
  test(`Clips lifecycle: ${event} delivers one scoped final checkpoint without stale ACK replay`, async ({
    page,
  }) => {
    const [clip] = seedClips();
    const a = await register(page, `lifecycle-${event}`);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`${API}/watch/progress/${clip.id}*`, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      const response = await route.fetch();
      await held;
      await fulfillHeld(route, response);
    });
    try {
      await openClips(page, clip);
      await settle(page);
      await ready(page, clip);
      await position(page, clip, 17);
      // The neutral audience shell unmounts this video on suspension. Keep the
      // retiring node to dispatch a stale event without waiting for a new feed.
      const retiringVideo = await media(page, clip).elementHandle();
      expect(retiringVideo).not.toBeNull();
      await page.evaluate((event) => {
        if (event === "blur-hidden") {
          window.dispatchEvent(new Event("blur"));
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: "hidden",
          });
          Object.defineProperty(document, "hidden", { configurable: true, value: true });
          document.dispatchEvent(new Event("visibilitychange"));
        }
        window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      }, event);
      await expect
        .poll(() => rows(clip).progress.find((row) => row.profileId === a.profile.id)?.positionMs)
        .toBe(17_000);
      release();
      await settle(page);
      const writes = (await requestLog(page)).filter((item) => item.method === "PUT");
      expect(writes).toEqual([
        expect.objectContaining({
          keepalive: true,
          aborted: false,
          accountId: a.account.id,
          profileId: a.profile.id,
          positionMs: 17_000,
          expectedRevision: null,
          status: 200,
        }),
      ]);
      await page.evaluate(() =>
        window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
      );
      await retiringVideo!.evaluate((video: HTMLVideoElement) => {
        video.currentTime = 23;
        video.dispatchEvent(new Event("pause"));
      });
      await settle(page);
      expect((await requestLog(page)).filter((item) => item.method === "PUT")).toHaveLength(1);
      expect(rows(clip).progress[0]?.positionMs).toBe(17_000);
    } finally {
      release();
      await test.info().attach("clips-lifecycle-proof", {
        body: JSON.stringify({ requests: await requestLog(page), rows: rows(clip) }),
        contentType: "application/json",
      });
    }
  });
}

test("Clips unmount releases media without another write and Home/Back restores the saved checkpoint", async ({
  page,
}) => {
  const [clip] = seedClips();
  const a = await register(page, "route-return");
  await seedProgress(page, clip, a, 13_000);
  await openClips(page, clip, true);
  await settle(page);
  await ready(page, clip);
  await expect.poll(() => position(page, clip)).toBe(13);
  await position(page, clip, 17, "pause");
  await settle(page);
  const writesBeforeUnmount = (await requestLog(page)).filter((item) => item.method === "PUT");
  const marker = await media(page, clip).evaluate((video: HTMLVideoElement) => {
    const marker = crypto.randomUUID();
    video.dataset.clipsRetentionMarker = marker;
    Object.assign(window, { clipsDocumentMarker: marker, clipsOriginalVideo: video });
    return marker;
  });
  await page.locator('[data-tv-focus-id="brand-home"]:visible').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("[data-clip-item='true']")).toHaveCount(0);
  await settle(page);
  const released = await page.evaluate(() => {
    const state = window as unknown as {
      clipsMediaLifecycle: { releaseLoads: number };
      clipsOriginalVideo: HTMLVideoElement;
      clipsDocumentMarker: string;
    };
    return {
      releaseLoads: state.clipsMediaLifecycle.releaseLoads,
      sourceRemoved: !state.clipsOriginalVideo.hasAttribute("src"),
      currentTime: state.clipsOriginalVideo.currentTime,
      documentMarker: state.clipsDocumentMarker,
    };
  });
  expect(released.releaseLoads).toBeGreaterThan(0);
  expect(released.sourceRemoved).toBe(true);
  expect(released.currentTime).toBe(0);
  expect(released.documentMarker).toBe(marker);
  expect((await requestLog(page)).filter((item) => item.method === "PUT")).toEqual(
    writesBeforeUnmount,
  );
  await expect
    .poll(() => rows(clip).progress.find((row) => row.profileId === a.profile.id)?.positionMs)
    .toBe(17_000);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "AYIN Clips", exact: true })).toBeVisible();
  await expect(media(page, clip)).toHaveCount(1);
  await expect(page.locator("[data-private-viewer-identity]:visible")).toContainText(
    a.account.displayName,
  );
  await settle(page);
  const restored = await media(page, clip).evaluate((video: HTMLVideoElement) => ({
    retained: video.dataset.clipsRetentionMarker ?? null,
    sameDocument: (window as unknown as { clipsDocumentMarker: string }).clipsDocumentMarker,
  }));
  expect(restored.sameDocument).toBe(marker);
  await ready(page, clip);
  await expect.poll(() => position(page, clip)).toBe(17);
  await test.info().attach("clips-route-retention-proof", {
    body: JSON.stringify({ marker, released, restored, rows: rows(clip) }),
    contentType: "application/json",
  });
});

test("Clips real cross-document unload delivers the scoped final checkpoint", async ({ page }) => {
  const [clip] = seedClips();
  const a = await register(page, "real-unload");
  await openClips(page, clip);
  await settle(page);
  await ready(page, clip);
  await position(page, clip, 17);
  expect(rows(clip).progress).toEqual([]);
  // Routing can hold keepalive delivery inside the target being destroyed.
  // Remove all seams before actual unload so this checks native request lifetime.
  await page.unrouteAll({ behavior: "wait" });
  await page.goto("about:blank");
  await expect(page).toHaveURL("about:blank");
  await expect
    .poll(() => rows(clip).progress.find((row) => row.profileId === a.profile.id)?.positionMs)
    .toBe(17_000);
  const read = await page.request.get(
    `${API}/watch/progress/${clip.id}?profileId=${a.profile.id}`,
    { headers: { "x-ayin-expected-account": a.account.id } },
  );
  expect(read.status()).toBe(200);
  const saved = await read.json();
  expect(saved).toMatchObject({ profileId: a.profile.id, videoId: clip.id, positionMs: 17_000 });
  expect(saved.revision).toEqual(expect.any(String));
  expect(saved.revision).toBe(saved.lastWatchedAt);
});

test("Clips keyboard navigation and real pagination preserve independent progress and native controls", async ({
  page,
}) => {
  const clips = seedClips();
  const [clip] = clips;
  await register(page, "pagination-keyboard");
  await openClips(page, clip);
  await settle(page);
  const articles = page.locator("[data-clip-item='true']");
  await expect(page.locator("[data-clips-feed]")).toHaveAttribute("data-clips-loaded-count", "20");
  await expect(articles).toHaveCount(2);
  const first = page.locator(`[data-clip-item][data-video-id="${clip.id}"]`);
  const second = page.locator(`[data-clip-item][data-video-id="${clips[1].id}"]`);
  const secondId = await second.getAttribute("data-video-id");
  expect(secondId).toBeTruthy();
  const secondClip = { id: secondId!, slug: "", title: "" };
  await ready(page, clip);
  await position(page, clip, 13, "pause");
  await settle(page);
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await expect(second).toBeFocused();
  await ready(page, secondClip);
  await settle(page);
  await expect.poll(() => position(page, secondClip)).toBe(0);
  await position(page, secondClip, 7, "pause");
  await settle(page);
  expect(rows(clip).progress[0]?.positionMs).toBe(13_000);
  expect(rows(secondClip).progress[0]?.positionMs).toBe(7_000);
  await second.focus();
  await page.keyboard.press("ArrowUp");
  await expect(first).toBeFocused();
  // The active-only window mounts a fresh decoder on return; the controlled
  // media harness must deliver its metadata event before resume can apply.
  await ready(page, clip);
  await expect.poll(() => position(page, clip)).toBe(13);
  await page.locator(`[data-tv-focus-id="clip-${clip.id}-native"]`).click();
  await expect(media(page, clip)).toHaveAttribute("controls", "");
  await expect(media(page, clip)).toHaveAttribute("playsinline", "");
  expect(await media(page, clip).evaluate((video: HTMLVideoElement) => video.muted)).toBe(true);
  // Seeds from other independent tests may remain in this disposable database.
  // Verify the real cursor adds unique rows without assuming the global total.
  const before = await page.locator("[data-clips-feed]").getAttribute("data-clips-loaded-count");
  let continuationPage: { items: { id: string }[] } | null = null;
  await page.route(`${API}/public/clips?*`, async (route) => {
    if (!new URL(route.request().url()).searchParams.has("cursor")) return route.continue();
    // Capture the real API response before delivery. Reading Chromium's body
    // again afterward can race CDP response-body eviction during source teardown.
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    continuationPage = await response.json();
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Load more Clips", exact: true }).click();
  await expect.poll(() => continuationPage !== null).toBe(true);
  const nextPage = continuationPage!;
  await expect
    .poll(async () =>
      Number(await page.locator("[data-clips-feed]").getAttribute("data-clips-loaded-count")),
    )
    .toBe(Number(before) + nextPage.items.length);
  expect(new Set(nextPage.items.map((item: { id: string }) => item.id)).size).toBe(
    nextPage.items.length,
  );
  await expect(articles).toHaveCount(2);
  await expect(first).toHaveAttribute("data-clip-active", "true");
  expect(rows(clip).progress[0]?.positionMs).toBe(13_000);
  expect(rows(secondClip).progress[0]?.positionMs).toBe(7_000);
});

for (const intent of ["restore", "rewind"] as const) {
  test(`native Clips retired-A seeking preserves B's held ${intent} intent`, async ({
    page,
    context,
  }) => {
    const [clip] = seedClips();
    const a = await register(page, "native-reset-a");
    await seedProgress(page, clip, a, 17_000);
    await openClips(page, clip, false, true);
    await settle(page);
    await ready(page, clip);
    await expect.poll(() => position(page, clip)).toBe(17);
    const retiredA = await media(page, clip).elementHandle();
    if (!retiredA) throw new Error("The original A media element is required.");
    const other = await context.newPage();
    const b = await register(other, "native-reset-b");
    await seedProgress(other, clip, b, 13_000);
    await settle(page);
    const before = rows(clip);
    const held = holdRead(page, clip);
    await held.setup;
    try {
      const freshBRead = nextOwnerClipRead(page, b);
      await refocus(page);
      await freshBRead;
      await expect(page.locator("[data-private-viewer-identity]:visible")).toContainText(
        b.account.displayName,
      );
      await expect.poll(() => Boolean(held.captured())).toBe(true);
      expect((await held.captured()!.json()).profileId).toBe(b.profile.id);
      const retirement = await expectRetiredClipOwner(page, clip, retiredA);
      // Owner changes now mount fresh media. Replay a late native seek on the
      // actual retired A element, while B's saved snapshot is still held.
      const retiredEvents = await retiredA.evaluate(async (node) => {
        const video = node as HTMLVideoElement;
        const events: { type: string; position: number; connected: boolean }[] = [];
        const record = (event: Event) =>
          events.push({
            type: event.type,
            position: video.currentTime,
            connected: video.isConnected,
          });
        video.addEventListener("seeking", record, { once: true });
        video.addEventListener("seeked", record, { once: true });
        video.currentTime = 0;
        await Promise.resolve();
        return events;
      });
      expect(retiredEvents).toEqual([
        { type: "seeking", position: 0, connected: false },
        { type: "seeked", position: 0, connected: false },
      ]);
      await expect.poll(() => position(page, clip)).toBe(0);
      if (intent === "rewind") {
        await media(page, clip).evaluate((video: HTMLVideoElement) => {
          video.currentTime = 7;
        });
        await expect.poll(() => position(page, clip)).toBe(7);
      }
      expect(
        (await requestLog(page)).filter(
          (item) => item.method === "PUT" && item.accountId === b.account.id,
        ),
      ).toEqual([]);
      held.release();
      await settle(page);
      await ready(page, clip);
      await expect.poll(() => position(page, clip)).toBe(intent === "rewind" ? 7 : 13);
      expect(rows(clip).progress.find((row) => row.profileId === b.profile.id)?.positionMs).toBe(
        13_000,
      );
      expect(rows(clip).progress.find((row) => row.profileId === a.profile.id)?.positionMs).toBe(
        17_000,
      );
      expect(rows(clip)).toEqual(before);
      await test.info().attach(`clips-retired-a-${intent}`, {
        body: JSON.stringify({
          retirement,
          retiredEvents,
          currentAccountId: b.account.id,
          currentProfileId: b.profile.id,
          position: await position(page, clip),
          rows: rows(clip),
        }),
        contentType: "application/json",
      });
    } finally {
      held.release();
      await retiredA.dispose();
    }
  });
}

for (const order of ["metadata-first", "progress-first", "deliberate-rewind"] as const) {
  test(`native Clips resume handles ${order} without treating its own seek as user intent`, async ({
    page,
  }) => {
    const [clip] = seedClips();
    const a = await register(page, `native-${order}`);
    await seedProgress(page, clip, a, 17_000);
    const held = holdRead(page, clip);
    await held.setup;
    try {
      await openClips(page, clip, false, true);
      await expect.poll(() => Boolean(held.captured())).toBe(true);
      if (order !== "progress-first") await ready(page, clip);
      if (order === "deliberate-rewind") {
        await media(page, clip).evaluate((video: HTMLVideoElement) => {
          video.currentTime = 7;
        });
        await expect
          .poll(() =>
            page.evaluate(
              (videoId) =>
                (
                  window as unknown as {
                    clipsNativeSeeks: { videoId: string | null; position: number }[];
                  }
                ).clipsNativeSeeks.some((item) => item.videoId === videoId && item.position === 7),
              clip.id,
            ),
          )
          .toBe(true);
      }
      held.release();
      await settle(page);
      await ready(page, clip);
      await expect.poll(() => position(page, clip)).toBe(order === "deliberate-rewind" ? 7 : 17);
      expect(rows(clip).progress[0]?.positionMs).toBe(17_000);
      if (order === "deliberate-rewind") {
        await position(page, clip, undefined, "pause");
        await settle(page);
        expect(rows(clip).progress[0]?.positionMs).toBe(7_000);
      }
    } finally {
      held.release();
    }
  });
}

for (const event of ["metadata-only", "queued-paused-play"] as const) {
  test(`unviewed offscreen Clips preserve completed progress on suspension after ${event}`, async ({
    page,
  }) => {
    const [active, offscreen] = seedClips();
    const a = await register(page, "offscreen-completed");
    await seedProgress(page, offscreen, a, 30_000);
    const url = `${API}/watch/progress/${offscreen.id}?profileId=${a.profile.id}`;
    const headers = { "x-ayin-expected-account": a.account.id };
    const beforeResponse = await page.request.get(url, { headers });
    expect(beforeResponse.status()).toBe(200);
    const before = await beforeResponse.json();
    expect(before.completedAt).toEqual(expect.any(String));
    const beforeRows = rows(offscreen);
    await openClips(page, active, false, true);
    await settle(page);
    await ready(page, active);
    // An untouched offscreen item has no media element, no read, and no write.
    await expect(media(page, offscreen)).toHaveCount(0);
    expect(
      (await requestLog(page)).filter(
        (item) => item.profileId === a.profile.id && item.method === "PUT",
      ),
    ).toEqual([]);
    if (event === "queued-paused-play") {
      // A real play();pause() sequence can dispatch its queued play event after
      // the element is paused again. Replay that callback state without playing.
      // Detached browser callbacks cannot acquire the active owner's progress
      // authority. This covers the old offscreen callback without creating a
      // resident player that the windowing contract deliberately forbids.
      expect(
        await page.evaluate(() => {
          const detached = document.createElement("video");
          detached.dispatchEvent(new Event("loadedmetadata"));
          detached.dispatchEvent(new Event("play"));
          detached.dispatchEvent(new Event("pause"));
          return detached.paused && !detached.isConnected;
        }),
      ).toBe(true);
    }
    await position(page, active, 17);
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
    );
    await expect
      .poll(() => rows(active).progress.find((row) => row.profileId === a.profile.id)?.positionMs)
      .toBe(17_000);
    await settle(page);
    const afterResponse = await page.request.get(url, { headers });
    expect(afterResponse.status()).toBe(200);
    // Includes revision, completedAt, lastWatchedAt, position and exact owner.
    expect(await afterResponse.json()).toEqual(before);
    expect(rows(offscreen)).toEqual(beforeRows);
  });
}

test("native Clips late seek events on retired A cannot suppress B's held saved resume", async ({
  page,
  context,
}) => {
  const [clip] = seedClips();
  const a = await register(page, "stale-seeked-a");
  await seedProgress(page, clip, a, 17_000);
  // This is a controlled replay of the ordering observed in a decoded-media
  // probe. It tests the application callback race, not browser decoding itself.
  // Automatic seam events stay off so we can interleave the two seek lifetimes.
  await openClips(page, clip);
  await settle(page);
  await ready(page, clip);
  await expect.poll(() => position(page, clip)).toBe(17);
  const retiredA = await media(page, clip).elementHandle();
  if (!retiredA) throw new Error("The original A media element is required.");
  await media(page, clip).evaluate((video: HTMLVideoElement) => {
    const events: { event: string; position: number; seeking: boolean }[] = [];
    Object.assign(window, { clipsSeekOrdering: events });
    const dispatch = (event: string, seeking: boolean) => {
      Object.defineProperty(video, "seeking", { configurable: true, value: seeking });
      events.push({ event, position: video.currentTime, seeking: video.seeking });
      video.dispatchEvent(new Event(event));
    };
    dispatch("seeking", true);
    dispatch("timeupdate", false);
    // A's terminal seeked is still queued when B's owner transition starts.
  });
  const other = await context.newPage();
  const b = await register(other, "stale-seeked-b");
  await seedProgress(other, clip, b, 13_000);
  await settle(page);
  const before = rows(clip);
  const held = holdRead(page, clip);
  await held.setup;
  try {
    const freshBRead = nextOwnerClipRead(page, b);
    await refocus(page);
    await freshBRead;
    await expect(page.locator("[data-private-viewer-identity]:visible")).toContainText(
      b.account.displayName,
    );
    await expect.poll(() => Boolean(held.captured())).toBe(true);
    expect((await held.captured()!.json()).profileId).toBe(b.profile.id);
    const retirement = await expectRetiredClipOwner(page, clip, retiredA);
    const ordering = await retiredA.evaluate((node) => {
      const video = node as HTMLVideoElement;
      const events = (
        window as unknown as {
          clipsSeekOrdering: { event: string; position: number; seeking: boolean }[];
        }
      ).clipsSeekOrdering;
      const dispatch = (event: string, seeking: boolean) => {
        Object.defineProperty(video, "seeking", { configurable: true, value: seeking });
        events.push({ event, position: video.currentTime, seeking: video.seeking });
        video.dispatchEvent(new Event(event));
      };
      // These callbacks belong to A's retired element. Dispatching them on the
      // current B locator would instead create real new-owner seek intent.
      dispatch("seeked", true);
      dispatch("seeking", true);
      dispatch("timeupdate", false);
      dispatch("seeked", false);
      return events;
    });
    expect(ordering).toEqual([
      { event: "seeking", position: 17, seeking: true },
      { event: "timeupdate", position: 17, seeking: false },
      { event: "seeked", position: 17, seeking: true },
      { event: "seeking", position: 17, seeking: true },
      { event: "timeupdate", position: 17, seeking: false },
      { event: "seeked", position: 17, seeking: false },
    ]);
    await expect.poll(() => position(page, clip)).toBe(0);
    expect(
      (await requestLog(page)).filter(
        (item) => item.method === "PUT" && item.accountId === b.account.id,
      ),
    ).toEqual([]);
    await test.info().attach("clips-overlapping-native-seek-order", {
      body: JSON.stringify({
        retirement,
        ordering,
        currentAccountId: b.account.id,
        currentProfileId: b.profile.id,
      }),
      contentType: "application/json",
    });
    held.release();
    await settle(page);
    await ready(page, clip);
    await expect.poll(() => position(page, clip)).toBe(13);
    expect(rows(clip).progress.find((row) => row.profileId === b.profile.id)?.positionMs).toBe(
      13_000,
    );
    expect(rows(clip).progress.find((row) => row.profileId === a.profile.id)?.positionMs).toBe(
      17_000,
    );
    expect(rows(clip)).toEqual(before);
  } finally {
    held.release();
    await retiredA.dispose();
  }
});
