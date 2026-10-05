import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test as base, type APIResponse, type Page, type Route } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001";
const MEDIA = process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? "http://media.invalid";
const fixturePath = path.resolve("tests/e2e/public-hero-lifecycle-fixture.mjs");
const fallbackTitle = "Stories move differently here.";
interface Video {
  id: string;
  title: string;
  slug: string;
}
interface Catalog {
  fixtureId: string;
  accountId: string;
  profileId: string;
  email: string;
  password: string;
  videos: { primary: Video; replacement: Video };
}
function fixture<T = { ok: boolean }>(command: string, payload: object = {}): T {
  return JSON.parse(
    execFileSync(process.execPath, [fixturePath, command, JSON.stringify(payload)], {
      env: process.env,
      encoding: "utf8",
    }),
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
const hero = (page: Page) => page.locator('section[aria-labelledby="ayin-hero-title"]:visible');
const primary = (page: Page) => hero(page).locator('[data-tv-focus-id="hero-primary"]');
const searchLink = (page: Page) => page.locator('[data-tv-focus-id="desktop-search"]:visible');
const homeLink = (page: Page) => page.locator('[data-tv-focus-id="brand-home"]:visible');
const mutate = (catalog: Catalog, command: string, payload: object) =>
  fixture(command, { fixtureId: catalog.fixtureId, ...payload });

async function animationFrames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function expectFeature(page: Page, video: Video) {
  await expect(hero(page).getByRole("heading", { level: 1 })).toHaveText(video.title);
  await expect(primary(page)).toHaveAttribute("href", `/watch/${video.slug}`);
}
async function expectFallback(page: Page) {
  await expect(hero(page).getByRole("heading", { level: 1 })).toHaveText(fallbackTitle);
  await expect(primary(page)).toHaveAttribute("href", "#discovery");
}

// These are real AppModule reads and policy/profile DB changes. We intercept only
// response timing, never fabricate product-controls, navigation, or identity.
// Artwork is a deterministic test asset, not proof of the media provider.
async function observe(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const mediaHost = new URL(MEDIA).hostname;
  await page.route(
    (url) => url.hostname === mediaHost,
    (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="60"><rect width="40" height="60" fill="#6415ce"/></svg>',
      }),
  );
  const reads = { controls: 0, flags: 0, documents: 0 };
  let initialDocumentRequests: number | undefined;
  page.on("request", (request) => {
    if (request.url() === `${API}/product-controls`) reads.controls++;
    if (request.url() === `${API}/platform/navigation`) reads.flags++;
    if (
      request.isNavigationRequest() &&
      request.frame() === page.mainFrame() &&
      request.resourceType() === "document"
    )
      reads.documents++;
  });
  interface Gate {
    response: Promise<APIResponse>;
    release: () => void;
    done: Promise<void>;
    receive: (response: APIResponse) => void;
    open: Promise<void>;
    finish: () => void;
  }
  const queue: Gate[] = [];
  const gates: Gate[] = [];
  await page.route(`${API}/product-controls`, async (route) => {
    const gate = queue.shift();
    if (!gate) {
      await route.continue();
      return;
    }
    try {
      const response = await route.fetch();
      gate.receive(response);
      await gate.open;
      // A superseded browser request is allowed to be aborted. The delayed real
      // API response is still released, so it must not revive the older hero.
      await route.fulfill({ response }).catch((error: Error) => {
        if (!/aborted|Invalid InterceptionId|already handled|Target.*closed/i.test(error.message))
          throw error;
      });
    } finally {
      gate.finish();
    }
  });
  return {
    reads,
    holdNext() {
      let receive!: Gate["receive"], release!: Gate["release"], finish!: Gate["finish"];
      const response = new Promise<APIResponse>((resolve) => {
        receive = resolve;
      });
      const open = new Promise<void>((resolve) => {
        release = resolve;
      });
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const gate = { response, receive, release, open, done, finish };
      queue.push(gate);
      gates.push(gate);
      return gate;
    },
    releaseAll() {
      for (const gate of gates) gate.release();
    },
    async expectReads(total: number) {
      // The initial locale middleware redirect is permitted. No later route
      // action may request a fresh document.
      if (total === 1) initialDocumentRequests ??= reads.documents;
      await expect
        .poll(() => ({ controls: reads.controls, flags: reads.flags }))
        .toEqual({ controls: total, flags: total });
      await animationFrames(page);
      expect(reads).toEqual({ controls: total, flags: total, documents: initialDocumentRequests });
    },
  };
}

// Sample every painted frame, including the first Home frame. Hidden Next
// Activity trees do not count as a visible hero. The marker also proves that
// every later navigation stays in this same browser document.
async function guardStaleFrames(page: Page, video: Video) {
  await page.evaluate(({ title, slug }) => {
    const state = window as typeof window & {
      heroLifecycleGuard?: { leaks: string[]; stop: () => void };
      heroLifecycleDocument?: string;
    };
    state.heroLifecycleGuard?.stop();
    state.heroLifecycleDocument ??= crypto.randomUUID();
    const leaks: string[] = [];
    let active = true;
    function sample() {
      if (!active) return;
      if (location.pathname === "/")
        for (const node of document.querySelectorAll(
          'section[aria-labelledby="ayin-hero-title"]',
        )) {
          if (!(node instanceof HTMLElement) || !node.checkVisibility()) continue;
          const text = node.querySelector("h1")?.textContent ?? "";
          const href =
            node.querySelector('[data-tv-focus-id="hero-primary"]')?.getAttribute("href") ?? "";
          if (text.includes(title) || href.includes(slug)) leaks.push(`${text} | ${href}`);
        }
      requestAnimationFrame(sample);
    }
    state.heroLifecycleGuard = {
      leaks,
      stop: () => {
        active = false;
      },
    };
    requestAnimationFrame(sample);
  }, video);
  return page.evaluate(
    () => (window as typeof window & { heroLifecycleDocument: string }).heroLifecycleDocument,
  );
}
async function expectNoStaleFrames(page: Page, documentId: string) {
  await animationFrames(page);
  const actual = await page.evaluate(() => {
    const state = window as typeof window & {
      heroLifecycleGuard: { leaks: string[] };
      heroLifecycleDocument: string;
    };
    return { leaks: state.heroLifecycleGuard.leaks, documentId: state.heroLifecycleDocument };
  });
  expect(actual).toEqual({ leaks: [], documentId });
}

// Do not replace these links/history actions with page.goto or reload: that
// would remount the provider and hide the persistent-layout regression.
test("real soft Home → Search → Home clears a now-private hero before the held current response", async ({
  page,
  catalog,
}) => {
  const probe = await observe(page);
  try {
    await page.goto("/?lang=en");
    await expectFeature(page, catalog.videos.primary);
    await probe.expectReads(1);
    await hero(page).locator('[data-tv-focus-id="hero-secondary"]').click();
    await expect(page).toHaveURL(/\/search$/);
    // Let the Search activation settle before gating Home. Deliberately do not
    // assert its read count here: the pre-fix failure must prove stale hero UI,
    // rather than stop earlier at the missing refresh request.
    await expect(searchLink(page)).toHaveAttribute("aria-current", "page");
    await animationFrames(page);
    mutate(catalog, "policy", { video: "primary", state: "private" });
    const current = probe.holdNext();
    const documentId = await guardStaleFrames(page, catalog.videos.primary);
    await homeLink(page).click();
    await expect(page).toHaveURL(/\/$/);
    await expectFallback(page);
    const response = await current.response;
    expect(response.ok()).toBe(true);
    expect((await response.json()).resolvedHero).toBeNull();
    await expectNoStaleFrames(page, documentId);
    current.release();
    await current.done;
    await expectFallback(page);
    await probe.expectReads(3);
    await expectNoStaleFrames(page, documentId);
  } finally {
    probe.releaseAll();
  }
});

test("real Back and Forward revalidate revoked and expired hero policy without a document reload", async ({
  page,
  catalog,
}) => {
  const probe = await observe(page);
  try {
    await page.goto("/?lang=en");
    await expectFeature(page, catalog.videos.primary);
    await probe.expectReads(1);
    await searchLink(page).click();
    await expect(page).toHaveURL(/\/search$/);
    await probe.expectReads(2);
    mutate(catalog, "policy", { video: "primary", state: "revoked" });
    const back = probe.holdNext();
    const documentId = await guardStaleFrames(page, catalog.videos.primary);
    await page.goBack();
    await expectFallback(page);
    expect((await (await back.response).json()).resolvedHero).toBeNull();
    await expectNoStaleFrames(page, documentId);
    back.release();
    await back.done;
    await probe.expectReads(3);
    await page.goForward();
    await expect(page).toHaveURL(/\/search$/);
    await probe.expectReads(4);
    mutate(catalog, "policy", { video: "primary", state: "expired" });
    const again = probe.holdNext();
    await page.goBack();
    await expectFallback(page);
    expect((await (await again.response).json()).resolvedHero).toBeNull();
    await expectNoStaleFrames(page, documentId);
    again.release();
    await again.done;
    await probe.expectReads(5);
    await expectFallback(page);
  } finally {
    probe.releaseAll();
  }
});

test("real cookie identity uses its changed owned default Kids profile when Home is reactivated", async ({
  page,
  catalog,
}) => {
  const login = await page.request.post(`${API}/auth/login`, {
    data: { email: catalog.email, password: catalog.password },
  });
  expect(login.ok()).toBe(true);
  const identity = await (await page.request.get(`${API}/auth/me`)).json();
  expect(identity.account.id).toBe(catalog.accountId);
  expect(identity.profile).toMatchObject({ id: catalog.profileId, isKids: false });
  const probe = await observe(page);
  try {
    await page.goto("/?lang=en");
    await expectFeature(page, catalog.videos.primary);
    await probe.expectReads(1);
    await searchLink(page).click();
    await expect(page).toHaveURL(/\/search$/);
    await probe.expectReads(2);
    mutate(catalog, "default-kids", { isKids: true });
    const current = probe.holdNext();
    const documentId = await guardStaleFrames(page, catalog.videos.primary);
    await homeLink(page).click();
    await expectFallback(page);
    expect((await (await current.response).json()).resolvedHero).toBeNull();
    await expectNoStaleFrames(page, documentId);
    current.release();
    await current.done;
    await probe.expectReads(3);
    expect((await (await page.request.get(`${API}/auth/me`)).json()).profile).toMatchObject({
      id: catalog.profileId,
      isKids: true,
    });
    await expectFallback(page);
    // The same account becomes eligible again after its own default profile
    // returns to adult mode. No forged Kids header/query or replacement cookie.
    await searchLink(page).click();
    await probe.expectReads(4);
    mutate(catalog, "default-kids", { isKids: false });
    await page.evaluate(() =>
      (
        window as typeof window & { heroLifecycleGuard: { stop: () => void } }
      ).heroLifecycleGuard.stop(),
    );
    await page.goBack();
    await expectFeature(page, catalog.videos.primary);
    await probe.expectReads(5);
  } finally {
    probe.releaseAll();
  }
});

test("real overlapping soft returns commit only the latest hero response and keep one fetch owner", async ({
  page,
  catalog,
}) => {
  const probe = await observe(page);
  try {
    await page.goto("/?lang=en");
    await expectFeature(page, catalog.videos.primary);
    await probe.expectReads(1);
    await searchLink(page).click();
    await expect(page).toHaveURL(/\/search$/);
    await probe.expectReads(2);
    const older = probe.holdNext();
    const documentId = await guardStaleFrames(page, catalog.videos.primary);
    await homeLink(page).click();
    await expectFallback(page);
    expect((await (await older.response).json()).resolvedHero.entityId).toBe(
      catalog.videos.primary.id,
    );
    await expectNoStaleFrames(page, documentId);
    await searchLink(page).click();
    await expect(page).toHaveURL(/\/search$/);
    await probe.expectReads(4);
    mutate(catalog, "hero", { video: "replacement" });
    const newest = probe.holdNext();
    await homeLink(page).click();
    await expectFallback(page);
    expect((await (await newest.response).json()).resolvedHero.entityId).toBe(
      catalog.videos.replacement.id,
    );
    newest.release();
    await newest.done;
    await expectFeature(page, catalog.videos.replacement);
    older.release();
    await older.done;
    await animationFrames(page);
    await expectFeature(page, catalog.videos.replacement);
    await expectNoStaleFrames(page, documentId);
    await probe.expectReads(5);
  } finally {
    probe.releaseAll();
  }
});

test("simulated persisted pageshow and hidden → visible restoration revalidate real current API policy", async ({
  page,
  catalog,
}) => {
  const probe = await observe(page);
  try {
    await page.goto("/?lang=en");
    await expectFeature(page, catalog.videos.primary);
    await probe.expectReads(1);
    // Synthetic PageTransitionEvent is deterministic event-handler coverage,
    // not a claim that this browser run entered its genuine BFCache.
    mutate(catalog, "policy", { video: "primary", state: "private" });
    const restored = probe.holdNext();
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
    );
    await expectFallback(page);
    const documentId = await guardStaleFrames(page, catalog.videos.primary);
    expect((await (await restored.response).json()).resolvedHero).toBeNull();
    await expectNoStaleFrames(page, documentId);
    restored.release();
    await restored.done;
    await probe.expectReads(2);
    mutate(catalog, "policy", { video: "primary", state: "public" });
    mutate(catalog, "hero", { video: "replacement" });
    const visible = probe.holdNext();
    // This explicitly simulates browser visibility restoration. It does not
    // use a reload or claim an OS-level background/tab lifecycle transition.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      // A persisted pageshow can arrive before the document becomes visible.
      // It must not restart policy reads or repopulate a suspended snapshot.
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await expectFallback(page);
    await probe.expectReads(2);
    await page.evaluate(() => {
      Reflect.deleteProperty(document, "visibilityState");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expectFallback(page);
    expect((await (await visible.response).json()).resolvedHero.entityId).toBe(
      catalog.videos.replacement.id,
    );
    visible.release();
    await visible.done;
    await expectFeature(page, catalog.videos.replacement);
    await probe.expectReads(3);
    await expectNoStaleFrames(page, documentId);
  } finally {
    probe.releaseAll();
  }
});

test("real owned session revocation returns 401 on soft Home reactivation without a stale hero", async ({
  page,
  catalog,
}) => {
  const login = await page.request.post(`${API}/auth/login`, {
    data: { email: catalog.email, password: catalog.password },
  });
  expect(login.ok()).toBe(true);
  const probe = await observe(page);
  try {
    await page.goto("/?lang=en");
    await expectFeature(page, catalog.videos.primary);
    await probe.expectReads(1);
    await searchLink(page).click();
    await expect(page).toHaveURL(/\/search$/);
    await probe.expectReads(2);
    mutate(catalog, "revoke-sessions", {});
    const current = probe.holdNext();
    const documentId = await guardStaleFrames(page, catalog.videos.primary);
    await homeLink(page).click();
    await expectFallback(page);
    expect((await current.response).status()).toBe(401);
    await expectNoStaleFrames(page, documentId);
    current.release();
    await current.done;
    await expect(hero(page)).toContainText("Featured content could not be loaded.");
    await expect(hero(page).getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    await expectFallback(page);
    await probe.expectReads(3);
    await expectNoStaleFrames(page, documentId);
  } finally {
    probe.releaseAll();
  }
});

test("real same-Home sign out revalidates current private policy without route navigation", async ({
  page,
  catalog,
}) => {
  const login = await page.request.post(`${API}/auth/login`, {
    data: { email: catalog.email, password: catalog.password },
  });
  expect(login.ok()).toBe(true);
  const probe = await observe(page);
  try {
    await page.goto("/?lang=en");
    await expectFeature(page, catalog.videos.primary);
    await probe.expectReads(1);
    const originalURL = page.url();
    const signOut = page.locator('[data-tv-focus-id="session-log-out"]:visible');
    await expect(signOut).toBeVisible();
    mutate(catalog, "policy", { video: "primary", state: "private" });
    const current = probe.holdNext();
    const loggedOut = page.waitForResponse(`${API}/auth/logout`);
    await signOut.click();
    expect((await loggedOut).ok()).toBe(true);
    await expectFallback(page);
    const documentId = await guardStaleFrames(page, catalog.videos.primary);
    expect((await (await current.response).json()).resolvedHero).toBeNull();
    await expectNoStaleFrames(page, documentId);
    current.release();
    await current.done;
    await expect(page.locator('[data-tv-focus-id="session-sign-in"]:visible')).toBeVisible();
    await expect(page).toHaveURL(originalURL);
    await expectFallback(page);
    await probe.expectReads(2);
    expect((await page.request.get(`${API}/auth/me`)).status()).toBe(401);
    await expectNoStaleFrames(page, documentId);
  } finally {
    probe.releaseAll();
  }
});

for (const outcome of ["successful", "uncertain"] as const) {
  test(`real delayed ${outcome} logout remains suspended until foreground policy revalidation`, async ({
    page,
    catalog,
  }) => {
    expect(
      (
        await page.request.post(`${API}/auth/login`, {
          data: { email: catalog.email, password: catalog.password },
        })
      ).ok(),
    ).toBe(true);
    const probe = await observe(page);
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    let received!: (status: number) => void;
    const serverLogout = new Promise<number>((resolve) => {
      received = resolve;
    });
    await page.route(`${API}/auth/logout`, async (route) => {
      const response = await route.fetch();
      received(response.status());
      await delayed;
      if (outcome === "successful") await route.fulfill({ response });
      else await route.abort("failed");
    });
    try {
      await page.goto("/?lang=en");
      await expectFeature(page, catalog.videos.primary);
      await probe.expectReads(1);
      await page.locator('[data-tv-focus-id="session-log-out"]:visible').click();
      expect(await serverLogout).toBe(204);
      // The server has completed logout, but the browser response is held while
      // the document is backgrounded. This is explicit visibility simulation.
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expectFallback(page);
      const documentId = await guardStaleFrames(page, catalog.videos.primary);
      release();
      await expect(page.locator('[data-tv-focus-id="session-sign-in"]:visible')).toBeVisible();
      await animationFrames(page);
      await expectFallback(page);
      await probe.expectReads(1);
      expect((await page.request.get(`${API}/auth/me`)).status()).toBe(401);
      mutate(catalog, "policy", { video: "primary", state: "private" });
      const current = probe.holdNext();
      await page.evaluate(() => {
        Reflect.deleteProperty(document, "visibilityState");
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("focus"));
      });
      await expectFallback(page);
      const response = await current.response;
      expect([200, 401]).toContain(response.status());
      if (response.ok()) expect((await response.json()).resolvedHero).toBeNull();
      await expectNoStaleFrames(page, documentId);
      current.release();
      await current.done;
      await probe.expectReads(2);
      await expectFallback(page);
      await expectNoStaleFrames(page, documentId);
    } finally {
      release();
      probe.releaseAll();
      await page.evaluate(() => Reflect.deleteProperty(document, "visibilityState"));
    }
  });
}

test("visible persisted pageshow resumes a suspended snapshot and ordinary visible retry still works", async ({
  page,
  catalog,
}) => {
  const probe = await observe(page);
  try {
    await page.goto("/?lang=en");
    await expectFeature(page, catalog.videos.primary);
    await probe.expectReads(1);
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
    );
    await expectFallback(page);
    const documentId = await guardStaleFrames(page, catalog.videos.primary);
    mutate(catalog, "hero", { video: "replacement" });
    const restored = probe.holdNext();
    // Unlike a retry, a visible persisted pageshow is an explicit resume signal.
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
    );
    await expectFallback(page);
    expect((await (await restored.response).json()).resolvedHero.entityId).toBe(
      catalog.videos.replacement.id,
    );
    restored.release();
    await restored.done;
    await expectFeature(page, catalog.videos.replacement);
    await probe.expectReads(2);
    await expectNoStaleFrames(page, documentId);
    const fail = (route: Route) => route.abort("failed");
    await page.route(`${API}/product-controls`, fail);
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
    );
    const retry = hero(page).getByRole("button", { name: "Try again", exact: true });
    await expect(retry).toBeVisible();
    await expectFallback(page);
    await probe.expectReads(3);
    await page.unroute(`${API}/product-controls`, fail);
    const retried = probe.holdNext();
    await retry.click();
    expect((await (await retried.response).json()).resolvedHero.entityId).toBe(
      catalog.videos.replacement.id,
    );
    retried.release();
    await retried.done;
    await expectFeature(page, catalog.videos.replacement);
    await probe.expectReads(4);
    await expectNoStaleFrames(page, documentId);
  } finally {
    probe.releaseAll();
  }
});
