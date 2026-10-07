import { expect, test, type Page } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001";
const timeoutMs = 15_001;
const accountError = "We couldn’t verify your account. Try again to continue.";
const discoveryError = "We couldn’t load discovery for your current viewer.";
test.use({ serviceWorkers: "block" });

interface TimingWindow extends Window {
  bootstrapTiming: { held: number; enabled: boolean; release: () => void };
}

// Preserve real API status and bytes, delaying only completion of streamed
// response bodies. Route interception alone cannot hold bytes after headers.
async function holdBodies(page: Page, pathname: string) {
  await page.addInitScript(
    ({ pathname }) => {
      const originalFetch = window.fetch.bind(window);
      const releases: Array<() => void> = [];
      const probe = {
        held: 0,
        enabled: true,
        release() {
          probe.enabled = false;
          for (const release of releases.splice(0)) release();
        },
      };
      (window as TimingWindow).bootstrapTiming = probe;
      window.fetch = async (input, init) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          window.location.href,
        );
        const response = await originalFetch(input, init);
        if (!probe.enabled || url.pathname !== pathname || !response.ok) return response;
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!probe.enabled) return new Response(bytes, response);
        probe.held++;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes.slice(0, 1));
              releases.push(() => {
                try {
                  controller.enqueue(bytes.slice(1));
                  controller.close();
                } catch {
                  // The deadline/retired owner already cancelled its reader.
                }
              });
            },
          }),
          { status: response.status, headers: response.headers },
        );
      };
    },
    { pathname },
  );
}

async function register(page: Page, label: string) {
  const name = `Bootstrap ${label} ${Date.now()}`;
  const response = await page.request.post(`${API}/auth/register`, {
    headers: { origin: "http://127.0.0.1:3000" },
    data: {
      name,
      email: `bootstrap-${label}-${Date.now()}@example.test`,
      password: "strong-pass-123",
    },
  });
  expect(response.status()).toBe(201);
  return name;
}

const session = (page: Page) => page.getByRole("region", { name: "Account", exact: true });
const discovery = (page: Page) => page.locator("#discovery");

test("Search identity failure exposes a retry without starting an anonymous read", async ({
  page,
}) => {
  let fail = true;
  let publicReads = 0;
  await page.route(`${API}/auth/me`, async (route) => {
    if (!fail) return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, status: 503, json: { message: "Temporary identity failure" } });
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/public/search") publicReads++;
  });
  await page.goto("/search?q=foundation&lang=en");
  const retry = page.getByRole("main").getByRole("button", { name: "Try again", exact: true });
  await expect(retry).toBeVisible();
  expect(publicReads).toBe(0);
  fail = false;
  await retry.click();
  await expect.poll(() => publicReads).toBeGreaterThan(0);
  await expect(retry).toHaveCount(0);
});

for (const phase of ["headers", "body"] as const) {
  test(`held identity ${phase} expires into retry instead of anonymous Home, then recovers`, async ({
    page,
  }) => {
    const name = await register(page, phase);
    await page.clock.install();
    let held = 0;
    let enabled = true;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => (release = resolve));
    if (phase === "body") await holdBodies(page, "/auth/me");
    else
      await page.route(`${API}/auth/me`, async (route) => {
        if (!enabled) return route.continue();
        const response = await route.fetch();
        held++;
        await waiting;
        await route.fulfill({ response }).catch((error: Error) => {
          if (!/aborted|Invalid InterceptionId|already handled|Target.*closed/i.test(error.message))
            throw error;
        });
      });
    try {
      await page.goto("/?lang=en");
      await expect
        .poll(async () =>
          phase === "body"
            ? page.evaluate(() => (window as TimingWindow).bootstrapTiming.held)
            : held,
        )
        .toBeGreaterThanOrEqual(3);
      await page.clock.fastForward(timeoutMs);
      await expect(session(page)).toContainText(accountError);
      await expect(discovery(page)).toContainText(discoveryError);
      await expect(session(page).locator('[data-tv-focus-id="session-sign-in"]')).toHaveCount(0);
      await expect(session(page)).not.toContainText(name);
      enabled = false;
      if (phase === "body")
        await page.evaluate(() => (window as TimingWindow).bootstrapTiming.release());
      await session(page).getByRole("button", { name: "Retry account check" }).click();
      await expect(session(page)).toContainText(`Signed in as ${name}`);
      await expect(discovery(page).getByRole("alert")).toHaveCount(0);
      await expect(discovery(page).getByLabel("Loading AYIN discovery")).toHaveCount(0);
      release();
      await expect(session(page)).toContainText(`Signed in as ${name}`);
    } finally {
      release();
    }
  });
}

