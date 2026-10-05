import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:3001",
  WEB = "http://127.0.0.1:3000";
test.use({ serviceWorkers: "block" });
test.beforeEach(() => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  if (
    process.env.APP_ENV !== "test" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/ayin_e2e"
  )
    throw Error("Requires isolated test database");
  execFileSync(process.execPath, [path.resolve("tests/e2e/db-helper.mjs"), "reset", "{}"], {
    env: process.env,
  });
});
async function register(page: Page, name: string) {
  const response = await page.request.post(API + "/auth/register", {
    headers: { origin: WEB },
    data: { name, email: `${name}@finance-root.e2e.test`, password: "strong-pass-123" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).user.account.id as string;
}
for (const action of ["review", "save", "statement"] as const) {
  test(`Finance ${action} scope loss conceals root before child cleanup and never writes the switched account`, async ({
    page,
  }) => {
    const a = await register(page, `finance-root-a-${action}`);
    execFileSync(
      process.execPath,
      [
        path.resolve("tests/e2e/creator-finance-fixture.mjs"),
        "seed",
        JSON.stringify({ accountId: a }),
      ],
      { env: process.env },
    );
    await page.goto("/account?lang=en");
    await page.getByRole("tab", { name: "Payment details", exact: true }).click();
    await page.getByLabel("Legal name", { exact: true }).fill("Unsaved account A beneficiary");
    await page
      .getByLabel("New payout destination · optional", { exact: true })
      .fill("root-first-secret-112233");
    await page
      .locator('[aria-labelledby="security-sessions-title"] [name="newPassword"]')
      .fill("other-panel-private-123");
    if (action === "statement")
      await page.getByRole("tab", { name: "Reports", exact: true }).click();
    await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>("[data-private-account-workspace]")!;
      const finance = document.querySelector<HTMLElement>('[data-private-finance-body="creator"]')!;
      const native = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "hidden")!;
      const observations: unknown[] = [];
      (window as unknown as { rootConcealment: unknown[] }).rootConcealment = observations;
      Object.defineProperty(body, "hidden", {
        configurable: true,
        get() {
          return native.get!.call(body);
        },
        set(value: boolean) {
          native.set!.call(body, value);
          if (value && observations.length === 0)
            observations.push({
              rootVisible: body.checkVisibility(),
              financeAlreadyHidden: finance.hidden,
              draftPresent: [...body.querySelectorAll<HTMLTextAreaElement>("textarea")].some(
                (field) => field.value === "root-first-secret-112233",
              ),
              otherPanelPresent:
                body.querySelector<HTMLInputElement>('[name="newPassword"]')?.value ===
                "other-panel-private-123",
            });
        },
      });
    });
    const b = await register(page, `finance-root-b-${action}`);
    let writes = 0;
    page.on("request", (request) => {
      if (
        request.url().startsWith(API) &&
        /^\/(auth|privacy|creator)\//.test(new URL(request.url()).pathname) &&
        request.method() !== "GET"
      )
        writes++;
    });
    await page
      .getByRole("button", {
        name:
          action === "review"
            ? "Review current state"
            : action === "save"
              ? "Save payment details"
              : "Download CSV statement",
        exact: true,
      })
      .click();
    await expect(page.getByRole("region", { name: "Account review", exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as unknown as { rootConcealment: unknown[] }).rootConcealment,
      ),
    ).toEqual([
      {
        rootVisible: false,
        financeAlreadyHidden: false,
        // A review intentionally unmounts the private snapshot; tab switching retains its fields.
        // Root-first ordering is independently proven by financeAlreadyHidden in all paths.
        draftPresent: action !== "review",
        otherPanelPresent: true,
      },
    ]);
    await expect(page.locator("[data-private-account-workspace]")).toBeHidden();
    expect(writes).toBe(0);
    for (const accountId of [a, b]) {
      const result = JSON.parse(
        execFileSync(
          process.execPath,
          [
            path.resolve("tests/e2e/creator-finance-fixture.mjs"),
            "evidence",
            JSON.stringify({ accountId }),
          ],
          { env: process.env, encoding: "utf8" },
        ),
      );
      expect(result).toMatchObject({ profile: null, profileAudits: 0 });
    }
  });
}
