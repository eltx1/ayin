import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { enrollMfa } from "./mfa-helper";
import { generateTotpCode, totpCounter } from "../../apps/api/src/auth/totp.js";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
function run(file: string, command: string, payload = {}) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve(`tests/e2e/${file}.mjs`), command, JSON.stringify(payload)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
const fixture = (command: string, payload = {}) =>
  run("merchandising-selection-fixture", command, payload);
async function setup(page: Page, language = "en") {
  run("db-helper", "reset");
  fixture("reset");
  const registration = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Merchandising reviewer",
      email: `merch-selector-${language}@e2e.ayin.test`,
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBeTruthy();
  const { user } = await registration.json();
  const { secret, recoveryCodes } = await enrollMfa(page.request);
  run("db-helper", "grant-operator-role", { accountId: user.account.id, role: "OPERATIONS" });
  const seeded = fixture("seed", { channelId: user.channel.id });
  return { ...seeded, accountId: user.account.id, secret, recoveryCode: recoveryCodes[0] };
}
function picks(page: Page, ar = false) {
  return page.getByRole("region", {
    name: `${ar ? "المحتوى المميز" : "Featured items"}: Weekend discoveries · اكتشافات الأسبوع`,
    exact: true,
  });
}
function hero(page: Page, ar = false) {
  return page.getByRole("region", {
    name: ar ? "اختيار المحتوى الرئيسي" : "Hero selector",
    exact: true,
  });
}
test.afterEach(() => fixture("reset"));