for (const pathname of ["/platform/navigation", "/product-controls"]) {
  test(`held ${pathname} JSON ends the hero placeholder and has an explicit retry`, async ({
    page,
  }) => {
    await page.clock.install();
    await holdBodies(page, pathname);
    await page.goto("/?lang=en");
    await expect
      .poll(() => page.evaluate(() => (window as TimingWindow).bootstrapTiming.held))
      .toBe(1);
    await page.clock.fastForward(timeoutMs);
    const hero = page.locator('section[aria-labelledby="ayin-hero-title"]');
    await expect(hero).toContainText("Featured content could not be loaded.");
    await page.evaluate(() => (window as TimingWindow).bootstrapTiming.release());
    await hero.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(hero).not.toContainText("Featured content could not be loaded.");
    await expect(hero).not.toContainText("Loading featured content…");
  });
}

test("auth server failure never starts anonymous discovery and Arabic retry remains usable", async ({
  page,
}) => {
  let anonymousReads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/public/discovery/home") anonymousReads++;
  });
  await page.route(`${API}/auth/me`, (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.goto("/ar?lang=ar");
  const retry = page.locator('[data-tv-focus-id="session-retry"]');
  await expect(retry).toHaveText("إعادة التحقق من الحساب");
  await expect(page.locator('[data-tv-focus-id="home-discovery-retry"]')).toHaveText(
    "إعادة تحميل المحتوى",
  );
  await expect(page.locator('[data-tv-focus-id="session-sign-in"]')).toHaveCount(0);
  expect(anonymousReads).toBe(0);
  await page.unroute(`${API}/auth/me`);
  await retry.click();
  await expect(page.locator('[data-tv-focus-id="session-sign-in"]')).toBeVisible();
  await expect.poll(() => anonymousReads).toBeGreaterThan(0);
});

test("held discovery body expires visibly and retry removes stale rows", async ({ page }) => {
  await page.clock.install();
  await holdBodies(page, "/public/discovery/home");
  await page.goto("/?lang=en");
  await expect
    .poll(() => page.evaluate(() => (window as TimingWindow).bootstrapTiming.held))
    .toBe(1);
  await page.clock.fastForward(timeoutMs);
  await expect(discovery(page)).toContainText(discoveryError);
  await page.evaluate(() => (window as TimingWindow).bootstrapTiming.release());
  await discovery(page).getByRole("button", { name: "Retry discovery" }).click();
  await expect(discovery(page).getByRole("alert")).toHaveCount(0);
  await expect(discovery(page).getByLabel("Loading AYIN discovery")).toHaveCount(0);
});

test("blur cancels held Home bodies silently and a new foreground owner wins", async ({ page }) => {
  const oldName = await register(page, "old-owner");
  await page.clock.install();
  await holdBodies(page, "/auth/me");
  await page.goto("/?lang=en");
  await expect
    .poll(() => page.evaluate(() => (window as TimingWindow).bootstrapTiming.held))
    .toBeGreaterThanOrEqual(3);
  await page.evaluate(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
    window.dispatchEvent(new Event("blur"));
  });
  await page.clock.fastForward(timeoutMs);
  await expect(session(page).getByRole("alert")).toHaveCount(0);
  await expect(discovery(page).getByRole("alert")).toHaveCount(0);
  const newName = await register(page, "new-owner");
  await page.evaluate(() => {
    (window as TimingWindow).bootstrapTiming.release();
    Reflect.deleteProperty(document, "hasFocus");
    window.dispatchEvent(new Event("focus"));
  });
  await expect(session(page)).toContainText(`Signed in as ${newName}`);
  await expect(session(page)).not.toContainText(oldName);
  await expect(discovery(page).getByLabel("Loading AYIN discovery")).toHaveCount(0);
});

test("published Home identity and rows are concealed in the blur event before a new viewer read", async ({
  page,
}) => {
  const name = await register(page, "visible-owner");
  await page.goto("/?lang=en");
  await expect(session(page)).toContainText(`Signed in as ${name}`);
  await expect(discovery(page).locator("[data-private-viewer-state]")).toBeVisible();
  const visibleAfterBlur = await page.evaluate(() => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
    window.dispatchEvent(new Event("blur"));
    return [...document.querySelectorAll<HTMLElement>("main [data-private-viewer-state]")].filter(
      (node) => node.checkVisibility(),
    ).length;
  });
  expect(visibleAfterBlur).toBe(0);
  await expect(session(page)).not.toContainText(name);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hasFocus");
    window.dispatchEvent(new Event("focus"));
  });
  await expect(session(page)).toContainText(`Signed in as ${name}`);
  await expect(discovery(page).locator("[data-private-viewer-state]")).toBeVisible();
});
