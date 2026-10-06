import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const WEB = "http://127.0.0.1:3100";
const API = "http://127.0.0.1:3001";
test.beforeEach(async ({ request }) => {
  const database = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.pathname !== "/ayin_e2e")
    throw Error("Requires isolated local ayin_e2e");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
  expect((await request.post(`${WEB}/__pwa_fixture/control?mode=v4`)).status()).toBe(204);
});
async function controlled(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
}
async function update(page: Page, mode: "v4" | "v5" | "late") {
  expect((await page.request.post(`${WEB}/__pwa_fixture/control?mode=${mode}`)).status()).toBe(204);
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.ready).update();
  });
}
async function register(page: Page, suffix: string) {
  const result = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: {
      name: "Private PWA owner",
      email: `pwa-${suffix}@e2e.ayin.test`,
      password: "strong-pass-123",
    },
  });
  expect(result.ok()).toBe(true);
  return (await result.json()).user;
}
async function cacheState(page: Page) {
  return page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith("ayin-pwa-"));
    const urls: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const entry of await cache.keys()) urls.push(new URL(entry.url).pathname);
    }
    return { names, urls };
  });
}

for (const locale of ["en", "ar"] as const)
  test(`real update preserves another tab and a dismissed native draft warning ${locale}`, async ({
    page,
    context,
  }, info) => {
    const ar = locale === "ar",
      user = await register(page, locale);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(ar ? "/ar/studio/channel" : "/studio/channel?lang=en");
    await controlled(page);
    const name = page.getByLabel(ar ? "اسم القناة" : "Channel name", { exact: true });
    await expect(name).toHaveValue(user.channel.name);
    await name.fill("Retained first-tab draft");
    const other = await context.newPage();
    await other.goto(ar ? "/ar/studio/channel" : "/studio/channel?lang=en");
    const otherName = other.getByLabel(ar ? "اسم القناة" : "Channel name", { exact: true });
    await expect(otherName).toHaveValue(user.channel.name);
    await otherName.fill("Retained second-tab draft");
    let firstNavigations = 0,
      otherNavigations = 0,
      writes = 0,
      dialogs = 0;
    page.on("request", (r) => {
      if (r.method() === "PATCH" && r.url().includes("/creator/channels/")) writes++;
      if (r.isNavigationRequest() && r.frame() === page.mainFrame()) firstNavigations++;
    });
    other.on("request", (r) => {
      if (r.isNavigationRequest() && r.frame() === other.mainFrame()) otherNavigations++;
    });
    page.on("dialog", async (dialog) => {
      expect(dialog.type()).toBe("beforeunload");
      dialogs++;
      await dialog.dismiss();
    });
    await update(page, "v5");
    const accept = ar ? "تحديث وإعادة تحميل" : "Update and reload";
    await expect(page.getByRole("button", { name: accept, exact: true })).toBeEnabled();
    await expect(other.getByRole("button", { name: accept, exact: true })).toBeEnabled();
    expect(firstNavigations).toBe(0);
    expect(otherNavigations).toBe(0);
    await page.getByRole("button", { name: accept, exact: true }).click();
    const refresh = ar ? "إعادة تحميل AYIN" : "Reload AYIN";
    await expect(page.getByRole("button", { name: refresh, exact: true })).toBeEnabled();
    await expect(other.getByRole("button", { name: refresh, exact: true })).toBeEnabled();
    await expect.poll(() => dialogs).toBe(1);
    await expect(name).toHaveValue("Retained first-tab draft");
    await expect(otherName).toHaveValue("Retained second-tab draft");
    expect(firstNavigations).toBe(0);
    expect(otherNavigations).toBe(0);
    await expect
      .poll(async () => (await cacheState(page)).names)
      .toEqual(["ayin-pwa-v5-test-static"]);
    await page.screenshot({
      path: info.outputPath(`design-pwa-refresh-390-${locale}.png`),
      fullPage: true,
    });
    expect(writes).toBe(0);
    await page
      .getByRole("button", { name: ar ? "حفظ القناة" : "Save channel", exact: true })
      .click();
    await expect(
      page.getByText(
        ar
          ? "حُفظت تغييرات القناة. توجه روابط المعرّف السابق إلى هذه القناة."
          : "Channel changes saved. Previous handle links redirect to this channel.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(writes).toBe(1);
    await page.getByRole("button", { name: refresh, exact: true }).click();
    await expect.poll(() => firstNavigations).toBe(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      ar ? "إعدادات القناة" : "Channel settings",
    );
    expect(otherNavigations).toBe(0);
    await expect(name).toHaveValue("Retained first-tab draft");
    await expect(otherName).toHaveValue("Retained second-tab draft");
    expect(dialogs).toBe(1);
    await writeFile(
      info.outputPath(`pwa-lifecycle-${locale}.json`),
      JSON.stringify(
        {
          scope:
            "Chromium production-bundle loopback software acceptance; worker version fixture only",
          locale,
          initialVersion: "v4",
          activatedVersion: "v5-test",
          dismissedNativeWarnings: dialogs,
          explicitSavedDraftWrites: writes,
          explicitRefreshNavigations: firstNavigations,
          otherTabNavigations: otherNavigations,
          ownedCacheNames: (await cacheState(page)).names,
        },
        null,
        2,
      ),
    );
  });

test("late actual activation after the deadline offers refresh without automatic navigation", async ({
  page,
}, info) => {
  await page.goto("/?lang=en");
  await controlled(page);
  let navigations = 0;
  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navigations++;
  });
  await update(page, "late");
  await page.getByRole("button", { name: "Update and reload", exact: true }).click();
  await expect(page.getByRole("button", { name: "Updating…", exact: true })).toBeDisabled();
  await expect(page.getByText("Could not complete the request. Try again.")).toBeVisible({
    timeout: 13_000,
  });
  await expect(page.getByRole("button", { name: "Update and reload", exact: true })).toBeEnabled();
  expect(navigations).toBe(0);
  await expect(page.getByRole("button", { name: "Reload AYIN", exact: true })).toBeEnabled();
  expect(navigations).toBe(0);
  await expect
    .poll(async () => (await cacheState(page)).names)
    .toEqual(["ayin-pwa-v6-late-test-static"]);
  await writeFile(
    info.outputPath("pwa-lifecycle-late.json"),
    JSON.stringify(
      {
        scope: "Actual worker fixture delays skipWaiting 15s; UI deadline remains 10s",
        navigations,
        ownedCacheNames: (await cacheState(page)).names,
      },
      null,
      2,
    ),
  );
});