test("real directories, exact retained labels, reviewed typed save and unchanged public policy", async ({
  page,
}) => {
  const f = await setup(page);
  const read = (url: string) => page.request.get(API + url);
  const first = await read(
    "/admin/operations/directory/playlists?query=Merch%20collection&page=1&take=25",
  );
  expect(first.status()).toBe(200);
  expect(first.headers()["cache-control"]).toBe("private, no-store");
  const firstPage = await first.json();
  expect(firstPage.pagination).toEqual({ page: 1, take: 25, total: 27, pages: 2 });
  expect(firstPage.items).toHaveLength(25);
  expect(firstPage.items[0].id).toBe(f.playlists[26].id);
  expect(Object.keys(firstPage.items[0]).sort()).toEqual([
    "channel",
    "id",
    "name",
    "slug",
    "visibility",
  ]);
  const secondPage = await (
    await read("/admin/operations/directory/playlists?query=Merch%20collection&page=2&take=25")
  ).json();
  expect(secondPage.items).toHaveLength(2);
  expect(
    new Set([...firstPage.items, ...secondPage.items].map((item: { id: string }) => item.id)).size,
  ).toBe(27);
  for (const query of [
    "take=26",
    "page=0",
    "page=10001",
    "cursor=invalid",
    "query=" + "a".repeat(201),
  ])
    expect((await read("/admin/operations/directory/playlists?" + query)).status()).toBe(400);
  expect(
    (await (await read("/admin/operations/directory/playlists?query=deleted")).json()).items,
  ).toEqual([]);
  const snapshot = await (await read("/admin/product-controls")).json();
  expect(snapshot.selectedTargets).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        entityId: f.videos[26].id,
        label: f.videos[26].title,
        detail: expect.stringContaining("REMOVED"),
      }),
      expect.objectContaining({
        entityId: f.deletedId,
        label: "Merch deleted collection",
        detail: expect.stringContaining("DELETED"),
      }),
      expect.objectContaining({
        entityId: f.playlists[26].id,
        label: f.playlists[26].name,
        detail: expect.stringContaining("PRIVATE"),
      }),
    ]),
  );
  const publicBefore = await (await read("/product-controls")).json();
  expect(publicBefore.hero).toEqual({ entityType: null, entityId: null });
  expect(publicBefore.resolvedHero).toBeNull();
  // Expire only the test session's recent-auth window to exercise the unchanged
  // explicit step-up and review-again path with the actual API.
  const cookie = (await page.context().cookies()).find((value) => value.value.startsWith("v1."))!;
  const payload = JSON.parse(Buffer.from(cookie.value.split(".")[1]!, "base64url").toString());
  payload.reauthAt = Math.floor(Date.now() / 1000) - 600;
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", "task-29-e2e-auth-secret-with-more-than-32-characters")
    .update(encoded)
    .digest("base64url");
  await page.context().addCookies([{ ...cookie, value: `v1.${encoded}.${signature}` }]);
  await page.goto("/admin/product-controls");
  const featured = picks(page),
    main = hero(page);
  await expect(featured.getByText(f.videos[26].title, { exact: true })).toBeVisible();
  await expect(featured.getByText("Merch deleted collection", { exact: true })).toBeVisible();
  await expect(main.getByText(f.playlists[26].name, { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Stable entity UUID")).toHaveCount(0);
  await expect(page.locator("textarea[placeholder*='VIDEO:']")).toHaveCount(0);
  await featured.getByLabel("Content type", { exact: true }).selectOption("PLAYLIST");
  await featured.getByLabel("Find content", { exact: true }).fill("Merch collection");
  await featured.getByRole("button", { name: "Search content", exact: true }).click();
  await expect(featured.getByRole("status")).toContainText("Page 1 of 2 · 27 matches");
  await featured.getByRole("button", { name: "Next", exact: true }).click();
  await expect(featured.getByRole("status")).toContainText("Page 2 of 2 · 27 matches");
  await expect(featured.getByText(f.videos[26].title, { exact: true })).toBeVisible();
  await featured
    .getByRole("button", { name: `Select ${f.playlists[0].name}`, exact: true })
    .click();
  await featured.getByLabel("Content type", { exact: true }).selectOption("CHANNEL");
  await featured.getByLabel("Find content", { exact: true }).fill("Merch creator");
  await featured.getByRole("button", { name: "Search content", exact: true }).click();
  await featured
    .getByRole("button", { name: "Select Merch creator · مبدع المحتوى", exact: true })
    .click();
  await featured.getByLabel("Content type", { exact: true }).selectOption("CREATOR_TV");
  await featured.getByLabel("Find content", { exact: true }).fill("Merch live");
  await featured.getByRole("button", { name: "Search content", exact: true }).click();
  await featured
    .getByRole("button", { name: "Select Merch live stories · قصص مباشرة", exact: true })
    .click();
  await featured
    .getByRole("button", { name: `Move ${f.playlists[0].name} up`, exact: true })
    .click();
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Review exact merchandising selections");
  const save = featured
    .locator("..")
    .getByRole("button", { name: "Save featured items", exact: true });
  await save.click();
  const verification = page.getByRole("dialog", { name: "Confirm your identity", exact: true });
  await expect(verification).toBeVisible();
  expect(fixture("evidence", f).audits).toHaveLength(0);
  await verification.getByLabel("Password", { exact: true }).fill("strong-pass-123");
  await verification
    .getByLabel("Authenticator code")
    .fill(generateTotpCode(f.secret, totpCounter() + 1n));
  await verification.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(verification).not.toBeVisible();
  expect(fixture("evidence", f).audits).toHaveLength(0);
  const request = page.waitForRequest(
    (r) => r.method() === "PUT" && r.url().endsWith(`/home-rows/${f.rowId}/manual-items`),
  );
  await save.click();
  const write = await request;
  expect(write.postDataJSON()).toEqual({
    reason: "Review exact merchandising selections",
    items: [
      { entityType: "VIDEO", entityId: f.videos[26].id },
      { entityType: "PLAYLIST", entityId: f.playlists[0].id },
      { entityType: "PLAYLIST", entityId: f.deletedId },
      { entityType: "CHANNEL", entityId: f.channelId },
      { entityType: "CREATOR_TV", entityId: f.tvId },
    ],
  });
  await expect(
    page.getByRole("status").filter({ hasText: "Manual featured items updated." }),
  ).toBeVisible();
  expect(fixture("evidence", f).audits).toHaveLength(1);
  // A private target may be configured, but public policy remains authoritative.
  await main.getByLabel("Content type", { exact: true }).selectOption("VIDEO");
  await main.getByLabel("Find content", { exact: true }).fill("merch-story-25");
  await main.getByRole("button", { name: "Search content", exact: true }).click();
  await main.getByRole("button", { name: `Select ${f.videos[25].title}`, exact: true }).click();
  await page.getByRole("button", { name: "Save global controls", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Global product controls updated." }),
  ).toBeVisible();
  const evidence = fixture("evidence", f);
  expect(evidence.controls.value.hero).toEqual({ entityType: "VIDEO", entityId: f.videos[25].id });
  expect(evidence.audits).toHaveLength(2);
  const publicAfter = await (await read("/product-controls")).json();
  expect(publicAfter.hero).toEqual({ entityType: null, entityId: null });
  expect(publicAfter.resolvedHero).toBeNull();
});

test("failure, retry, stale search and revoked current authority preserve or conceal exact selections", async ({
  page,
}) => {
  const f = await setup(page);
  fixture("missing", f);
  await page.goto("/admin/product-controls");
  const featured = picks(page);
  await expect(featured.getByText("Unavailable selection", { exact: true })).toBeVisible();
  await expect(featured).not.toContainText("dddddddd-dddd");
  const url = /\/admin\/control\/videos\?/;
  await page.route(url, (route) =>
    route.fulfill({ status: 503, json: { message: "Synthetic outage" } }),
  );
  await featured.getByRole("button", { name: "Search content", exact: true }).click();
  await expect(featured.getByRole("alert")).toContainText("Your selection is unchanged.");
  await expect(featured.getByText(f.videos[26].title, { exact: true })).toBeVisible();
  await page.unroute(url);
  await featured.getByRole("button", { name: "Retry content search", exact: true }).click();
  await expect(
    featured.getByRole("list", { name: "Search results" }).getByRole("listitem"),
  ).toHaveCount(25);
  await featured.getByLabel("Find content", { exact: true }).fill("nonexistent-merch-title");
  await featured.getByRole("button", { name: "Search content", exact: true }).click();
  await expect(
    featured.getByText("No content matches this search. Try another name or content type.", {
      exact: true,
    }),
  ).toBeVisible();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(url, async (route) => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await featured.getByLabel("Find content", { exact: true }).fill("Merch story");
  await featured.getByRole("button", { name: "Search content", exact: true }).click();
  await expect(featured.getByText("Loading matching content…", { exact: true })).toBeVisible();
  await featured.getByLabel("Find content", { exact: true }).fill("Different newer query");
  release();
  await expect(featured.getByRole("list", { name: "Search results" })).toHaveCount(0);
  await page.unroute(url);
  // Actual authority loss while the original response is in flight. Its post-read
  // session check must reject, synchronously conceal and never write the draft.
  let releaseRevoked!: () => void;
  const revoked = new Promise<void>((resolve) => {
    releaseRevoked = resolve;
  });
  let fetched!: () => void;
  const fetchedPromise = new Promise<void>((resolve) => {
    fetched = resolve;
  });
  await page.route(url, async (route) => {
    const response = await route.fetch();
    fetched();
    await revoked;
    await route.fulfill({ response });
  });
  await featured.getByLabel("Find content", { exact: true }).fill("Merch story");
  await featured.getByRole("button", { name: "Search content", exact: true }).click();
  await fetchedPromise;
  fixture("revoke", f);
  releaseRevoked();
  await expect(
    page.getByRole("alert").filter({ hasText: "Product controls could not be loaded." }),
  ).toBeVisible();
  await expect(featured).toHaveCount(0);
  await expect(page.getByText(f.videos[26].title, { exact: true })).toHaveCount(0);
  expect((await page.request.get(`${API}/admin/operations/directory/playlists`)).status()).toBe(
    403,
  );
  expect(fixture("evidence", f).audits).toHaveLength(0);
});

test("same-account new session rejects a delayed selection read and destroys its old draft", async ({
  page,
}) => {
  const f = await setup(page);
  await page.goto("/admin/product-controls");
  const featured = picks(page);
  await expect(featured).toBeVisible();
  const before = await (await page.request.get(API + "/admin/session")).json();
  await page
    .getByLabel("Audit reason", { exact: true })
    .fill("Do not transfer this old session draft");
  let release!: () => void, fetched!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = new Promise<void>((resolve) => {
    fetched = resolve;
  });
  await page.route(/\/admin\/control\/videos\?/, async (route) => {
    const response = await route.fetch();
    fetched();
    await held;
    await route.fulfill({ response });
  });
  await featured.getByRole("button", { name: "Search content", exact: true }).click();
  await read;
  const login = await page.request.post(API + "/auth/login", {
    headers: { origin: WEB },
    data: { email: "merch-selector-en@e2e.ayin.test", password: "strong-pass-123" },
  });
  expect(login.ok()).toBeTruthy();
  const verified = await page.request.post(API + "/auth/mfa/challenge", {
    headers: { origin: WEB },
    data: { challengeToken: (await login.json()).challengeToken, recoveryCode: f.recoveryCode },
  });
  expect(verified.ok()).toBeTruthy();
  const after = await (await page.request.get(API + "/admin/session")).json();
  expect(after.accountId).toBe(before.accountId);
  expect(after.sessionId).not.toBe(before.sessionId);
  release();
  await expect(
    page.getByRole("alert").filter({ hasText: "Product controls could not be loaded." }),
  ).toBeVisible();
  await expect(featured).toHaveCount(0);
  expect(fixture("evidence", f).audits).toHaveLength(0);
  await page.getByRole("button", { name: "Retry product controls", exact: true }).click();
  await expect(picks(page)).toBeVisible();
  await expect(page.getByLabel("Audit reason", { exact: true })).not.toHaveValue(
    "Do not transfer this old session draft",
  );
  await expect(picks(page).getByRole("list", { name: "Search results" })).toHaveCount(0);
});

for (const language of ["en", "ar"])
  for (const width of [390, 1440])
    test(`original ${language} ${width} selection rendering and keyboard`, async ({ page }) => {
      const f = await setup(page, language);
      const ar = language === "ar";
      await page.setViewportSize({ width, height: 1200 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(ar ? "/ar/admin/product-controls" : "/admin/product-controls");
      const main = hero(page, ar),
        featured = picks(page, ar);
      await expect(main.getByText(f.playlists[26].name, { exact: true })).toBeVisible();
      await main
        .getByLabel(ar ? "نوع المحتوى" : "Content type", { exact: true })
        .selectOption("PLAYLIST");
      await main
        .getByLabel(ar ? "البحث عن المحتوى" : "Find content", { exact: true })
        .fill("collection-0");
      await page.keyboard.press("Enter");
      await expect(
        main.getByRole("button", {
          name: `${ar ? "اختيار" : "Select"} ${f.playlists[0].name}`,
          exact: true,
        }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const out = process.env.MERCH_SCREENSHOT_DIR ?? "artifacts/merchandising-selection";
      mkdirSync(out, { recursive: true });
      const bounds: Record<string, unknown> = {};
      for (const [name, target] of [
        ["hero", main],
        ["featured", featured],
      ] as const) {
        const card = target.locator("..");
        await card.evaluate(async (node) => {
          window.scrollTo({ top: window.scrollY, left: window.scrollX, behavior: "instant" });
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          window.scrollTo({
            top: window.scrollY + node.getBoundingClientRect().top - 16,
            behavior: "instant",
          });
        });
        await expect
          .poll(async () => {
            const box = await card.boundingBox();
            return Boolean(box && box.y >= 0 && box.y + box.height <= 1200);
          })
          .toBe(true);
        const rect = await card.boundingBox();
        expect(rect).not.toBeNull();
        expect(rect!.x).toBeGreaterThanOrEqual(0);
        expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
        expect(rect!.y).toBeGreaterThanOrEqual(0);
        expect(rect!.y + rect!.height).toBeLessThanOrEqual(1200);
        bounds[name] = {
          viewport: { width, height: 1200 },
          card: rect,
          controls: await card.locator("input,select,button").evaluateAll((nodes) =>
            nodes.map((node) => {
              const r = node.getBoundingClientRect();
              return {
                label: node.getAttribute("aria-label") ?? node.textContent,
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
              };
            }),
          ),
        };
        await page.screenshot({ path: `${out}/${language}-${width}-${name}.png` });
      }
      writeFileSync(`${out}/${language}-${width}-bounds.json`, JSON.stringify(bounds, null, 2));
      expect(fixture("evidence", f).audits).toHaveLength(0);
    });
