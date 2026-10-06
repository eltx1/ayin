import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test as base, type APIResponse, type Page } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001";
interface Catalog {
  fixtureId: string;
  accountId: string;
  profileId: string;
  alternateProfileId: string;
  email: string;
  password: string;
  query: string;
  videos: Record<"adult" | "kids", { id: string; title: string; slug: string }>;
}
function fixture<T = { ok: boolean }>(command: string, payload: object = {}): T {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve("tests/e2e/search-viewer-fixture.mjs"), command, JSON.stringify(payload)],
      {
        env: process.env,
        encoding: "utf8",
      },
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
const suggestions = (page: Page) => main(page).locator("#ayin-search-suggestions");
const results = (page: Page) => main(page).getByRole("region");
const box = (page: Page) => main(page).getByRole("searchbox");
const mutate = (catalog: Catalog, command: string, data: object) =>
  fixture(command, { fixtureId: catalog.fixtureId, ...data });
async function login(page: Page, catalog: Catalog) {
  const response = await page.request.post(`${API}/auth/login`, {
    headers: { origin: new URL(page.url()).origin },
    data: { email: catalog.email, password: catalog.password },
  });
  expect(response.status()).toBe(200);
}
async function search(page: Page, catalog: Catalog, locale = "en") {
  return page.goto(
    `${locale === "ar" ? "/ar" : ""}/search?${new URLSearchParams({ q: catalog.query, lang: locale })}`,
  );
}
async function expectAdult(page: Page, catalog: Catalog) {
  await expect(
    results(page).getByRole("link", { name: new RegExp(catalog.videos.adult.title) }),
  ).toBeVisible();
}
async function expectKids(page: Page, catalog: Catalog) {
  await expect(
    results(page).getByRole("link", { name: new RegExp(catalog.videos.kids.title) }),
  ).toBeVisible();
  await expect(results(page).locator(`a[href*="${catalog.videos.adult.slug}"]`)).toHaveCount(0);
  await expect(results(page).locator(`a[href*="${catalog.videos.kids.slug}"]`)).toHaveAttribute(
    "href",
    /\?kids=1$/,
  );
}
async function refocus(page: Page) {
  await main(page).getByRole("heading", { level: 1 }).click();
  await box(page).focus();
}

// Hold only response timing. Every payload and authentication decision comes
// from the actual API; request cancellation is deliberately allowed to race it.
async function delays(page: Page) {
  type Gate = {
    endpoint: "results" | "suggestions";
    response: Promise<APIResponse>;
    receive: (response: APIResponse) => void;
    open: Promise<void>;
    release: () => void;
    done: Promise<void>;
    finish: () => void;
  };
  const pending: Gate[] = [],
    all: Gate[] = [];
  await page.route(
    (url) =>
      url.origin === new URL(API).origin &&
      ["/public/search", "/public/search/suggestions"].includes(url.pathname),
    async (route) => {
      const endpoint = new URL(route.request().url()).pathname.endsWith("suggestions")
        ? "suggestions"
        : "results";
      const index = pending.findIndex((item) => item.endpoint === endpoint);
      if (index < 0) {
        await route.continue();
        return;
      }
      const gate = pending.splice(index, 1)[0]!;
      try {
        const response = await route.fetch();
        gate.receive(response);
        await gate.open;
        await route.fulfill({ response }).catch((error: Error) => {
          if (!/aborted|Invalid InterceptionId|already handled|Target.*closed/i.test(error.message))
            throw error;
        });
      } finally {
        gate.finish();
      }
    },
  );
  return {
    hold(endpoint: Gate["endpoint"]) {
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
      const gate = { endpoint, response, receive, open, release, done, finish };
      pending.push(gate);
      all.push(gate);
      return gate;
    },
    releaseAll() {
      for (const gate of all) gate.release();
    },
  };
}

