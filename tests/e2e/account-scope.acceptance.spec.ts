import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000",
  password = "strong-pass-123";
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
    throw Error("Requires isolated local ayin_e2e");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
async function register(page: Page, suffix: string) {
  const email = `scope-${suffix}@e2e.ayin.test`;
  const response = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: { name: "Actual scoped account", email, password },
  });
  expect(response.status()).toBe(201);
  return { id: (await response.json()).user.account.id as string, email };
}
const section = (page: Page) => page.locator('[aria-labelledby="security-sessions-title"]');
async function ready(page: Page) {
  await page.goto("/account");
  await expect(
    section(page).getByRole("heading", { name: "Current session", exact: true }),
  ).toBeVisible();
}
async function fill(page: Page) {
  const form = section(page).locator("form");
  await form.locator('[name="currentPassword"]').fill(password);
  await form.locator('[name="newPassword"]').fill("never-written-password-456");
  await form.locator('[name="confirmation"]').fill("never-written-password-456");
}
async function unchanged(request: APIRequestContext, email: string) {
  for (const [candidate, status] of [
    [password, 200],
    ["never-written-password-456", 401],
  ] as const)
    expect(
      (
        await request.post(API + "/auth/login", {
          headers: { origin: WEB, "x-ayin-auth-transport": "bearer" },
          data: { email, password: candidate },
        })
      ).status(),
    ).toBe(status);
}
test("Actual same-password cookie account switch sends no private password command and clears secrets", async ({
  page,
  request,
}) => {
  await register(page, "before-a");
  await ready(page);
  await fill(page);
  const b = await register(page, "before-b");
  let writes = 0;
  page.on("request", (r) => {
    if (r.url() === API + "/auth/password/change" && r.method() === "POST") writes++;
  });
  await section(page).getByRole("button", { name: "Update password", exact: true }).click();
  await expect(section(page).getByRole("alert")).toContainText("account changed");
  await expect(section(page).locator("[data-private-account-sessions]")).toBeHidden();
  expect(await section(page).locator('[name="currentPassword"]').inputValue()).toBe("");
  expect(writes).toBe(0);
  await unchanged(request, b.email);
  await section(page).getByRole("button", { name: "Read current sessions", exact: true }).click();
  await expect(
    section(page).getByRole("heading", { name: "Current session", exact: true }),
  ).toBeVisible();
  expect(writes).toBe(0);
});
test("Actual cookie switch after pre-actor read is rejected by server scope before password mutation", async ({
  page,
  request,
}) => {
  const a = await register(page, "between-a");
  await ready(page);
  await fill(page);
  let switched = false,
    b: { id: string; email: string } | undefined;
  await page.route(API + "/auth/me", async (route) => {
    if (switched) {
      await route.continue();
      return;
    }
    switched = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect((await response.json()).account.id).toBe(a.id);
    b = await register(page, "between-b");
    await route.fulfill({ response });
  });
  const rejected = page.waitForResponse(
    (r) => r.url() === API + "/auth/password/change" && r.request().method() === "POST",
  );
  await section(page).getByRole("button", { name: "Update password", exact: true }).click();
  const response = await rejected;
  expect(response.request().headers()["x-ayin-expected-account"]).toBe(a.id);
  expect(response.status()).toBe(409);
  expect((await response.json()).error.code).toBe("ACCOUNT_CHANGED");
  await expect(section(page).locator("[data-private-account-sessions]")).toBeHidden();
  if (!b) throw Error("Missing actual switched account");
  await unchanged(request, b.email);
  await unchanged(request, a.email);
});
test("Controlled pagehide hides synchronously before resetting secrets and pageshow never auto-reads", async ({
  page,
}) => {
  await register(page, "freeze");
  await ready(page);
  await fill(page);
  let reads = 0,
    writes = 0;
  page.on("request", (r) => {
    if (r.url() === API + "/auth/sessions" && r.method() === "GET") reads++;
    if (r.url() === API + "/auth/password/change") writes++;
  });
  const immediate = await page.evaluate(() => {
    const body = document.querySelector<HTMLElement>("[data-private-account-sessions]");
    if (!body) throw Error("Missing private body");
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "hidden");
    if (!descriptor?.get || !descriptor.set) throw Error("Missing actual native hidden property");
    let firstHide: { draftPresent: boolean; visible: boolean } | undefined;
    Object.defineProperty(body, "hidden", {
      configurable: true,
      get() {
        return descriptor.get?.call(body);
      },
      set(value: boolean) {
        descriptor.set?.call(body, value);
        if (value && firstHide === undefined)
          firstHide = {
            draftPresent:
              body.querySelector<HTMLInputElement>('[name="currentPassword"]')?.value ===
              "strong-pass-123",
            visible: body.checkVisibility(),
          };
      },
    });
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    return {
      firstHide,
      hidden: body.hidden,
      visible: body.checkVisibility(),
      secrets: [...body.querySelectorAll<HTMLInputElement>('input[type="password"]')].map(
        (n) => n.value,
      ),
    };
  });
  expect(immediate).toEqual({
    firstHide: { draftPresent: true, visible: false },
    hidden: true,
    visible: false,
    secrets: ["", "", ""],
  });
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
  );
  await expect(section(page).getByRole("alert")).toContainText("Read the current sessions");
  expect(reads).toBe(0);
  expect(writes).toBe(0);
  await section(page).getByRole("button", { name: "Read current sessions", exact: true }).click();
  await expect(
    section(page).getByRole("heading", { name: "Current session", exact: true }),
  ).toBeVisible();
  expect(reads).toBe(1);
  expect(writes).toBe(0);
});
test("Actual account switch after private read drops the old result before any session facts render", async ({
  page,
}) => {
  await register(page, "postread-a");
  let swapped = false,
    b: { id: string; email: string } | undefined;
  await page.route(API + "/auth/sessions", async (route) => {
    if (swapped) {
      await route.continue();
      return;
    }
    swapped = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    b = await register(page, "postread-b");
    await route.fulfill({ response });
  });
  await page.goto("/account");
  await expect(section(page).getByRole("alert")).toBeVisible();
  await expect(section(page).locator("[data-private-account-sessions]")).toBeHidden();
  await expect(section(page).locator("article")).toHaveCount(0);
  await section(page).getByRole("button", { name: "Read current sessions", exact: true }).click();
  await expect(
    section(page).getByRole("heading", { name: "Current session", exact: true }),
  ).toBeVisible();
  expect((await (await page.request.get(API + "/auth/me")).json()).account.id).toBe(b?.id);
});
