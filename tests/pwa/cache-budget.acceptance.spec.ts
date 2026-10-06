import { expect, test, type Page } from "@playwright/test";

const CACHE = "ayin-pwa-v4-static";
async function drainWorker(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => reject(new Error("Cache write barrier timed out")), 5000);
        channel.port1.onmessage = () => {
          clearTimeout(timeout);
          channel.port1.close();
          resolve();
        };
        navigator.serviceWorker.controller!.postMessage({ type: "AYIN_TEST_DRAIN_CACHE" }, [
          channel.port2,
        ]);
      }),
  );
}

test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/__pwa_fixture/control?mode=v4")).status()).toBe(204);
  await page.goto("/?lang=en");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
});

test("active worker bounds three simulated deployment asset sets and keeps the neutral offline shell", async ({
  page,
  context,
}) => {
  for (const build of ["first", "second", "third"]) {
    const statuses = await page.evaluate(
      async (build) =>
        Promise.all(
          Array.from({ length: 80 }, (_, i) =>
            fetch(`/_next/static/__pwa_fixture/${build}-${i}.js`).then((r) => r.status),
          ),
        ),
      build,
    );
    expect(statuses.every((status) => status === 200)).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          async ({ name, build }) => {
            const keys = await (await caches.open(name)).keys();
            return keys.filter((r) => r.url.includes(`/__pwa_fixture/${build}-`)).length;
          },
          { name: CACHE, build },
        ),
      )
      .toBe(80);
  }
  const keys = await page.evaluate(
    async (name) => (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname),
    CACHE,
  );
  expect(keys.filter((url) => url.startsWith("/_next/static/"))).toHaveLength(128);
  expect(keys.some((url) => url.includes("/__pwa_fixture/first-"))).toBe(false);
  expect(keys).toEqual(
    expect.arrayContaining(["/offline.html", "/icons/ayin-192.svg", "/icons/ayin-512.svg"]),
  );
  await expect(
    page.getByRole("heading", { name: "Stories move differently here.", exact: true }),
  ).toBeVisible();
  await context.route("**/*", async (route) =>
    route.request().serviceWorker() ? route.abort("internetdisconnected") : route.continue(),
  );
  await context.setOffline(true);
  try {
    expect(
      await page.evaluate(() =>
        fetch("/_next/static/__pwa_fixture/third-79.js").then((r) => r.status),
      ),
    ).toBe(200);
    await page.goto("/account");
    await expect(
      page.getByText("You’re offline. Connect to the internet to load AYIN."),
    ).toBeVisible();
  } finally {
    await context.setOffline(false);
    await context.unroute("**/*");
  }
});

for (const operation of ["open", "match", "put"] as const) {
  test(`actual worker preserves network success under injected cache ${operation} failure`, async ({
    page,
    context,
  }) => {
    const worker = context.serviceWorkers().find((worker) => worker.url().endsWith("/sw.js"));
    expect(worker).toBeDefined();
    await worker!.evaluate((operation) => {
      const state = globalThis as typeof globalThis & { ayinInjectedCacheFaults: number };
      state.ayinInjectedCacheFaults = 0;
      if (operation === "open") {
        const original = CacheStorage.prototype.open;
        CacheStorage.prototype.open = function (name) {
          if (name === "ayin-pwa-v4-static") {
            state.ayinInjectedCacheFaults++;
            return Promise.reject(new DOMException("Injected storage denial", "SecurityError"));
          }
          return original.call(this, name);
        };
      } else if (operation === "match") {
        const original = Cache.prototype.match;
        Cache.prototype.match = function (request, options) {
          const url =
            typeof request === "string"
              ? request
              : request instanceof URL
                ? request.href
                : request.url;
          if (url.includes("/__pwa_fixture/fault-")) {
            state.ayinInjectedCacheFaults++;
            return Promise.reject(new DOMException("Injected lookup failure", "UnknownError"));
          }
          return original.call(this, request, options);
        };
      } else {
        const original = Cache.prototype.put;
        Cache.prototype.put = function (request, response) {
          const url =
            typeof request === "string"
              ? request
              : request instanceof URL
                ? request.href
                : request.url;
          if (url.includes("/__pwa_fixture/fault-")) {
            state.ayinInjectedCacheFaults++;
            return Promise.reject(new DOMException("Injected storage quota", "QuotaExceededError"));
          }
          return original.call(this, request, response);
        };
      }
    }, operation);
    const response = await page.evaluate(async (operation) => {
      const response = await fetch(`/_next/static/__pwa_fixture/fault-${operation}.js`);
      return { status: response.status, body: await response.text() };
    }, operation);
    expect(response.status).toBe(200);
    expect(response.body).toContain("isolated public build fixture");
    await expect
      .poll(() =>
        worker!.evaluate(
          () =>
            (globalThis as typeof globalThis & { ayinInjectedCacheFaults: number })
              .ayinInjectedCacheFaults,
        ),
      )
      .toBeGreaterThan(0);
    await expect(
      page.getByRole("heading", { name: "Stories move differently here.", exact: true }),
    ).toBeVisible();
  });
}