for (const locale of ["en", "ar"] as const) {
  test(`autocomplete native dismissal and late-response lifecycle in ${locale}`, async ({
    page,
    catalog,
  }, testInfo) => {
    const timing = await delays(page);
    try {
      await search(page, catalog, locale);
      await expectAdult(page, catalog);
      await expect(suggestions(page)).toHaveCount(0);
      const held = timing.hold("suggestions");
      await box(page).focus();
      expect((await held.response).ok()).toBe(true);
      await page.keyboard.press("Escape");
      held.release();
      await held.done;
      await expect(suggestions(page)).toHaveCount(0);
      await expect(box(page)).toBeFocused();
      await refocus(page);
      await expect(suggestions(page)).toBeVisible();
      await page.keyboard.press("ArrowDown");
      await expect(suggestions(page).getByRole("link").first()).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(box(page)).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        main(page).getByRole("button", { name: locale === "ar" ? "بحث" : "Search", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(suggestions(page).getByRole("link").first()).toBeFocused();
      await page.screenshot({
        path: testInfo.outputPath(`suggestion-native-keyboard-${locale}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(suggestions(page)).toHaveCount(0);
      await refocus(page);
      await expect(suggestions(page)).toBeVisible();
      await main(page).getByRole("heading", { level: 1 }).click();
      await expect(suggestions(page)).toHaveCount(0);
      await box(page).focus();
      await expect(suggestions(page)).toBeVisible();
      await box(page).fill("x");
      await expect(suggestions(page)).toHaveCount(0);
      await box(page).fill(catalog.query);
      await expect(suggestions(page)).toBeVisible();
      await box(page).press("End");
      await box(page).press("Space");
      await expect(suggestions(page)).toBeVisible();
      await box(page).press("Enter");
      await expectAdult(page, catalog);
      await expect(suggestions(page)).toHaveCount(0);
      await box(page).focus();
      await expect(suggestions(page)).toBeVisible();
      const selected = suggestions(page).getByRole("link").first();
      const destination = new URL((await selected.getAttribute("href"))!, page.url()).href;
      await selected.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(destination);
      await expect(page.locator("#ayin-search-suggestions:visible")).toHaveCount(0);
    } finally {
      timing.releaseAll();
    }
  });
}

test("newer query and locale discard held autocomplete responses", async ({ page, catalog }) => {
  const timing = await delays(page);
  try {
    await search(page, catalog);
    await expectAdult(page, catalog);
    const queryGate = timing.hold("suggestions");
    await box(page).focus();
    expect((await queryGate.response).ok()).toBe(true);
    await box(page).fill(catalog.videos.adult.title);
    await expect(suggestions(page).getByRole("link")).toHaveCount(1);
    await expect(suggestions(page)).toContainText(catalog.videos.adult.title);
    queryGate.release();
    await queryGate.done;
    await expect(suggestions(page).getByRole("link")).toHaveCount(1);
    const localeGate = timing.hold("suggestions");
    await box(page).fill(catalog.query);
    expect((await localeGate.response).ok()).toBe(true);
    await search(page, catalog, "ar");
    await expectAdult(page, catalog);
    localeGate.release();
    await localeGate.done;
    await expect(suggestions(page)).toHaveCount(0);
    await box(page).focus();
    await expect(suggestions(page)).toBeVisible();
    for (const link of await suggestions(page).getByRole("link").all())
      await expect(link).toHaveAttribute("href", /^\/ar\//);
  } finally {
    timing.releaseAll();
  }
});

test("authenticated Kids ordinary search starts neutral and never embeds adult result data", async ({
  page,
  catalog,
}, testInfo) => {
  await page.goto("/");
  await login(page, catalog);
  mutate(catalog, "default-kids", { isKids: true });
  const response = await search(page, catalog, "ar");
  expect(await response!.text()).not.toContain(catalog.videos.adult.title);
  await expectKids(page, catalog);
  await box(page).focus();
  await expect(suggestions(page)).toBeVisible();
  await expect(suggestions(page).locator(`a[href*="${catalog.videos.adult.slug}"]`)).toHaveCount(0);
  await expect(suggestions(page).locator(`a[href*="${catalog.videos.kids.slug}"]`)).toHaveAttribute(
    "href",
    /\?kids=1$/,
  );
  await page.keyboard.press("Escape");
  await page.screenshot({ path: testInfo.outputPath("authenticated-kids-ordinary-search-ar.png") });
});

test("profile changes conceal existing results synchronously and discard held adult suggestions and results", async ({
  page,
  catalog,
}, testInfo) => {
  await page.goto("/");
  await login(page, catalog);
  const timing = await delays(page);
  try {
    await search(page, catalog);
    await expectAdult(page, catalog);
    const adultResults = results(page);
    const priorNode = await adultResults.elementHandle();
    const suggestionsGate = timing.hold("suggestions");
    await box(page).focus();
    expect((await suggestionsGate.response).ok()).toBe(true);
    const synchronous = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll<HTMLElement>("main [data-private-viewer-state]")];
      window.dispatchEvent(new Event("blur"));
      return nodes.every((node) => !node.checkVisibility());
    });
    expect(synchronous).toBe(true);
    const resultGate = timing.hold("results");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    expect((await resultGate.response).ok()).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    mutate(catalog, "switch-default", { alternate: true });
    mutate(catalog, "default-kids", { isKids: true });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expectKids(page, catalog);
    suggestionsGate.release();
    resultGate.release();
    await Promise.all([suggestionsGate.done, resultGate.done]);
    await expectKids(page, catalog);
    await expect(suggestions(page)).toHaveCount(0);
    expect(await priorNode?.evaluate((node) => (node as HTMLElement).checkVisibility())).toBe(
      false,
    );
    await refocus(page);
    await expect(suggestions(page)).toBeVisible();
    await expect(suggestions(page).locator(`a[href*="${catalog.videos.adult.slug}"]`)).toHaveCount(
      0,
    );
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: testInfo.outputPath("search-profile-switch-discards-late-adult.png"),
    });
  } finally {
    timing.releaseAll();
  }
});

test("account changes discard held results before the new Kids account becomes visible", async ({
  page,
  catalog,
}) => {
  const next = fixture<Catalog>("seed");
  const timing = await delays(page);
  try {
    mutate(next, "default-kids", { isKids: true });
    await page.goto("/");
    await login(page, catalog);
    await search(page, catalog);
    await expectAdult(page, catalog);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    const resultGate = timing.hold("results");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    expect((await resultGate.response).ok()).toBe(true);
    const suggestionGate = timing.hold("suggestions");
    await refocus(page);
    expect((await suggestionGate.response).ok()).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await login(page, next);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    // The new account's Kids policy also filters the original account's public catalog query.
    await expectKids(page, catalog);
    resultGate.release();
    suggestionGate.release();
    await Promise.all([resultGate.done, suggestionGate.done]);
    await expectKids(page, catalog);
    await expect(suggestions(page)).toHaveCount(0);
    await refocus(page);
    await expect(suggestions(page)).toBeVisible();
    await expect(suggestions(page).locator(`a[href*="${catalog.videos.adult.slug}"]`)).toHaveCount(
      0,
    );
  } finally {
    timing.releaseAll();
    fixture("cleanup", { fixtureId: next.fixtureId });
  }
});

test("Escape closes suggestions without invoking the existing TV Back handler", async ({
  page,
  catalog,
}) => {
  // Exercise the real webOS event routing with a controlled platform marker,
  // not a claim about remote-control hardware or decoded playback.
  await page.addInitScript(() => {
    Object.defineProperty(window, "webOS", { value: {} });
  });
  await page.goto("/");
  await search(page, catalog);
  await expect(page.locator("html")).toHaveAttribute("data-tv-platform", "webos");
  await expectAdult(page, catalog);
  await box(page).focus();
  await expect(suggestions(page)).toBeVisible();
  const searchUrl = page.url();
  await page.keyboard.press("Escape");
  await expect(suggestions(page)).toHaveCount(0);
  await page.waitForTimeout(150);
  await expect(page).toHaveURL(searchUrl);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/(?:\?lang=en)?$/);
});

test("malformed successful responses show unavailable or no suggestions without a render crash", async ({
  page,
  catalog,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(
    (url) => url.origin === new URL(API).origin && url.pathname === "/public/search",
    (route) => route.fulfill({ json: {} }),
  );
  await search(page, catalog);
  await expect(
    main(page).getByRole("heading", { name: "Search unavailable", exact: true }),
  ).toBeVisible();
  await page.unrouteAll();
  await search(page, catalog);
  await expectAdult(page, catalog);
  await page.route(
    (url) => url.origin === new URL(API).origin && url.pathname === "/public/search/suggestions",
    (route) => route.fulfill({ json: {} }),
  );
  await box(page).focus();
  await page.waitForTimeout(500);
  await expect(suggestions(page)).toHaveCount(0);
  await expectAdult(page, catalog);
  expect(errors).toEqual([]);
});
