import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
test.use({ serviceWorkers: "block" });
interface Identity {
  account: { id: string; displayName: string };
  profile: { id: string };
}
interface VideoFixture {
  id: string;
  slug: string;
}
interface Rows {
  progress: { profileId: string; videoId: string; positionMs: number }[];
  history: { profileId: string; videoId: string; viewCount: number }[];
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
function seedVideo(): VideoFixture {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/db-helper.mjs"), "seed-player-video", "{}"],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
async function register(page: Page, label: string): Promise<Identity> {
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
async function seedProgress(
  page: Page,
  video: VideoFixture,
  identity: Identity,
  positionMs: number,
) {
  const response = await page.request.put(`${API}/watch/progress/${video.id}`, {
    headers: { origin: WEB, "x-ayin-expected-account": identity.account.id },
    data: { profileId: identity.profile.id, positionMs, durationMs: 120_000 },
  });
  expect(response.status()).toBe(200);
}
// The auth, session, watch API and database are real. Media readiness/time/play
// are controlled DOM events, not evidence of decoded playback or device support.
async function mediaHarness(page: Page, resetOnLoad = false) {
  await page.addInitScript((resetOnLoad) => {
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
    const lifecycle = { loadCalls: 0, releaseLoads: 0 };
    Object.assign(window, { progressMediaLifecycle: lifecycle });
    HTMLMediaElement.prototype.load = function () {
      lifecycle.loadCalls++;
      if (!this.getAttribute("src")) lifecycle.releaseLoads++;
      if (resetOnLoad) {
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
      (this as Media)._paused = true;
      this.dispatchEvent(new Event("pause"));
    };
    const original = window.fetch;
    const pending = new Set<Promise<unknown>>();
    const requests: Array<{
      method: string;
      keepalive: boolean;
      aborted: boolean;
      accountId: string | null;
      profileId: string | null;
      status?: number;
    }> = [];
    Object.assign(window, { progressPending: pending, progressRequestLog: requests });
    window.fetch = (...args) => {
      const promise = original(...args);
      if (String(args[0]).includes("/watch/progress/")) {
        const init = args[1];
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        const recorded = {
          method: init?.method ?? "GET",
          keepalive: init?.keepalive ?? false,
          aborted: Boolean(init?.signal?.aborted),
          accountId: new Headers(init?.headers).get("x-ayin-expected-account"),
          profileId:
            body?.profileId ??
            new URL(String(args[0]), location.href).searchParams.get("profileId"),
          status: undefined as number | undefined,
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
  }, resetOnLoad);
  await page.route("**/ads/video/decision/*", (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await page.route("http://media.invalid/**", (route) => route.abort());
}
async function ready(page: Page) {
  await page.locator("video:visible").evaluate((video: HTMLVideoElement & { _ready?: number }) => {
    video._ready = 4;
    video.dispatchEvent(new Event("loadedmetadata"));
    video.dispatchEvent(new Event("canplay"));
  });
}
async function position(page: Page, value?: number, event?: string) {
  return page.locator("video:visible").evaluate(
    (video: HTMLVideoElement, input) => {
      if (input.value !== undefined) video.currentTime = input.value;
      if (input.event) video.dispatchEvent(new Event(input.event));
      return video.currentTime;
    },
    { value, event },
  );
}
async function settle(page: Page) {
  await page.evaluate(async () => {
    await Promise.allSettled([
      ...(window as unknown as { progressPending: Set<Promise<unknown>> }).progressPending,
    ]);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}
async function refocus(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}
async function openWatch(page: Page, video: VideoFixture, resetOnLoad = false) {
  const current = await page.request.get(`${API}/auth/me`);
  expect(current.status()).toBe(200);
  const identity = (await current.json()) as Identity;
  await mediaHarness(page, resetOnLoad);
  await page.goto(`/watch/${video.slug}?lang=en`);
  await expect(page.getByRole("heading", { name: "HLS Player E2E", exact: true })).toBeVisible();
  await expect(page.locator("video:visible")).toHaveCount(1);
  await expect(page.locator("[data-private-viewer-identity]:visible")).toContainText(
    identity.account.displayName,
  );
}
function holdProgress(page: Page, video: VideoFixture) {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured: APIResponse | undefined;
  let used = false;
  const setup = page.route(`${API}/watch/progress/${video.id}*`, async (route) => {
    if (used || route.request().method() !== "GET") return route.continue();
    used = true;
    captured = await route.fetch();
    await wait;
    await route.fulfill({ response: captured }).catch((error: Error) => {
      if (!/aborted|Invalid InterceptionId|already handled|Target.*closed/i.test(error.message))
        throw error;
    });
  });
  return { setup, release: () => release(), captured: () => captured };
}

test("retained Watch never writes A playback into B after real shared-cookie switch", async ({
  page,
  context,
}) => {
  const video = seedVideo();
  await register(page, "switch-a");
  await openWatch(page, video);
  await settle(page);
  await ready(page);
  await position(page, 37);
  const other = await context.newPage();
  const b = await register(other, "switch-b");
  await refocus(page);
  await expect(page.locator("[data-private-viewer-identity]:visible")).toContainText(
    b.account.displayName,
  );
  await position(page, undefined, "pause");
  await settle(page);
  const rows = fixture<Rows>("rows", { videoId: video.id });
  expect(rows.progress.filter((row) => row.profileId === b.profile.id)).toEqual([]);
  expect(rows.history.filter((row) => row.profileId === b.profile.id)).toEqual([]);
});

test("late A progress cannot resume B after retained Watch revalidation", async ({
  page,
  context,
}) => {
  const video = seedVideo();
  const a = await register(page, "late-a");
  await seedProgress(page, video, a, 42_000);
  const held = holdProgress(page, video);
  await held.setup;
  try {
    await openWatch(page, video);
    await expect.poll(() => Boolean(held.captured())).toBe(true);
    expect((await held.captured()!.json()).profileId).toBe(a.profile.id);
    const other = await context.newPage();
    const b = await register(other, "late-b");
    await seedProgress(other, video, b, 13_000);
    await refocus(page);
    await expect(page.locator("[data-private-viewer-identity]:visible")).toContainText(
      b.account.displayName,
    );
    held.release();
    await settle(page);
    await ready(page);
    await expect.poll(() => position(page)).toBe(13);
    expect(
      fixture<Rows>("rows", { videoId: video.id }).progress.find(
        (row) => row.profileId === b.profile.id,
      )?.positionMs,
    ).toBe(13_000);
  } finally {
    held.release();
  }
});

for (const action of ["logout", "revoke"] as const) {
  test(`${action} prevents delayed resume and later checkpoint on retained Watch`, async ({
    page,
  }) => {
    const video = seedVideo();
    const a = await register(page, action);
    await seedProgress(page, video, a, 42_000);
    const held = holdProgress(page, video);
    await held.setup;
    try {
      await openWatch(page, video);
      await expect.poll(() => Boolean(held.captured())).toBe(true);
      if (action === "logout")
        expect(
          (await page.request.post(`${API}/auth/logout`, { headers: { origin: WEB } })).ok(),
        ).toBe(true);
      else fixture("revoke", { accountId: a.account.id });
      await refocus(page);
      held.release();
      await settle(page);
      await ready(page);
      expect(await position(page)).toBe(0);
      await position(page, 57, "pause");
      await settle(page);
      expect(fixture<Rows>("rows", { videoId: video.id }).progress).toEqual([
        { profileId: a.profile.id, videoId: video.id, positionMs: 42_000 },
      ]);
    } finally {
      held.release();
    }
  });
}

for (const order of ["metadata-first", "progress-first", "deliberate-seek"] as const) {
  test(`same-account resume handles ${order}`, async ({ page }) => {
    const video = seedVideo();
    const a = await register(page, order);
    await seedProgress(page, video, a, 42_000);
    const held = holdProgress(page, video);
    await held.setup;
    try {
      await openWatch(page, video);
      await expect.poll(() => Boolean(held.captured())).toBe(true);
      if (order !== "progress-first") await ready(page);
      if (order === "deliberate-seek") {
        await page.locator('[data-player-stage="true"]:visible').focus();
        await page.keyboard.press("ArrowRight");
        expect(await position(page)).toBe(10);
      }
      held.release();
      await settle(page);
      if (order !== "metadata-first") await ready(page);
      await expect.poll(() => position(page)).toBe(order === "deliberate-seek" ? 10 : 42);
    } finally {
      held.release();
    }
  });
}

test("default-profile change does not carry prior profile position into the new profile", async ({
  page,
}) => {
  const video = seedVideo();
  const a = await register(page, "profiles");
  await seedProgress(page, video, a, 42_000);
  await openWatch(page, video);
  await settle(page);
  await ready(page);
  await expect.poll(() => position(page)).toBe(42);
  const second = fixture<{ id: string }>("default-profile", { accountId: a.account.id });
  await seedProgress(page, video, { ...a, profile: second }, 13_000);
  await refocus(page);
  await settle(page);
  await ready(page);
  await expect.poll(() => position(page)).toBe(13);
  await position(page, 19, "pause");
  await settle(page);
  const rows = fixture<Rows>("rows", { videoId: video.id });
  expect(rows.progress.find((row) => row.profileId === a.profile.id)?.positionMs).toBe(42_000);
  expect(rows.progress.find((row) => row.profileId === second.id)?.positionMs).toBe(19_000);
});

test("failed checkpoint is not acknowledged and a later pause retries the same position", async ({
  page,
}) => {
  const video = seedVideo();
  const a = await register(page, "retry");
  let attempts = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(`${API}/watch/progress/${video.id}*`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    attempts++;
    if (attempts === 1) return route.abort("failed");
    return route.continue();
  });
  await openWatch(page, video);
  await settle(page);
  await ready(page);
  await position(page, 37, "pause");
  await settle(page);
  expect(attempts).toBe(1);
  expect(fixture<Rows>("rows", { videoId: video.id }).progress).toEqual([]);
  await position(page, undefined, "pause");
  await settle(page);
  expect(attempts).toBe(2);
  expect(fixture<Rows>("rows", { videoId: video.id }).progress).toEqual([
    { profileId: a.profile.id, videoId: video.id, positionMs: 37_000 },
  ]);
  expect(errors).toEqual([]);
});

for (const corrupt of ["video", "profile", "position"] as const) {
  test(`ignores a ${corrupt}-mismatched progress response`, async ({ page }) => {
    const video = seedVideo();
    const a = await register(page, `malformed-${corrupt}`);
    await seedProgress(page, video, a, 42_000);
    await page.route(`${API}/watch/progress/${video.id}*`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      if (corrupt === "video") body.videoId = a.account.id;
      else if (corrupt === "profile") body.profileId = a.account.id;
      else body.positionMs = "42000";
      await route.fulfill({ response, json: body });
    });
    await openWatch(page, video);
    await settle(page);
    await ready(page);
    expect(await position(page)).toBe(0);
    expect(fixture<Rows>("rows", { videoId: video.id }).progress[0]?.positionMs).toBe(42_000);
  });
}

test("same-account revalidation preserves deliberate current playback without replaying saved resume", async ({
  page,
}) => {
  const video = seedVideo();
  const a = await register(page, "same-refocus");
  await seedProgress(page, video, a, 42_000);
  await openWatch(page, video);
  await settle(page);
  await ready(page);
  await expect.poll(() => position(page)).toBe(42);
  await position(page, 53);
  await refocus(page);
  await settle(page);
  await ready(page);
  expect(await position(page)).toBe(53);
});

test("lost ACK conflict reconciles without replay until a new explicit checkpoint", async ({
  page,
}) => {
  const video = seedVideo();
  const a = await register(page, "lost-ack");
  let attempts = 0;
  let firstCompleted = false;
  const scopes: { accountId: string | undefined; profileId: unknown }[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(`${API}/watch/progress/${video.id}*`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    attempts++;
    scopes.push({
      accountId: route.request().headers()["x-ayin-expected-account"],
      profileId: route.request().postDataJSON().profileId,
    });
    const response = await route.fetch();
    if (attempts === 1) {
      firstCompleted = true;
      await held;
      return route.abort("failed");
    }
    return route.fulfill({ response });
  });
  try {
    await openWatch(page, video);
    await settle(page);
    await ready(page);
    await position(page, 37, "pause");
    await expect.poll(() => firstCompleted).toBe(true);
    expect(fixture<Rows>("rows", { videoId: video.id }).progress[0]?.positionMs).toBe(37_000);
    await position(page, 53, "pause");
    const reconciled = page.waitForResponse(
      (response) =>
        response.url().includes(`/watch/progress/${video.id}`) &&
        response.request().method() === "GET",
    );
    release();
    await reconciled;
    await settle(page);
    expect(attempts).toBe(2);
    expect(fixture<Rows>("rows", { videoId: video.id }).progress[0]?.positionMs).toBe(37_000);
    // The queued 53-second intent conflicted with the unknown committed write.
    // Only a fresh explicit checkpoint can apply it against the reconciled revision.
    await position(page, undefined, "pause");
    await settle(page);
    expect(attempts).toBe(3);
    const rows = fixture<Rows>("rows", { videoId: video.id });
    expect(rows.progress).toEqual([
      { profileId: a.profile.id, videoId: video.id, positionMs: 53_000 },
    ]);
    expect(rows.history).toEqual([{ profileId: a.profile.id, videoId: video.id, viewCount: 1 }]);
    expect(scopes).toEqual(
      Array.from({ length: 3 }, () => ({ accountId: a.account.id, profileId: a.profile.id })),
    );
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});

test("expected-account fence rejects a cookie switch even before any focus signal", async ({
  page,
}) => {
  const video = seedVideo();
  await register(page, "silent-a");
  await openWatch(page, video);
  await settle(page);
  await ready(page);
  await position(page, 37);
  const b = await register(page, "silent-b");
  const attempted = page.waitForResponse(
    (response) =>
      response.url().includes(`/watch/progress/${video.id}`) &&
      response.request().method() === "PUT",
  );
  await position(page, undefined, "pause");
  expect((await attempted).status()).toBe(409);
  await settle(page);
  expect(
    fixture<Rows>("rows", { videoId: video.id }).progress.filter(
      (row) => row.profileId === b.profile.id,
    ),
  ).toEqual([]);
  expect(
    fixture<Rows>("rows", { videoId: video.id }).history.filter(
      (row) => row.profileId === b.profile.id,
    ),
  ).toEqual([]);
});

test("a pause before media readiness never overwrites an unapplied saved resume", async ({
  page,
}) => {
  const video = seedVideo();
  const a = await register(page, "pause-before-ready");
  await seedProgress(page, video, a, 42_000);
  await openWatch(page, video);
  await settle(page);
  await position(page, undefined, "pause");
  await settle(page);
  expect(fixture<Rows>("rows", { videoId: video.id }).progress[0]?.positionMs).toBe(42_000);
  await ready(page);
  await expect.poll(() => position(page)).toBe(42);
});

test("a failed initial read recovers on the next pause without writing before a trusted snapshot", async ({
  page,
}) => {
  const video = seedVideo();
  const a = await register(page, "read-retry");
  await seedProgress(page, video, a, 42_000);
  let reads = 0;
  let writesBeforeRecovery = 0;
  await page.route(`${API}/watch/progress/${video.id}*`, async (route) => {
    if (route.request().method() === "GET") {
      reads++;
      if (reads === 1)
        return route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" } } });
    } else if (reads < 2) writesBeforeRecovery++;
    return route.continue();
  });
  await openWatch(page, video);
  await settle(page);
  await ready(page);
  expect(reads).toBe(1);
  await position(page, undefined, "timeupdate");
  await position(page, undefined, "timeupdate");
  await settle(page);
  expect(reads).toBe(1);
  await position(page, undefined, "pause");
  await settle(page);
  await expect.poll(() => reads).toBe(2);
  await expect.poll(() => position(page)).toBe(42);
  expect(writesBeforeRecovery).toBe(0);
  expect(fixture<Rows>("rows", { videoId: video.id }).progress[0]?.positionMs).toBe(42_000);
  await position(page, 53, "pause");
  await settle(page);
  expect(fixture<Rows>("rows", { videoId: video.id }).progress[0]?.positionMs).toBe(53_000);
});

test("white-box coordinator invalidation blocks old resume before the next React commit", async ({
  page,
}) => {
  const video = seedVideo();
  const a = await register(page, "synchronous-lease");
  await seedProgress(page, video, a, 42_000);
  await openWatch(page, video);
  await settle(page);
  const result = await page
    .locator("video:visible")
    .evaluate((element: HTMLVideoElement & { _ready?: number }) => {
      // Test-only inspection of the mounted React tree obtains the real coordinator
      // callback. No application API or production test hook is introduced. Invoke
      // non-flushed retry and media readiness in the same stack, before a later
      // commit could be relied on to replace the player's closure.
      interface Fiber {
        return: Fiber | null;
        memoizedProps?: {
          value?: {
            identityRevision?: number;
            retryNavigation?: () => void;
            isIdentityCurrent?: () => boolean;
          };
        };
      }
      const fiberKey = Object.keys(element).find((key) => key.startsWith("__reactFiber$"));
      if (!fiberKey) throw new Error("React media fiber is unavailable.");
      let fiber = (element as unknown as Record<string, Fiber>)[fiberKey];
      while (fiber && typeof fiber.memoizedProps?.value?.retryNavigation !== "function")
        fiber = fiber.return ?? undefined;
      const coordinator = fiber?.memoizedProps?.value;
      if (!coordinator?.retryNavigation)
        throw new Error("Mounted viewer coordinator is unavailable.");
      coordinator.retryNavigation();
      const leaseImmediately = coordinator.isIdentityCurrent?.();
      element._ready = 4;
      element.dispatchEvent(new Event("loadedmetadata"));
      element.dispatchEvent(new Event("canplay"));
      return { leaseImmediately, positionImmediately: element.currentTime };
    });
  expect(result.positionImmediately).toBe(0);
  expect(result.leaseImmediately).toBe(false);
});

test("a delayed A write ACK cannot block or acknowledge B checkpoints", async ({
  page,
  context,
}) => {
  const video = seedVideo();
  const a = await register(page, "late-write-a");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let aCommitted = false;
  let heldOnce = false;
  await page.route(`${API}/watch/progress/${video.id}*`, async (route) => {
    if (heldOnce || route.request().method() !== "PUT") return route.continue();
    heldOnce = true;
    const response = await route.fetch();
    expect((await response.json()).profileId).toBe(a.profile.id);
    aCommitted = true;
    await held;
    await route.fulfill({ response }).catch((error: Error) => {
      if (!/aborted|Invalid InterceptionId|already handled|Target.*closed/i.test(error.message))
        throw error;
    });
  });
  try {
    await openWatch(page, video);
    await settle(page);
    await ready(page);
    await position(page, 37, "pause");
    await expect.poll(() => aCommitted).toBe(true);
    const other = await context.newPage();
    const b = await register(other, "late-write-b");
    await refocus(page);
    await expect(page.locator("[data-private-viewer-identity]:visible")).toContainText(
      b.account.displayName,
    );
    await position(page, 13, "pause");
    // A's response is intentionally held. Inspect B's independent real DB row
    // instead of waiting for every outstanding fetch (which would deadlock the baseline).
    await expect
      .poll(
        () =>
          fixture<Rows>("rows", { videoId: video.id }).progress.find(
            (row) => row.profileId === b.profile.id,
          )?.positionMs,
      )
      .toBe(13_000);
    release();
    await settle(page);
    await position(page, 19, "pause");
    await settle(page);
    const rows = fixture<Rows>("rows", { videoId: video.id });
    expect(rows.progress.find((row) => row.profileId === a.profile.id)?.positionMs).toBe(37_000);
    expect(rows.progress.find((row) => row.profileId === b.profile.id)?.positionMs).toBe(19_000);
  } finally {
    release();
  }
});

test("a wrong-profile write ACK is rejected and the next pause retries the same value", async ({
  page,
}) => {
  const video = seedVideo();
  const a = await register(page, "invalid-ack");
  let attempts = 0;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(`${API}/watch/progress/${video.id}*`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    attempts++;
    const response = await route.fetch();
    if (attempts === 1)
      return route.fulfill({
        response,
        json: { ...(await response.json()), profileId: a.account.id },
      });
    return route.fulfill({ response });
  });
  await openWatch(page, video);
  await settle(page);
  await ready(page);
  await position(page, 37, "pause");
  await settle(page);
  expect(attempts).toBe(1);
  expect(fixture<Rows>("rows", { videoId: video.id }).progress[0]?.positionMs).toBe(37_000);
  await position(page, undefined, "pause");
  await settle(page);
  expect(attempts).toBe(2);
  expect(fixture<Rows>("rows", { videoId: video.id }).history[0]?.viewCount).toBe(1);
  expect(errors).toEqual([]);
});

for (const event of ["pagehide", "blur-hidden"] as const) {
  test(`lifecycle delta: ${event} preserves one idle final checkpoint before suspension`, async ({
    page,
  }) => {
    const video = seedVideo();
    const a = await register(page, `final-${event}`);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const checkpointEvents: unknown[] = [];
    page.on("request", (request) => {
      if (!request.url().endsWith("/analytics/events") || request.method() !== "POST") return;
      const body = request.postDataJSON() as { events?: { eventName?: string }[] };
      checkpointEvents.push(
        ...(body.events ?? []).filter((item) => item.eventName === "VIDEO_PROGRESS"),
      );
    });
    await page.route(`${API}/watch/progress/${video.id}*`, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      const response = await route.fetch();
      await held;
      await route.fulfill({ response }).catch((error: Error) => {
        if (!/aborted|Invalid InterceptionId|already handled|Target.*closed/i.test(error.message))
          throw error;
      });
    });
    await openWatch(page, video);
    await settle(page);
    await ready(page);
    await position(page, 37);
    await page.evaluate((event) => {
      if (event === "blur-hidden") {
        window.dispatchEvent(new Event("blur"));
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      }
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    }, event);
    try {
      await expect
        .poll(
          () =>
            fixture<Rows>("rows", { videoId: video.id }).progress.find(
              (row) => row.profileId === a.profile.id,
            )?.positionMs,
        )
        .toBe(37_000);
      // The real write has completed, but expose its response only after the
      // coordinator has invalidated the run. Delivery must not revive its ACK.
      release();
      await settle(page);
      const requests = await page.evaluate(() =>
        (
          window as unknown as {
            progressRequestLog: {
              method: string;
              keepalive: boolean;
              aborted: boolean;
              accountId: string;
              profileId: string;
            }[];
          }
        ).progressRequestLog.filter((item) => item.method === "PUT"),
      );
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        keepalive: true,
        aborted: false,
        accountId: a.account.id,
        profileId: a.profile.id,
      });
      // Repeated lifecycle notifications never create a background replay.
      await page.evaluate(() =>
        window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
      );
      expect(
        await page.evaluate(
          () =>
            (
              window as unknown as { progressRequestLog: { method: string }[] }
            ).progressRequestLog.filter((item) => item.method === "PUT").length,
        ),
      ).toBe(1);
      await settle(page);
      await page.waitForTimeout(100);
      expect(checkpointEvents).toEqual([]);
    } finally {
      release();
      await test.info().attach("lifecycle-request-log", {
        body: JSON.stringify(
          await page.evaluate(
            () => (window as unknown as { progressRequestLog: unknown }).progressRequestLog,
          ),
        ),
        contentType: "application/json",
      });
      await test.info().attach("lifecycle-database-rows", {
        body: JSON.stringify(fixture<Rows>("rows", { videoId: video.id })),
        contentType: "application/json",
      });
    }
  });
}

test("lifecycle delta: final checkpoint keeps A identity after silent cookie switch to B", async ({
  page,
}) => {
  const video = seedVideo();
  const a = await register(page, "exit-cookie-a");
  await openWatch(page, video);
  await settle(page);
  await ready(page);
  await position(page, 37);
  const b = await register(page, "exit-cookie-b");
  const rejected = page.waitForResponse(
    (response) =>
      response.url().includes(`/watch/progress/${video.id}`) &&
      response.request().method() === "PUT",
    { timeout: 10_000 },
  );
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
  );
  try {
    const response = await rejected;
    expect(response.status()).toBe(409);
    expect(response.request().headers()["x-ayin-expected-account"]).toBe(a.account.id);
    expect(response.request().postDataJSON().profileId).toBe(a.profile.id);
    const rows = fixture<Rows>("rows", { videoId: video.id });
    expect(rows.progress.filter((row) => row.profileId === b.profile.id)).toEqual([]);
    expect(rows.history.filter((row) => row.profileId === b.profile.id)).toEqual([]);
    expect(rows.progress.filter((row) => row.profileId === a.profile.id)).toEqual([]);
  } finally {
    await test.info().attach("lifecycle-request-log", {
      body: JSON.stringify(
        await page.evaluate(
          () => (window as unknown as { progressRequestLog: unknown }).progressRequestLog,
        ),
      ),
      contentType: "application/json",
    });
    await test.info().attach("lifecycle-database-rows", {
      body: JSON.stringify(fixture<Rows>("rows", { videoId: video.id })),
      contentType: "application/json",
    });
  }
});

test("lifecycle delta: soft Home and Back restore resume after actual source-release reset", async ({
  page,
}) => {
  const video = seedVideo();
  const a = await register(page, "route-return");
  await seedProgress(page, video, a, 42_000);
  await openWatch(page, video, true);
  await settle(page);
  await ready(page);
  await expect.poll(() => position(page)).toBe(42);
  const marker = await page.locator("video:visible").evaluate((element: HTMLVideoElement) => {
    const marker = crypto.randomUUID();
    element.dataset.progressRetentionMarker = marker;
    Object.assign(window, { progressDocumentMarker: marker, progressOriginalVideo: element });
    return marker;
  });
  await page.locator('[data-tv-focus-id="brand-home"]:visible').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("video:visible")).toHaveCount(0);
  const released = await page.evaluate(() => {
    const state = window as unknown as {
      progressMediaLifecycle: { releaseLoads: number };
      progressOriginalVideo: HTMLVideoElement;
      progressDocumentMarker: string;
    };
    return {
      releaseLoads: state.progressMediaLifecycle.releaseLoads,
      sourceRemoved: !state.progressOriginalVideo.hasAttribute("src"),
      currentTime: state.progressOriginalVideo.currentTime,
      connected: state.progressOriginalVideo.isConnected,
      documentMarker: state.progressDocumentMarker,
    };
  });
  expect(released.releaseLoads).toBeGreaterThan(0);
  expect(released.sourceRemoved).toBe(true);
  expect(released.currentTime).toBe(0);
  expect(released.documentMarker).toBe(marker);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "HLS Player E2E", exact: true })).toBeVisible();
  await expect(page.locator("video:visible")).toHaveCount(1);
  await expect(page.locator("[data-private-viewer-identity]:visible")).toContainText(
    a.account.displayName,
  );
  await settle(page);
  const restored = await page.locator("video:visible").evaluate((element: HTMLVideoElement) => ({
    retained: element.dataset.progressRetentionMarker ?? null,
    sameDocument: (window as unknown as { progressDocumentMarker: string }).progressDocumentMarker,
  }));
  await test.info().attach("route-retention-proof", {
    body: JSON.stringify({ marker, released, restored }),
    contentType: "application/json",
  });
  expect(restored.sameDocument).toBe(marker);
  await ready(page);
  await expect.poll(() => position(page)).toBe(42);
  expect(fixture<Rows>("rows", { videoId: video.id }).progress[0]?.positionMs).toBe(42_000);
});

test("freshness: delayed final37 before commit cannot overwrite a newer same-account53", async ({
  page,
}) => {
  const video = seedVideo();
  const a = await register(page, "freshness-delayed-final");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured = false;
  const outcomes: { positionMs: number; status: number; code?: string }[] = [];
  await page.route(`${API}/watch/progress/${video.id}*`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const positionMs = route.request().postDataJSON().positionMs as number;
    if (!captured) {
      captured = true;
      await held;
    }
    const response = await route.fetch();
    const body = await response.json();
    outcomes.push({
      positionMs,
      status: response.status(),
      ...(body.error?.code ? { code: body.error.code } : {}),
    });
    await route.fulfill({ response }).catch((error: Error) => {
      if (!/aborted|Invalid InterceptionId|already handled|Target.*closed/i.test(error.message))
        throw error;
    });
  });
  try {
    await openWatch(page, video);
    await settle(page);
    await ready(page);
    await position(page, 37);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect.poll(() => captured).toBe(true);
    const resumed = page.waitForResponse(
      (response) =>
        response.url().includes(`/watch/progress/${video.id}`) &&
        response.request().method() === "GET",
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await resumed;
    await expect(page.locator("[data-private-viewer-identity]:visible")).toContainText(
      a.account.displayName,
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await position(page, 53, "pause");
    await expect
      .poll(
        () =>
          fixture<Rows>("rows", { videoId: video.id }).progress.find(
            (row) => row.profileId === a.profile.id,
          )?.positionMs,
        { timeout: 3000 },
      )
      .toBe(53_000);
    const winning = fixture<Rows>("rows", { videoId: video.id });
    release();
    await settle(page);
    await expect.poll(() => outcomes.length).toBe(2);
    expect(outcomes).toEqual([
      { positionMs: 53_000, status: 200 },
      { positionMs: 37_000, status: 409, code: "WATCH_PROGRESS_CONFLICT" },
    ]);
    expect(fixture<Rows>("rows", { videoId: video.id })).toEqual(winning);
    await expect(page.locator("[data-private-viewer-identity]:visible")).toContainText(
      a.account.displayName,
    );
  } finally {
    release();
    await test.info().attach("freshness-commit-order", {
      body: JSON.stringify({ outcomes, rows: fixture<Rows>("rows", { videoId: video.id }) }),
      contentType: "application/json",
    });
  }
});

test("freshness: conflict reads once without logout or replay and a fresh explicit rewind can save", async ({
  page,
}) => {
  const video = seedVideo();
  const a = await register(page, "freshness-conflict-rewind");
  let identityReads = 0;
  let progressReads = 0;
  const writes: { expectedRevision: string | null; status: number }[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/auth/me")) identityReads++;
    if (request.method() === "GET" && request.url().includes(`/watch/progress/${video.id}`))
      progressReads++;
  });
  await page.route(`${API}/watch/progress/${video.id}*`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const response = await route.fetch();
    writes.push({
      expectedRevision: route.request().postDataJSON().expectedRevision,
      status: response.status(),
    });
    return route.fulfill({ response });
  });
  await openWatch(page, video);
  await settle(page);
  await ready(page);
  const beforeIdentityReads = identityReads;
  const beforeProgressReads = progressReads;
  const newer = await page.request.put(`${API}/watch/progress/${video.id}`, {
    headers: { origin: WEB, "x-ayin-expected-account": a.account.id },
    data: { profileId: a.profile.id, positionMs: 53_000 },
  });
  expect(newer.status()).toBe(200);
  const newerRevision = (await newer.json()).revision as string;
  const reconciled = page.waitForResponse(
    (response) =>
      response.url().includes(`/watch/progress/${video.id}`) &&
      response.request().method() === "GET",
  );
  await position(page, 37, "pause");
  // The later real PUT proves the browser consumed this revision. Reading the
  // transient GET body through DevTools can fail after Chromium releases it.
  expect((await reconciled).status()).toBe(200);
  await settle(page);
  expect(progressReads).toBe(beforeProgressReads + 1);
  expect(writes).toEqual([{ expectedRevision: null, status: 409 }]);
  expect(identityReads).toBe(beforeIdentityReads);
  await expect(page.locator("[data-private-viewer-identity]:visible")).toContainText(
    a.account.displayName,
  );
  expect(await position(page)).toBe(37);
  expect(fixture<Rows>("rows", { videoId: video.id }).progress[0]?.positionMs).toBe(53_000);
  await page.evaluate(() => {
    const now = Date.now;
    Date.now = () => now() + 60_000;
  });
  await position(page, undefined, "timeupdate");
  await settle(page);
  expect(writes).toHaveLength(1);
  await position(page, undefined, "pause");
  await settle(page);
  expect(writes).toEqual([
    { expectedRevision: null, status: 409 },
    { expectedRevision: newerRevision, status: 200 },
  ]);
  expect(fixture<Rows>("rows", { videoId: video.id }).progress[0]?.positionMs).toBe(37_000);
  expect(fixture<Rows>("rows", { videoId: video.id }).history[0]?.viewCount).toBe(1);
  expect(identityReads).toBe(beforeIdentityReads);
  expect(progressReads).toBe(beforeProgressReads + 1);
});