test("Vary header variants cannot exceed the build cap or multiply pinned shell entries", async ({
  page,
  context,
}, info) => {
  const worker = context.serviceWorkers().find((worker) => worker.url().endsWith("/sw.js"));
  expect(worker).toBeDefined();
  await worker!.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      ayinNativeCacheObservation: {
        maxBuildEntries: number;
        shellRuntimePuts: number;
        puts: number;
      };
    };
    state.ayinNativeCacheObservation = { maxBuildEntries: 0, shellRuntimePuts: 0, puts: 0 };
    const original = Cache.prototype.put;
    Cache.prototype.put = function (request, response) {
      const url =
        typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
      if (new URL(url, location.origin).pathname === "/icons/ayin-192.svg")
        state.ayinNativeCacheObservation.shellRuntimePuts++;
      return original.call(this, request, response).then(async () => {
        state.ayinNativeCacheObservation.puts++;
        const entries = (await this.keys()).filter((key) =>
          new URL(key.url).pathname.startsWith("/_next/static/"),
        ).length;
        state.ayinNativeCacheObservation.maxBuildEntries = Math.max(
          state.ayinNativeCacheObservation.maxBuildEntries,
          entries,
        );
      });
    };
  });
  await page.evaluate(async () => {
    await Promise.all(
      Array.from({ length: 128 }, (_, i) => fetch(`/_next/static/__pwa_fixture/fill-${i}.js`)),
    );
  });
  await expect
    .poll(() =>
      page.evaluate(
        async (name) =>
          (await (await caches.open(name)).keys()).filter((r) =>
            new URL(r.url).pathname.startsWith("/_next/static/"),
          ).length,
        CACHE,
      ),
    )
    .toBe(128);
  for (const variant of ["a", "b", "c"]) {
    expect(
      await page.evaluate(
        async (variant) =>
          (
            await fetch("/_next/static/__pwa_fixture/vary.js", {
              headers: { "x-ayin-pwa-variant": variant },
            })
          ).status,
        variant,
      ),
    ).toBe(200);
    await expect
      .poll(() =>
        page.evaluate(
          async ({ name, variant }) =>
            Boolean(
              await (
                await caches.open(name)
              ).match(
                new Request(`${location.origin}/_next/static/__pwa_fixture/vary.js`, {
                  headers: { "x-ayin-pwa-variant": variant },
                }),
              ),
            ),
          { name: CACHE, variant },
        ),
      )
      .toBe(true);
    await drainWorker(page);
    expect(
      await page.evaluate(
        async (name) =>
          (await (await caches.open(name)).keys()).filter((r) =>
            new URL(r.url).pathname.startsWith("/_next/static/"),
          ).length,
        CACHE,
      ),
    ).toBeLessThanOrEqual(128);
  }
  for (const variant of ["a", "b", "c", "d", "e"]) {
    expect(
      await page.evaluate(
        async (variant) =>
          (await fetch("/icons/ayin-192.svg", { headers: { "x-ayin-pwa-variant": variant } }))
            .status,
        variant,
      ),
    ).toBe(200);
  }
  // Allow all runtime fetch events to finish before reading their persistent keys.
  await drainWorker(page);
  const workerEntries = await page.evaluate(
    async (name) => (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname),
    CACHE,
  );
  expect(workerEntries.filter((url) => url === "/icons/ayin-192.svg")).toHaveLength(1);
  expect(workerEntries.filter((url) => !url.startsWith("/_next/static/"))).toHaveLength(3);
  const observed = await worker!.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          ayinNativeCacheObservation: {
            maxBuildEntries: number;
            shellRuntimePuts: number;
            puts: number;
          };
        }
      ).ayinNativeCacheObservation,
  );
  expect(observed.puts).toBeGreaterThanOrEqual(128);
  expect(observed.maxBuildEntries).toBe(128);
  expect(observed.shellRuntimePuts).toBe(0);
  await info.attach("native-cache-observation", {
    body: JSON.stringify(observed),
    contentType: "application/json",
  });
});
