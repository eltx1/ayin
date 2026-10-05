import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
const fixturePath = path.resolve("tests/e2e/public-hero-lifecycle-fixture.mjs");
test.use({ serviceWorkers: "block" });
function fixture<T>(command: string, payload: object = {}): T {
  return JSON.parse(
    execFileSync(process.execPath, [fixturePath, command, JSON.stringify(payload)], {
      env: process.env,
      encoding: "utf8",
    }),
  );
}
interface HeroFixture {
  fixtureId: string;
  videos: { primary: { title: string; slug: string } };
}
interface Identity {
  account: { id: string; displayName: string; email: string };
  channel: { handle: string };
}
async function register(page: Page, label: string): Promise<Identity> {
  const name = `Coordination ${label} ${Date.now()}`;
  const response = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: { name, email: `coord-${label}-${Date.now()}@example.test`, password: "strong-pass-123" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).user;
}
const privateChrome = (page: Page) => page.locator("[data-private-viewer-identity]:visible");
async function expectAccount(page: Page, identity: Identity) {
  await expect(
    page
      .getByRole("region", { name: "Account identity", exact: true })
      .getByText(identity.account.email, { exact: true }),
  ).toBeVisible();
}
async function expectMenu(page: Page, identity: Identity) {
  await privateChrome(page).getByRole("button", { name: "Open menu", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: identity.account.displayName, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "My channel", exact: true })).toHaveAttribute(
    "href",
    `/c/${identity.channel.handle}`,
  );
}
async function frames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function markDocument(page: Page) {
  return page.evaluate(() => {
    const value = crypto.randomUUID();
    (window as typeof window & { coordinationDocument: string }).coordinationDocument = value;
    return value;
  });
}
async function sameDocument(page: Page, expected: string) {
  expect(
    await page.evaluate(
      () => (window as typeof window & { coordinationDocument: string }).coordinationDocument,
    ),
  ).toBe(expected);
}

test("verified Account owner beats delayed generic Home identity after a real cookie switch and soft return", async ({
  page,
}) => {
  const catalog = fixture<HeroFixture>("seed");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received: APIResponse[] = [];
  let holdHome = false;
  try {
    const a = await register(page, "owner-a");
    await page.goto("/account?lang=en");
    await expectAccount(page, a);
    const documentId = await markDocument(page);
    await page.route(`${API}/auth/me`, async (route) => {
      const shouldHold =
        holdHome &&
        new URL(page.url()).pathname === "/" &&
        !route.request().headers()["x-ayin-expected-account"];
      if (!shouldHold) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      expect((await response.json()).account.id).toBe(a.account.id);
      received.push(response);
      await held;
      await route.fulfill({ response }).catch((error: Error) => {
        if (!/aborted|Invalid InterceptionId|already handled|Target.*closed/i.test(error.message))
          throw error;
      });
    });
    holdHome = true;
    await page.locator('[data-tv-focus-id="brand-home"]:visible').click();
    await expect(page).toHaveURL(/\/$/);
    // Home's existing SessionPanel and DiscoveryHome also read identity. Hold
    // all three generic reads so this necessarily includes the provider read.
    await expect.poll(() => received.length).toBeGreaterThanOrEqual(3);
    const b = await register(page, "owner-b");
    holdHome = false;
    await page.goBack();
    await expectAccount(page, b);
    await expectMenu(page, b);
    release();
    await frames(page);
    await expect(
      page.getByRole("dialog", { name: b.account.displayName, exact: true }),
    ).toBeVisible();
    await expect(privateChrome(page).locator(`a[href="/c/${a.channel.handle}"]`)).toHaveCount(0);
    await expectAccount(page, b);
    await sameDocument(page, documentId);
  } finally {
    release();
    fixture("cleanup", { fixtureId: catalog.fixtureId });
  }
});

test("Account owner release clears private shell facts while Home verifies current identity and hero", async ({
  page,
}) => {
  const catalog = fixture<HeroFixture>("seed");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const identities: APIResponse[] = [];
  let controls: APIResponse | undefined;
  try {
    const a = await register(page, "release-a");
    await page.goto("/account?lang=en");
    await expectAccount(page, a);
    const documentId = await markDocument(page);
    const b = await register(page, "release-b");
    fixture("policy", { fixtureId: catalog.fixtureId, video: "primary", state: "private" });
    await page.route(`${API}/auth/me`, async (route) => {
      if (new URL(page.url()).pathname !== "/") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      identities.push(response);
      await held;
      await route.fulfill({ response });
    });
    await page.route(`${API}/product-controls`, async (route) => {
      const response = await route.fetch();
      controls = response;
      await held;
      await route.fulfill({ response });
    });
    await page.locator('[data-tv-focus-id="brand-home"]:visible').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('section[aria-labelledby="ayin-hero-title"]:visible h1')).toHaveText(
      "Stories move differently here.",
    );
    await expect(
      page.locator(`[data-private-viewer-identity] a[href="/c/${a.channel.handle}"]`),
    ).toHaveCount(0);
    await expect(page.locator("[data-private-viewer-identity]")).not.toContainText(
      a.account.displayName,
    );
    await expect.poll(() => identities.length).toBeGreaterThanOrEqual(3);
    for (const response of identities)
      expect((await response.json()).account.id).toBe(b.account.id);
    await expect.poll(() => Boolean(controls)).toBe(true);
    expect((await controls!.json()).resolvedHero).toBeNull();
    release();
    await expectMenu(page, b);
    await expect(page.locator('[data-tv-focus-id="hero-primary"]:visible')).toHaveAttribute(
      "href",
      "#discovery",
    );
    await expect(privateChrome(page).locator(`a[href="/c/${a.channel.handle}"]`)).toHaveCount(0);
    await sameDocument(page, documentId);
  } finally {
    release();
    fixture("cleanup", { fixtureId: catalog.fixtureId });
  }
});