test("freshness: real cross-document unload delivers the scoped final checkpoint", async ({
  page,
}) => {
  const video = seedVideo();
  const a = await register(page, "real-unload");
  await openWatch(page, video);
  await settle(page);
  await ready(page);
  await position(page, 37);
  expect(fixture<Rows>("rows", { videoId: video.id }).progress).toEqual([]);
  const marker = await page.evaluate(() => {
    const marker = crypto.randomUUID();
    Object.assign(window, { progressUnloadDocument: marker });
    return marker;
  });
  // This destroys the actual Watch document. No synthetic lifecycle dispatch,
  // intercepted progress response or API write is used to deliver its checkpoint.
  // Active Playwright routing pauses network requests in the destroyed target,
  // which prevents the browser keepalive from leaving during real unload. Remove
  // the media/ads seams first so this checks the native request lifetime and CORS.
  await page.unrouteAll({ behavior: "wait" });
  await page.goto("about:blank");
  await expect(page).toHaveURL("about:blank");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { progressUnloadDocument?: string }).progressUnloadDocument ?? null,
    ),
  ).not.toBe(marker);
  try {
    await expect
      .poll(
        () =>
          fixture<Rows>("rows", { videoId: video.id }).progress.find(
            (row) => row.profileId === a.profile.id,
          )?.positionMs,
      )
      .toBe(37_000);
    const read = await page.request.get(
      `${API}/watch/progress/${video.id}?profileId=${a.profile.id}`,
      { headers: { "x-ayin-expected-account": a.account.id } },
    );
    expect(read.status()).toBe(200);
    const saved = await read.json();
    expect(saved).toMatchObject({ profileId: a.profile.id, videoId: video.id, positionMs: 37_000 });
    expect(typeof saved.revision).toBe("string");
    expect(saved.revision).toBe(saved.lastWatchedAt);
  } finally {
    await test.info().attach("real-unload-database-rows", {
      body: JSON.stringify(fixture<Rows>("rows", { videoId: video.id })),
      contentType: "application/json",
    });
  }
});
