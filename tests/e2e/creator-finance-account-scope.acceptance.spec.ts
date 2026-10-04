import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
test.use({ serviceWorkers: "block" });
function db(command: string, accountId: string) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve("tests/e2e/creator-finance-fixture.mjs"),
        command,
        JSON.stringify({ accountId }),
      ],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/ayin_e2e")
    throw Error("Requires isolated local ayin_e2e");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
async function register(page: Page, suffix: string) {
  const response = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: {
      name: "Finance scope acceptance owner",
      email: `finance-scope-${suffix}@e2e.ayin.test`,
      password: "strong-pass-123",
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).user.account.id as string;
}
async function prepare(page: Page, locale: "en" | "ar" = "en") {
  const ar = locale === "ar";
  await page.goto("/studio/monetization?lang=" + locale);
  await expect(
    page.getByRole("tab", { name: ar ? "بيانات الدفع" : "Payment details", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: ar ? "بيانات الدفع" : "Payment details", exact: true })
    .click();
  await expect(
    page.getByLabel(ar ? "الاسم القانوني" : "Legal name", { exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel(ar ? "الاسم القانوني" : "Legal name", { exact: true })
    .fill("Actual scoped saved beneficiary");
  await page
    .getByLabel(ar ? "وجهة دفع جديدة · اختيارية" : "New payout destination · optional", {
      exact: true,
    })
    .fill("Actual captured destination 1133557799");
}
const save = (page: Page) =>
  page.getByRole("button", { name: "Save payment details", exact: true }).click();
test("Actual cookie switch between finance pre-actor and protected PUT changes neither account profile", async ({
  page,
}) => {
  const a = await register(page, "between-a");
  db("seed", a);
  await prepare(page);
  let switched = false,
    b: string | undefined,
    writes = 0;
  await page.route(API + "/auth/me", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (!switched) {
      switched = true;
      expect((await response.json()).account.id).toBe(a);
      b = await register(page, "between-b");
    }
    await route.fulfill({ response });
  });
  await page.route(API + "/creator/studio/revenue/payment-profile", async (route) => {
    writes++;
    expect(route.request().headers()["x-ayin-expected-account"]).toBe(a);
    const response = await route.fetch();
    expect(response.status()).toBe(409);
    expect((await response.json()).error.code).toBe("ACCOUNT_CHANGED");
    await route.fulfill({ response });
  });
  await save(page);
  await expect(page.locator('[data-private-finance-body="creator"]')).toBeHidden();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "account or channel changed",
  );
  expect(writes).toBe(1);
  expect(b).toBeDefined();
  for (const id of [a, b!])
    expect(db("evidence", id)).toMatchObject({ profile: null, profileAudits: 0 });
  await page.unroute(API + "/auth/me");
  await page.getByRole("button", { name: "Review current state", exact: true }).click();
  await expect(page.getByLabel("Legal name", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("New payout destination · optional", { exact: true })).toHaveValue(
    "",
  );
  expect(writes).toBe(1);
});
test("Actual acknowledged profile then cookie switch conceals old facts and clears destination without replay", async ({
  page,
}) => {
  const a = await register(page, "after-a");
  db("seed", a);
  await prepare(page);
  await page.evaluate(() => {
    const body = document.querySelector<HTMLElement>('[data-private-finance-body="creator"]');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "hidden");
    if (!body || !descriptor?.get || !descriptor.set)
      throw Error("Missing native finance private body");
    const state = window as typeof window & {
      __ayinFinanceFirstHide?: { draftPresent: boolean; visible: boolean };
    };
    Object.defineProperty(body, "hidden", {
      configurable: true,
      get() {
        return descriptor.get?.call(body);
      },
      set(value: boolean) {
        descriptor.set?.call(body, value);
        if (value && state.__ayinFinanceFirstHide === undefined)
          state.__ayinFinanceFirstHide = {
            draftPresent: [...body.querySelectorAll<HTMLInputElement>("input")].some(
              (input) => input.value === "Actual captured destination 1133557799",
            ),
            visible: body.checkVisibility(),
          };
      },
    });
  });
  let b: string | undefined,
    writes = 0;
  await page.route(API + "/creator/studio/revenue/payment-profile", async (route) => {
    writes++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect((await response.json()).legalName).toBe("Actual scoped saved beneficiary");
    b = await register(page, "after-b");
    await route.fulfill({ response });
  });
  await save(page);
  await expect(page.locator('[data-private-finance-body="creator"]')).toBeHidden();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "account or channel changed",
  );
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __ayinFinanceFirstHide?: { draftPresent: boolean; visible: boolean };
          }
        ).__ayinFinanceFirstHide,
    ),
  ).toEqual({ draftPresent: true, visible: false });
  expect(writes).toBe(1);
  expect(db("evidence", a)).toMatchObject({
    profile: { legalName: "Actual scoped saved beneficiary" },
    profileAudits: 1,
  });
  expect(db("evidence", b!)).toMatchObject({ profile: null, profileAudits: 0 });
  await page.getByRole("button", { name: "Review current state", exact: true }).click();
  await expect(page.getByLabel("New payout destination · optional", { exact: true })).toHaveValue(
    "",
  );
  expect(writes).toBe(1);
});
for (const locale of ["en", "ar"] as const)
  test(
    "Actual acknowledged profile and unavailable post-actor read stays known with private facts hidden " +
      locale,
    async ({ page }, info) => {
      const ar = locale === "ar",
        copy = (en: string, arabic: string) => (ar ? arabic : en);
      const a = await register(page, "known-read-failure-" + locale);
      db("seed", a);
      await prepare(page, locale);
      let committed = false,
        writes = 0;
      await page.route(API + "/auth/me", async (route) =>
        committed
          ? route.fulfill({
              status: 503,
              contentType: "application/json",
              body: '{"error":{"code":"UNAVAILABLE"}}',
            })
          : route.continue(),
      );
      await page.route(API + "/creator/studio/revenue/payment-profile", async (route) => {
        writes++;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        committed = true;
        await route.fulfill({ response });
      });
      await page
        .getByRole("button", {
          name: copy("Save payment details", "حفظ بيانات الدفع"),
          exact: true,
        })
        .click();
      await expect(page.locator('[data-private-finance-body="creator"]')).toBeHidden();
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        copy("server acknowledged this operation", "أكد الخادم هذه العملية"),
      );
      await expect(
        page.getByText("The response was not confirmed.", { exact: false }),
      ).toBeHidden();
      expect(writes).toBe(1);
      expect(db("evidence", a)).toMatchObject({
        profile: { legalName: "Actual scoped saved beneficiary" },
        profileAudits: 1,
      });
      const workspace = page.locator('[data-private-finance-body="creator"]').locator("..");
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        const box = await workspace.boundingBox();
        if (!box) throw Error("Missing finance recovery workspace");
        const height = Math.max(844, Math.ceil(box.height) + 240);
        await page.setViewportSize({ width, height });
        await workspace.evaluate((node) =>
          node.scrollIntoView({ behavior: "instant", block: "center" }),
        );
        await expect
          .poll(async () => {
            const b = await workspace.boundingBox();
            return Boolean(b && b.y >= 80 && b.y + b.height <= height - 80);
          })
          .toBe(true);
        await workspace.screenshot({
          path: info.outputPath(`design-creator-finance-scope-${locale}-${width}.png`),
        });
      }
      committed = false;
      await page
        .getByRole("button", {
          name: copy("Review current state", "مراجعة الحالة الحالية"),
          exact: true,
        })
        .click();
      await expect(
        page.getByLabel(copy("New payout destination · optional", "وجهة دفع جديدة · اختيارية"), {
          exact: true,
        }),
      ).toHaveValue("");
      await expect(
        page.getByRole("button", {
          name: copy(
            "I reviewed the state; enable the next operation",
            "راجعت الحالة؛ فعّل العملية التالية",
          ),
          exact: true,
        }),
      ).toBeEnabled();
      expect(writes).toBe(1);
    },
  );
