import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
    throw Error("Requires isolated local ayin_e2e");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
async function seed(page: Page, request: APIRequestContext, suffix: string) {
  const email = "session-recovery-" + suffix + "@e2e.ayin.test",
    password = "strong-pass-123";
  const registered = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: { name: "Actual account session recovery", email, password },
  });
  expect(registered.ok()).toBe(true);
  const login = await request.post(API + "/auth/login", {
    headers: { origin: WEB, "x-ayin-auth-transport": "bearer" },
    data: { email, password },
  });
  expect(login.ok()).toBe(true);
  return { email, password, otherToken: (await login.json()).sessionToken as string };
}
const section = (page: Page) => page.locator('[aria-labelledby="security-sessions-title"]');
for (const locale of ["en", "ar"] as const)
  test(
    "Actual session acknowledgment survives failed refresh and manual review without replay " +
      locale,
    async ({ page, request }, info) => {
      const data = await seed(page, request, locale),
        copy = (en: string, ar: string) => (locale === "ar" ? ar : en);
      await page.goto("/account?lang=" + locale);
      const workspace = section(page);
      await expect(
        workspace.getByRole("button", { name: copy("Revoke", "إنهاء"), exact: true }),
      ).toHaveCount(1);
      let writes = 0,
        reads = 0,
        failRead = false;
      await page.route(API + "/auth/sessions", (route) => {
        reads++;
        return failRead
          ? route.fulfill({
              status: 503,
              contentType: "application/json",
              body: '{"error":{"message":"Controlled unavailable list"}}',
            })
          : route.continue();
      });
      await page.route(API + "/auth/sessions/revoke-others", async (route) => {
        writes++;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        failRead = true;
        await route.fulfill({ response });
      });
      await workspace
        .getByRole("button", {
          name: copy("Revoke all other sessions", "إنهاء جميع الجلسات الأخرى"),
          exact: true,
        })
        .evaluate((node: HTMLButtonElement) => {
          node.click();
          node.click();
        });
      await expect(workspace.getByRole("status")).toContainText(copy("1", "1"));
      await expect(workspace.getByRole("alert")).toContainText(
        copy("operation was confirmed", "تم تأكيد العملية"),
      );
      expect(writes).toBe(1);
      expect(reads).toBe(1);
      expect(
        (
          await request.get(API + "/auth/me", {
            headers: { authorization: "Bearer " + data.otherToken },
          })
        ).status(),
      ).toBe(401);
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        await workspace.scrollIntoViewIfNeeded();
        await info.attach(`account-session-recovery-${locale}-${width}`, {
          body: await workspace.screenshot({
            path: info.outputPath(`design-account-session-recovery-${locale}-${width}.png`),
          }),
          contentType: "image/png",
        });
      }
      failRead = false;
      await workspace
        .getByRole("button", {
          name: copy("Read current sessions", "قراءة الجلسات الحالية"),
          exact: true,
        })
        .click();
      await expect(workspace.getByRole("alert")).toHaveCount(0);
      await expect(workspace.getByRole("status")).toBeVisible();
      await expect(
        workspace.getByRole("button", { name: copy("Revoke", "إنهاء"), exact: true }),
      ).toHaveCount(0);
      expect(reads).toBe(2);
      expect(writes).toBe(1);
    },
  );
test("Lost actual committed password change is never replayed or labeled failed", async ({
  page,
  request,
}) => {
  const data = await seed(page, request, "lost-password");
  await page.goto("/account");
  const workspace = section(page),
    form = workspace.locator("form");
  await expect(
    workspace.getByRole("heading", { name: "Current session", exact: true }),
  ).toBeVisible();
  await form.locator('[name="currentPassword"]').fill(data.password);
  await form.locator('[name="newPassword"]').fill("actual-new-password-456");
  await form.locator('[name="confirmation"]').fill("actual-new-password-456");
  let writes = 0,
    reads = 0;
  page.on("request", (r) => {
    if (r.url() === API + "/auth/sessions" && r.method() === "GET") reads++;
  });
  await page.route(API + "/auth/password/change", async (route) => {
    writes++;
    const actual = await route.fetch();
    expect(actual.status()).toBe(200);
    await route.abort();
  });
  await form.getByRole("button", { name: "Update password", exact: true }).click();
  await expect(workspace.getByRole("alert")).toContainText("response was not confirmed");
  await expect(form.getByRole("button", { name: "Update password", exact: true })).toBeDisabled();
  await expect(workspace.getByRole("status")).toHaveCount(0);
  expect(reads).toBe(0);
  expect(writes).toBe(1);
  expect(
    (
      await request.post(API + "/auth/login", {
        headers: { origin: WEB, "x-ayin-auth-transport": "bearer" },
        data: { email: data.email, password: data.password },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post(API + "/auth/login", {
        headers: { origin: WEB, "x-ayin-auth-transport": "bearer" },
        data: { email: data.email, password: "actual-new-password-456" },
      })
    ).status(),
  ).toBe(200);
  await workspace.getByRole("button", { name: "Read current sessions", exact: true }).click();
  await expect(workspace.getByRole("alert")).toHaveCount(0);
  expect(reads).toBe(1);
  expect(writes).toBe(1);
});
test("Malformed acknowledgment after actual session revocation requires manual review", async ({
  page,
  request,
}) => {
  const data = await seed(page, request, "malformed");
  await page.goto("/account");
  const workspace = section(page),
    revoke = workspace.getByRole("button", { name: "Revoke", exact: true });
  await expect(revoke).toHaveCount(1);
  let writes = 0;
  await page.route(API + "/auth/sessions/*", async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    writes++;
    const actual = await route.fetch();
    expect(actual.status()).toBe(200);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"revoked":false,"currentSessionRevoked":false}',
    });
  });
  await revoke.click();
  await expect(workspace.getByRole("alert")).toContainText("response was not confirmed");
  await expect(workspace.getByRole("status")).toHaveCount(0);
  await expect(revoke).toBeDisabled();
  expect(
    (
      await request.get(API + "/auth/me", {
        headers: { authorization: "Bearer " + data.otherToken },
      })
    ).status(),
  ).toBe(401);
  await workspace.getByRole("button", { name: "Read current sessions", exact: true }).click();
  await expect(revoke).toHaveCount(0);
  expect(writes).toBe(1);
});
