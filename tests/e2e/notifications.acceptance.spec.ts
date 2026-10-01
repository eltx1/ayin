import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
const DB_HELPER = path.resolve(process.cwd(), "tests/e2e/db-helper.mjs");

test.use({ serviceWorkers: "block" });

test.beforeEach(() => {
  execFileSync(process.execPath, [DB_HELPER, "reset", "{}"], {
    cwd: process.cwd(),
    env: process.env,
  });
});

test("notifications keep account ownership and uncertain mark-read writes recoverable in EN/AR", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const ownerRegistration = await page.request.post(`${API}/auth/register`, {
    data: {
      name: "Notification owner",
      email: "notifications-owner@e2e.ayin.test",
      password: "strong-pass-123",
    },
    headers: { origin: WEB },
  });
  expect(ownerRegistration.ok()).toBe(true);
  const owner = (await ownerRegistration.json()) as {
    user: { channel: { id: string } };
  };

  const subscriber = await browser.newContext();
  try {
    const registration = await subscriber.request.post(`${API}/auth/register`, {
      data: {
        name: "Notification subscriber",
        email: "notifications-subscriber@e2e.ayin.test",
        password: "strong-pass-123",
      },
      headers: { origin: WEB },
    });
    expect(registration.ok()).toBe(true);
    const subscribe = await subscriber.request.put(
      `${API}/social/channels/${owner.user.channel.id}/subscription`,
      { data: {}, headers: { origin: WEB } },
    );
    expect(subscribe.ok()).toBe(true);

    const ownerNotifications = await page.request.get(`${API}/social/notifications`);
    expect(ownerNotifications.ok()).toBe(true);
    const payload = (await ownerNotifications.json()) as {
      items: Array<{ id: string; readAt: string | null }>;
    };
    expect(payload.items).toHaveLength(1);
    const notificationId = payload.items[0]!.id;

    const forbidden = await subscriber.request.patch(
      `${API}/social/notifications/${notificationId}/read`,
      { headers: { origin: WEB } },
    );
    expect(forbidden.status()).toBe(404);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/notifications?lang=en");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
    await expect(main.getByText("New subscriber", { exact: true })).toBeVisible();
    const markRead = main.getByRole("button", { name: "Mark read", exact: true });
    await expect(markRead).toBeVisible();

    let interceptedWrites = 0;
    await page.route(`${API}/social/notifications/${notificationId}/read`, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      interceptedWrites += 1;
      await route.abort("failed");
    });
    await markRead.click();
    await expect(
      main.getByText(/could not confirm whether this notification was marked read/i),
    ).toBeVisible();
    await expect(markRead).toBeDisabled();
    expect(interceptedWrites).toBe(1);

    await page.unroute(`${API}/social/notifications/${notificationId}/read`);
    await main.getByRole("button", { name: "Refresh notifications", exact: true }).click();
    await expect(main.getByRole("button", { name: "Mark read", exact: true })).toBeVisible();
    await main.getByRole("button", { name: "Mark read", exact: true }).click();
    await expect(main.getByRole("button", { name: "Mark read", exact: true })).toHaveCount(0);

    const stored = await page.request.get(`${API}/social/notifications`);
    const storedPayload = (await stored.json()) as {
      items: Array<{ id: string; readAt: string | null }>;
    };
    expect(storedPayload.items.find((item) => item.id === notificationId)?.readAt).not.toBeNull();

    await page.screenshot({
      path: testInfo.outputPath("design-notifications-1440-en.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ar/notifications?lang=ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(main.getByRole("heading", { level: 1, name: "الإشعارات" })).toBeVisible();
    await expect(main.getByText("New subscriber", { exact: true })).toBeVisible();

    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.getByRole("status")).toContainText("أنت غير متصل بالإنترنت");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    const networkStatus = page.getByRole("status");
    await expect(networkStatus).toContainText("عاد الاتصال بالإنترنت");
    const bannerBox = await networkStatus.boundingBox();
    expect(bannerBox).not.toBeNull();
    expect(bannerBox!.x).toBeGreaterThanOrEqual(0);
    expect(bannerBox!.x + bannerBox!.width).toBeLessThanOrEqual(390);
    expect(bannerBox!.y).toBeGreaterThanOrEqual(0);
    expect(bannerBox!.y + bannerBox!.height).toBeLessThanOrEqual(844);

    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("design-notifications-390-ar.png"),
      fullPage: true,
    });
  } finally {
    await subscriber.close();
  }
});
