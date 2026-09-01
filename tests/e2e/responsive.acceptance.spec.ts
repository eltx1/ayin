import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
const DB_HELPER = path.resolve(process.cwd(), "tests/e2e/db-helper.mjs");

function db<T>(command: string, payload: Record<string, unknown> = {}): T {
  const output = execFileSync(process.execPath, [DB_HELPER, command, JSON.stringify(payload)], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  return JSON.parse(output) as T;
}

async function expectNoDocumentOverflow(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toBeVisible();

  await page.evaluate(async () => {
    if ("fonts" in document) await document.fonts.ready;
  });
  await page.waitForLoadState("networkidle");

  // Assert the invariant across a short settled window instead of sampling the
  // loading shell once. Client-side dashboards populate after hydration/API
  // calls, so late rows/cards must not be allowed to introduce page overflow.
  for (let sample = 0; sample < 5; sample += 1) {
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(
      dimensions.scrollWidth,
      `${route} should keep horizontal scrolling inside local rails/tables instead of the document`,
    ).toBeLessThanOrEqual(dimensions.clientWidth + 1);

    if (sample < 4) await page.waitForTimeout(150);
  }
}

test.beforeAll(() => {
  db("reset");
});

test("AYIN V2 stays responsive across viewer, account, Studio and Admin surfaces", async ({
  page,
}) => {
  const registration = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Responsive Admin",
      email: "responsive-admin@e2e.ayin.test",
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  expect(registration.ok()).toBeTruthy();
  const identity = (await registration.json()) as {
    user: {
      account: { id: string };
      channel: { handle: string };
    };
  };
  db("grant-admin", { accountId: identity.user.account.id });

  await test.step("phone layout has no page overflow and exposes app-ready mobile navigation", async () => {
    await page.setViewportSize({ width: 390, height: 844 });

    for (const route of [
      "/",
      "/movies",
      "/search",
      `/c/${identity.user.channel.handle}`,
      "/studio",
      "/studio/content",
      "/admin",
      "/admin/users",
    ]) {
      await expectNoDocumentOverflow(page, route);
    }

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();

    await page.goto("/studio", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "Creator Studio" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "AYIN administration" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  await test.step("tablet layout preserves the same document-width invariant", async () => {
    await page.setViewportSize({ width: 768, height: 1024 });
    for (const route of ["/", "/search", "/studio/analytics", "/admin/revenue"]) {
      await expectNoDocumentOverflow(page, route);
    }
  });

  await test.step("desktop keeps the full navigation model without horizontal document overflow", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const route of ["/", "/search", "/studio", "/admin"]) {
      await expectNoDocumentOverflow(page, route);
    }

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeHidden();
  });
});
