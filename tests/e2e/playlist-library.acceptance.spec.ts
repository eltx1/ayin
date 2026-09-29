import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
// Only this suite intercepts reads/writes deliberately; production/PWA behavior is unchanged.
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  // This suite creates and clears fixture records: fail closed outside the dedicated
  // local Actions database, even when a developer has DATABASE_URL configured.
  const fixtureUrl = new URL(process.env.TEST_DATABASE_URL ?? "https://invalid.test");
  if (
    process.env.APP_ENV !== "test" ||
    !["localhost", "127.0.0.1"].includes(fixtureUrl.hostname) ||
    !["postgres:", "postgresql:"].includes(fixtureUrl.protocol) ||
    fixtureUrl.pathname !== "/ayin_e2e" ||
    (process.env.DATABASE_URL && process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
  ) {
    throw new Error("Playlist fixtures require the isolated local ayin_e2e database.");
  }
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});

async function register(page: Page) {
  const response = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: {
      name: "Playlist Library Creator",
      email: "playlist-library@e2e.ayin.test",
      password: "strong-pass-123",
    },
  });
  expect(response.ok()).toBe(true);
  const data = (await response.json()) as { user: { channel: { id: string } } };
  return `${API}/creator/channels/${data.user.channel.id}/playlists`;
}

const failure = {
  status: 503,
  headers: { "access-control-allow-origin": WEB, "access-control-allow-credentials": "true" },
  json: { error: { message: "Isolated fixture unavailable" } },
};

async function noOverflow(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}

test("owned library distinguishes failed loads and presents every row with EN/AR filters", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const endpoint = await register(page);
  for (let index = 0; index < 26; index += 1) {
    const response = await page.request.post(endpoint, {
      headers: { origin: WEB },
      data: {
        name: index === 1 ? "Unique private collection" : `Collection ${index} — مجموعة مميزة`,
        visibility: index % 2 ? "PRIVATE" : "PUBLIC",
      },
    });
    expect(response.ok()).toBe(true);
  }
  let failing = true;
  let reads = 0;
  await page.route(endpoint, async (route) => {
    reads += 1;
    if (failing) return route.fulfill(failure);
    await route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/studio/playlists?lang=en");
  await expect(
    page.getByText("Your playlists could not be loaded. Try again.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No playlists yet", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
  failing = false;
  await page.getByRole("button", { name: "Reload playlists", exact: true }).click();
  const table = page.getByRole("table", { name: "Your playlists", exact: true });
  await expect(table.locator("tbody tr")).toHaveCount(12);
  const seen = await table.getByRole("heading", { level: 3 }).allTextContents();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(12);
  seen.push(...(await table.getByRole("heading", { level: 3 }).allTextContents()));
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(3);
  seen.push(...(await table.getByRole("heading", { level: 3 }).allTextContents()));
  expect(new Set(seen).size).toBe(27);
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await page.getByLabel("Search playlists", { exact: true }).fill("Unique private");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.getByRole("link", { name: "Preview Unique private collection" })).toHaveCount(
    0,
  );
  await expect(table.getByRole("link", { name: "Manage Unique private collection" })).toBeVisible();
  await page.getByLabel("Filter visibility", { exact: true }).selectOption("PUBLIC");
  await expect(page.getByText("No playlists match these filters.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(table.locator("tbody tr")).toHaveCount(12);
  expect(reads).toBe(2); // failed load + explicit retry, never one request per filter/page
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("design-playlists-1440-en.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ar/studio/playlists?lang=ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("main")).toHaveCount(1);
  await page.getByLabel("البحث في القوائم", { exact: true }).fill("Unique private");
  const arabicTable = page.getByRole("table", { name: "قوائم التشغيل الخاصة بك", exact: true });
  await expect(arabicTable.locator("tbody tr")).toHaveCount(1);
  await expect(
    arabicTable.getByRole("link", { name: "إدارة Unique private collection" }),
  ).toHaveAttribute("href", /^\/ar\/channel\/playlists\//);
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("design-playlists-390-ar.png"),
    fullPage: true,
  });
});

test("creating once distinguishes committed success from a failed refresh and recovers with reads only", async ({
  page,
}, testInfo) => {
  const endpoint = await register(page);
  await page.goto("/studio/playlists?lang=en");
  await expect(page.getByRole("table", { name: "Your playlists" })).toBeVisible();
  let posts = 0;
  let failRead = false;
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "POST") {
      posts += 1;
      await held;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      failRead = true;
      return route.fulfill({ response });
    }
    if (failRead) {
      failRead = false;
      return route.fulfill(failure);
    }
    await route.continue();
  });
  await page.getByLabel("Name", { exact: true }).fill("Created once despite refresh failure");
  await page.getByLabel("Visibility", { exact: true }).selectOption("PRIVATE");
  try {
    await page.locator("main form").evaluate((element) => {
      const form = element as HTMLFormElement;
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect.poll(() => posts).toBe(1);
    await expect(page.getByRole("button", { name: "Create playlist", exact: true })).toBeDisabled();
    await expect(page.getByLabel("Name", { exact: true })).toBeDisabled();
  } finally {
    release();
  }
  await expect(
    page.getByText(
      "Playlist created, but the list could not be refreshed. Reload the list; do not create it again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Create playlist", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Reload playlists", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Created once despite refresh failure", exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
  const rows = (await (await page.request.get(endpoint)).json()).playlists as Array<{
    name: string;
  }>;
  expect(rows.filter((row) => row.name === "Created once despite refresh failure")).toHaveLength(1);
  await page.setViewportSize({ width: 360, height: 800 });
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("design-playlists-create-recovery-360.png"),
    fullPage: true,
  });
});

test("a lost create response never triggers an automatic retry and preserves the draft", async ({
  page,
}) => {
  const endpoint = await register(page);
  await page.goto("/studio/playlists?lang=en");
  await expect(page.getByRole("table", { name: "Your playlists" })).toBeVisible();
  let posts = 0;
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts += 1;
    const response = await route.fetch();
    expect(response.ok()).toBe(true); // actually committed, but its response does not reach the UI
    await route.abort("failed");
  });
  await page.getByLabel("Name", { exact: true }).fill("Committed with a lost response");
  await page.getByRole("button", { name: "Create playlist", exact: true }).click();
  await expect(
    page.getByText("Creation could not be confirmed. Reload your playlists before trying again.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Committed with a lost response",
  );
  await expect(page.getByRole("button", { name: "Create playlist", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Reload playlists", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Committed with a lost response", exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
  const rows = (await (await page.request.get(endpoint)).json()).playlists as Array<{
    name: string;
  }>;
  expect(rows.filter((row) => row.name === "Committed with a lost response")).toHaveLength(1);
});