test("real current-worker migration purges controlled unsafe legacy caches and preserves foreign ownership", async ({
  page,
}, info) => {
  expect((await page.request.post(`${WEB}/__pwa_fixture/control?mode=legacy`)).status()).toBe(204);
  await page.goto("/?lang=en");
  await controlled(page);
  await page.evaluate(async () => {
    await (
      await caches.open("foreign-app-static")
    ).put("/foreign", new Response("foreign sentinel"));
  });
  expect((await cacheState(page)).names).toContain("ayin-pwa-v2-read");
  let navigations = 0;
  page.on("request", (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) navigations++;
  });
  await update(page, "v4");
  await expect.poll(async () => (await cacheState(page)).names).toEqual(["ayin-pwa-v4-static"]);
  expect(await page.evaluate(async () => caches.has("foreign-app-static"))).toBe(true);
  expect(navigations).toBe(0);
  await expect(page.getByRole("button", { name: "Reload AYIN", exact: true })).toBeEnabled();
  await writeFile(
    info.outputPath("pwa-lifecycle-migration.json"),
    JSON.stringify(
      {
        scope:
          "Controlled legacy behavior fixture, not literal historical worker or physical installed device",
        ownedCacheNames: (await cacheState(page)).names,
        foreignCachePreserved: true,
        navigations,
      },
      null,
      2,
    ),
  );
});

test("authenticated reads, logout and reopened offline navigation expose only the neutral document", async ({
  page,
  context,
}, info) => {
  await register(page, "offline");
  await page.goto("/studio/channel?lang=en");
  await controlled(page);
  await expect(page.getByLabel("Channel name", { exact: true })).toBeVisible();
  const response = await page.request.post(`${API}/auth/logout`, { headers: { origin: WEB } });
  expect(response.ok()).toBe(true);
  const cached = await cacheState(page);
  expect(cached.names).toEqual(["ayin-pwa-v4-static"]);
  expect(
    cached.urls.every(
      (url) =>
        url.startsWith("/_next/static/") ||
        ["/offline.html", "/icons/ayin-192.svg", "/icons/ayin-512.svg"].includes(url),
    ),
  ).toBe(true);
  await page.close();
  await context.route("**/*", async (route) => {
    if (route.request().serviceWorker()) return route.abort("internetdisconnected");
    return route.continue();
  });
  await context.setOffline(true);
  try {
    const reopened = await context.newPage();
    await reopened.goto("/account?lang=en");
    await expect(
      reopened.getByText("You’re offline. Connect to the internet to load AYIN."),
    ).toBeVisible();
    await expect(reopened.getByText("أنت غير متصل. اتصل بالإنترنت لتحميل AYIN.")).toBeVisible();
    await expect(reopened.getByText("Private PWA owner")).toHaveCount(0);
    await expect(reopened.locator("input, textarea")).toHaveCount(0);
    await writeFile(
      info.outputPath("pwa-lifecycle-offline.json"),
      JSON.stringify(
        {
          scope: "Reopened Chromium tab, not OS installed-app startup",
          logoutAcknowledged: true,
          cachedPaths: cached.urls,
          neutralOfflineDocument: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await context.setOffline(false);
    await context.unroute("**/*");
  }
});
