import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000",
  password = "strong-pass-123";
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (
    process.env.APP_ENV !== "test" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.pathname !== "/ayin_e2e"
  )
    throw Error("Requires isolated test database");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
async function register(page: Page, label: string) {
  const response = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: { name: label, email: label + "@account-workspace.e2e.test", password },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).user.account.id as string;
}
const sessions = (page: Page) => page.locator('[aria-labelledby="security-sessions-title"]');
const privacy = (page: Page) => page.locator("[data-private-account-privacy]");
for (const locale of ["en", "ar"] as const)
  test(
    "Whole account conceals before native draft reset and explicitly reopens one fresh identity " +
      locale,
    async ({ page }, info) => {
      const ar = locale === "ar",
        copy = (en: string, arabic: string) => (ar ? arabic : en);
      const a = await register(page, "workspace-owner-a-" + locale);
      execFileSync(
        process.execPath,
        [
          path.resolve("tests/e2e/creator-finance-fixture.mjs"),
          "seed",
          JSON.stringify({ accountId: a }),
        ],
        { env: process.env },
      );
      const protectedHeaders: string[] = [];
      page.on("request", (req) => {
        if (
          req.method() === "GET" &&
          [
            "/auth/sessions",
            "/auth/mfa/status",
            "/privacy/deletion",
            "/creator/studio/revenue",
          ].some((path) => req.url() === API + path)
        )
          protectedHeaders.push(req.headers()["x-ayin-expected-account"] ?? "");
      });
      await page.goto("/account?lang=" + locale);
      await expect(
        page
          .getByRole("region", { name: copy("Account identity", "هوية الحساب"), exact: true })
          .getByText("workspace-owner-a-" + locale, { exact: true }),
      ).toBeVisible();
      await expect(
        sessions(page).getByRole("heading", {
          name: copy("Current session", "الجلسة الحالية"),
          exact: true,
        }),
      ).toBeVisible();
      await expect(privacy(page).locator('[name="password"]')).toBeEnabled();
      const mfa = page.getByRole("region", {
        name: copy("Two-step verification", "التحقق بخطوتين"),
        exact: true,
      });
      await expect(
        mfa.getByText(copy("Two-step verification is off", "التحقق بخطوتين غير مفعّل"), {
          exact: true,
        }),
      ).toBeVisible();
      await mfa
        .getByRole("button", {
          name: copy("Set up two-step verification", "إعداد التحقق بخطوتين"),
          exact: true,
        })
        .click();
      await mfa
        .getByLabel(copy("Current password", "كلمة المرور الحالية"), { exact: true })
        .fill(password);
      await mfa
        .getByRole("button", {
          name: copy("Continue to setup", "المتابعة إلى الإعداد"),
          exact: true,
        })
        .click();
      await expect(
        mfa.getByAltText(copy("Two-step verification", "التحقق بخطوتين"), { exact: true }),
      ).toBeVisible();
      await sessions(page).locator('[name="currentPassword"]').fill(password);
      await sessions(page).locator('[name="newPassword"]').fill("old-private-password-456");
      await privacy(page).locator('[name="password"]').fill(password);
      await privacy(page).locator('[name="confirmation"]').fill("DELETE MY AYIN ACCOUNT");
      await page
        .getByRole("tab", { name: copy("Payment details", "بيانات الدفع"), exact: true })
        .click();
      await page
        .getByLabel(copy("New payout destination · optional", "وجهة دفع جديدة · اختيارية"), {
          exact: true,
        })
        .fill("old-private-destination-112233");
      expect(protectedHeaders.length).toBeGreaterThanOrEqual(4);
      expect(protectedHeaders.every((header) => header === a)).toBe(true);
      const b = await register(page, "workspace-owner-b-" + locale);
      await page.locator("[data-private-viewer-identity]").getByRole("button").click();
      await expect(
        page.getByRole("dialog", { name: "workspace-owner-a-" + locale, exact: true }),
      ).toBeVisible();
      let privateReads = 0,
        writes = 0;
      page.on("request", (req) => {
        if (req.url().startsWith(API) && /\/(auth|privacy|creator)\//.test(req.url())) {
          if (req.method() === "GET") privateReads++;
          else writes++;
        }
      });
      const observed = await page.evaluate(() => {
        const body = document.querySelector<HTMLElement>("[data-private-account-workspace]");
        const menu = document.querySelector<HTMLDialogElement>(
          "[data-private-viewer-identity] dialog",
        );
        const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "hidden");
        if (!body || !descriptor?.get || !descriptor.set)
          throw Error("Missing native account root");
        let first: { draftPresent: boolean; qrPresent: boolean; visible: boolean } | undefined;
        Object.defineProperty(body, "hidden", {
          configurable: true,
          get() {
            return descriptor.get?.call(body);
          },
          set(value: boolean) {
            descriptor.set?.call(body, value);
            if (value && first === undefined)
              first = {
                draftPresent: [
                  ...body.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
                    "input, textarea",
                  ),
                ].some((i) => i.value === "old-private-destination-112233"),
                qrPresent: Boolean(body.querySelector("[data-private-account-mfa] img")),
                visible: body.checkVisibility(),
              };
          },
        });
        // Interrupt a real default-motion navigation scroll as private content collapses.
        window.scrollTo({ top: 0, behavior: "smooth" });
        window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
        return {
          first,
          menuOpen: menu?.open,
          menuHidden: menu?.hidden,
          values: [
            ...body.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
              "input:not([type=checkbox]):not([type=radio]), textarea",
            ),
          ].map((i) => i.value),
          qrSrc: body.querySelector("[data-private-account-mfa] img")?.getAttribute("src"),
          secretText: [
            ...body.querySelectorAll<HTMLElement>("[data-private-account-mfa] code"),
          ].map((i) => i.textContent),
        };
      });
      expect(observed.first).toEqual({ draftPresent: true, qrPresent: true, visible: false });
      expect(observed.menuOpen).toBe(false);
      expect(observed.menuHidden).toBe(true);
      expect(observed.values.every((value) => value === "")).toBe(true);
      expect(observed.qrSrc).toBeNull();
      expect(observed.secretText.every((value) => value === "")).toBe(true);
      await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
        window.dispatchEvent(new Event("focus"));
      });
      const recovery = page.getByRole("region", {
        name: copy("Account review", "مراجعة الحساب"),
        exact: true,
      });
      await expect(recovery).toBeVisible();
      // Recovery must position itself before any screenshot helper scrolls it.
      await expect
        .poll(() =>
          recovery.evaluate((node) => {
            const box = node.getBoundingClientRect();
            return (
              box.top >= 80 &&
              box.bottom <= window.innerHeight - 80 &&
              node.contains(document.activeElement)
            );
          }),
        )
        .toBe(true);
      await expect(page.locator("[data-private-account-workspace]")).toBeHidden();
      await expect(page.getByText("workspace-owner-a-" + locale, { exact: true })).toHaveCount(0);
      expect(privateReads).toBe(0);
      expect(writes).toBe(0);
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        const box = await recovery.boundingBox();
        if (!box) throw Error("Missing recovery card");
        const height = Math.max(844, Math.ceil(box.height) + 240);
        await page.setViewportSize({ width, height });
        await recovery.evaluate((node) =>
          node.scrollIntoView({ behavior: "instant", block: "center" }),
        );
        await expect
          .poll(async () => {
            const b = await recovery.boundingBox();
            return Boolean(b && b.y >= 80 && b.y + b.height <= height - 80);
          })
          .toBe(true);
        await recovery.screenshot({
          path: info.outputPath(`design-account-workspace-${locale}-${width}.png`),
        });
        await page.screenshot({
          path: info.outputPath(`design-account-workspace-context-${locale}-${width}.png`),
        });
      }
      await recovery
        .getByRole("button", {
          name: copy("Read current account", "قراءة الحساب الحالي"),
          exact: true,
        })
        .click();
      await expect(
        page
          .getByRole("region", { name: copy("Account identity", "هوية الحساب"), exact: true })
          .getByText("workspace-owner-b-" + locale, { exact: true }),
      ).toBeVisible();
      await expect(
        sessions(page).getByRole("heading", {
          name: copy("Current session", "الجلسة الحالية"),
          exact: true,
        }),
      ).toBeVisible();
      await expect(sessions(page).locator('[name="currentPassword"]')).toHaveValue("");
      await expect(privacy(page).locator('[name="password"]')).toHaveValue("");
      await expect(
        mfa.getByText(copy("Two-step verification is off", "التحقق بخطوتين غير مفعّل"), {
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole("tab", { name: copy("Payment details", "بيانات الدفع"), exact: true })
        .click();
      await expect(
        page.getByLabel(copy("New payout destination · optional", "وجهة دفع جديدة · اختيارية"), {
          exact: true,
        }),
      ).toHaveValue("");
      expect((await (await page.request.get(API + "/auth/me")).json()).account.id).toBe(b);
      expect(writes).toBe(0);
    },
  );

test("Actual account switch during root bootstrap never mounts stale identity or starts child private reads", async ({
  page,
}) => {
  const a = await register(page, "workspace-bootstrap-a");
  let b: string | undefined,
    switched = false,
    privateReads = 0;
  page.on("request", (req) => {
    if (
      ["/auth/sessions", "/auth/mfa/status", "/privacy/deletion", "/creator/studio/revenue"].some(
        (path) => req.url() === API + path,
      )
    )
      privateReads++;
  });
  await page.route(API + "/auth/me", async (route) => {
    const response = await route.fetch();
    if (!switched && route.request().headers()["x-ayin-expected-account"] === a) {
      expect(response.status()).toBe(200);
      expect((await response.json()).account.id).toBe(a);
      switched = true;
      b = await register(page, "workspace-bootstrap-b");
    }
    await route.fulfill({ response });
  });
  await page.goto("/account");
  await expect(page.getByRole("region", { name: "Account review", exact: true })).toBeVisible();
  await expect(page.locator("[data-private-account-workspace]")).toHaveCount(0);
  await expect(page.getByText("workspace-bootstrap-a", { exact: true })).toHaveCount(0);
  expect(privateReads).toBe(0);
  expect(b).toBeDefined();
  await page.unroute(API + "/auth/me");
  await page.getByRole("button", { name: "Read current account", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Account identity", exact: true })
      .getByText("workspace-bootstrap-b", { exact: true }),
  ).toBeVisible();
  await expect(
    sessions(page).getByRole("heading", { name: "Current session", exact: true }),
  ).toBeVisible();
  expect((await (await page.request.get(API + "/auth/me")).json()).account.id).toBe(b);
});

test("Lost actual MFA enrollment response closes every private panel and never retries the write", async ({
  page,
}) => {
  await register(page, "workspace-lost-mfa");
  await page.goto("/account");
  const mfa = page.getByRole("region", { name: "Two-step verification", exact: true });
  await mfa.getByRole("button", { name: "Set up two-step verification", exact: true }).click();
  await mfa.getByLabel("Current password", { exact: true }).fill(password);
  let writes = 0;
  await page.route(API + "/auth/mfa/enrollment/start-authenticated", async (route) => {
    writes++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    expect((await response.json()).accountId).toBeDefined();
    await route.abort();
  });
  await mfa.getByRole("button", { name: "Continue to setup", exact: true }).click();
  await expect(page.getByRole("region", { name: "Account review", exact: true })).toBeVisible();
  await expect(page.locator("[data-private-account-workspace]")).toBeHidden();
  await expect(mfa.getByAltText("Two-step verification", { exact: true })).toHaveCount(0);
  expect(writes).toBe(1);
  await page.getByRole("button", { name: "Read current account", exact: true }).click();
  await expect(mfa.getByText("Two-step verification is off", { exact: true })).toBeVisible();
  expect(writes).toBe(1);
});
