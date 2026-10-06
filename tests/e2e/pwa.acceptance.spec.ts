import { expect, test } from "@playwright/test";

test("PWA stores only public assets and displays a neutral offline page", async ({
  page,
  context,
}) => {
  await page.goto("/?lang=en");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await page.evaluate(async () => {
    await fetch("/api/public/not-a-real-destination").catch(() => undefined);
    await fetch("/my-ayin", { cache: "no-store" });
  });
  const cached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith("ayin-pwa-"));
    const urls: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(new URL(request.url).pathname);
    }
    return { names, urls };
  });
  expect(cached.names).toEqual(["ayin-pwa-v4-static"]);
  expect(cached.urls).toContain("/offline.html");
  expect(
    cached.urls.every(
      (url) =>
        url.startsWith("/_next/static/") ||
        ["/offline.html", "/icons/ayin-192.svg", "/icons/ayin-512.svg"].includes(url),
    ),
  ).toBe(true);
  for (const locale of ["ar", "en"]) {
    await page.goto(`/browse?lang=${locale}`);
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  }
  // Route worker-owned fetches too: page-level network emulation alone can
  // leave a Chromium service worker network request online.
  await context.route("**/*", async (route) => {
    if (route.request().serviceWorker()) return route.abort("internetdisconnected");
    return route.continue();
  });
  await context.setOffline(true);
  try {
    await page.goto("/creator/upload");
    await expect(
      page.getByText("You’re offline. Connect to the internet to load AYIN."),
    ).toBeVisible();
    await expect(page.getByText("أنت غير متصل. اتصل بالإنترنت لتحميل AYIN.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Try again · إعادة المحاولة" })).toBeVisible();
  } finally {
    await context.setOffline(false);
    await context.unroute("**/*");
  }
});

test("accepting an update reloads only after the new controller takes over", async ({ page }) => {
  await page.addInitScript(() => {
    const events = new EventTarget();
    const worker = new EventTarget();
    Object.assign(worker, {
      state: "installed",
      postMessage: () => {
        document.documentElement.dataset.updateRequested = "true";
      },
    });
    const registration = Object.assign(new EventTarget(), { waiting: worker, installing: null });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: Object.assign(events, {
        controller: worker,
        ready: Promise.resolve(registration),
        register: async () => registration,
      }),
    });
  });
  let navigations = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations += 1;
  });
  await page.goto("/?lang=en");
  const original = navigations;
  await expect(page.getByText("AYIN update ready. Save your work before reloading.")).toBeVisible();
  await page.getByRole("button", { name: "Update and reload" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-update-requested", "true");
  expect(navigations).toBe(original);
  await expect(page.getByRole("button", { name: "Updating…" })).toBeDisabled();
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event("controllerchange")));
  await expect.poll(() => navigations).toBeGreaterThan(original);
});
