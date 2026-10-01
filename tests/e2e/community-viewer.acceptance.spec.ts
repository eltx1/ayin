import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

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

async function register(request: APIRequestContext, name: string, email: string) {
  const response = await request.post(`${API}/auth/register`, {
    data: { name, email, password: "strong-pass-123" },
    headers: { origin: WEB },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    user: { channel: { id: string; handle: string; name: string } };
  };
}

async function createAndPublish(
  request: APIRequestContext,
  payload: {
    type: "TEXT" | "POLL";
    body: string;
    pollOptions?: string[];
  },
) {
  const created = await request.post(`${API}/creator/community/posts`, {
    data: payload,
    headers: { origin: WEB },
  });
  expect(created.ok()).toBe(true);
  const post = (await created.json()) as { id: string };
  const published = await request.post(`${API}/creator/community/posts/${post.id}/publish`, {
    data: {},
    headers: { origin: WEB },
  });
  expect(published.ok()).toBe(true);
  return post.id;
}

async function noOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
}

test("Community Viewer is localized, authenticated, public-channel safe and mutation-recoverable", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(150_000);

  const ownerContext = await browser.newContext();
  try {
    const owner = await register(
      ownerContext.request,
      "Community Creator",
      "community-owner@e2e.ayin.test",
    );
    const textPostId = await createAndPublish(ownerContext.request, {
      type: "TEXT",
      body: "Behind the scenes from the harbor.",
    });
    await createAndPublish(ownerContext.request, {
      type: "POLL",
      body: "Choose the next stream.",
      pollOptions: ["Sea", "City"],
    });

    await register(page.request, "Community Viewer", "community-viewer@e2e.ayin.test");
    const subscribe = await page.request.put(
      `${API}/social/channels/${owner.user.channel.id}/subscription`,
      { data: {}, headers: { origin: WEB } },
    );
    expect(subscribe.ok()).toBe(true);

    let failFeed = true;
    await page.route(`${API}/community/feed`, async (route) => {
      if (route.request().method() !== "GET" || !failFeed) return route.continue();
      await route.fulfill({
        status: 503,
        headers: {
          "access-control-allow-origin": WEB,
          "access-control-allow-credentials": "true",
        },
        json: { message: "Unavailable" },
      });
    });

    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto("/community?lang=en");
    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", { level: 1, name: "Updates from creators you follow" }),
    ).toBeVisible();
    await expect(
      main.getByRole("heading", { name: "Community could not be loaded" }),
    ).toBeVisible();
    await expect(main.getByText("No community updates yet", { exact: true })).toHaveCount(0);

    failFeed = false;
    await main.getByRole("button", { name: "Reload Community", exact: true }).click();
    await expect(
      main.getByText("Behind the scenes from the harbor.", { exact: true }),
    ).toBeVisible();
    await expect(main.getByText("Choose the next stream.", { exact: true })).toBeVisible();

    const textArticle = main
      .getByRole("article")
      .filter({ hasText: "Behind the scenes from the harbor." });
    const like = textArticle.getByRole("button", { name: /^Like/ });
    await expect(like).toBeVisible();

    let likeWrites = 0;
    let likeCommitted = false;
    await page.route(`${API}/community/posts/${textPostId}/reaction`, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      likeWrites += 1;
      const committed = await page.request.put(route.request().url(), {
        data: {},
        headers: { origin: WEB },
      });
      likeCommitted = committed.ok();
      await route.abort("failed");
    });

    await like.click();
    await expect(textArticle.getByText(/could not confirm this action/i)).toBeVisible();
    await expect(like).toBeDisabled();
    expect(likeWrites).toBe(1);
    expect(likeCommitted).toBe(true);

    await page.unroute(`${API}/community/posts/${textPostId}/reaction`);
    await textArticle.getByRole("button", { name: "Refresh updates", exact: true }).click();
    await expect(main.getByRole("button", { name: /^Like · 1$/ })).toBeVisible();

    const pollArticle = main.getByRole("article").filter({ hasText: "Choose the next stream." });
    const seaVote = pollArticle.getByRole("button", { name: "Vote for Sea, 0 votes", exact: true });
    await seaVote.click();
    await expect(
      pollArticle.getByRole("button", { name: "Vote for Sea, 1 votes", exact: true }),
    ).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("design-community-following-1440-en.png"),
      fullPage: true,
    });

    let reportWrites = 0;
    let reportCommitted = false;
    await page.route(`${API}/community/posts/${textPostId}/reports`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      reportWrites += 1;
      const committed = await page.request.post(route.request().url(), {
        data: { reason: "OTHER", details: "Reported from Community Viewer" },
        headers: { origin: WEB },
      });
      reportCommitted = committed.ok();
      await route.abort("failed");
    });

    await textArticle.getByRole("button", { name: "Report", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Report this community post?" }),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Send report", exact: true }).click();
    await expect(
      textArticle.getByText(/could not confirm whether the report was sent/i),
    ).toBeVisible();
    await expect(textArticle.getByRole("button", { name: "Report", exact: true })).toBeDisabled();
    expect(reportWrites).toBe(1);
    expect(reportCommitted).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/ar/c/${owner.user.channel.handle}/community?lang=ar`);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    // Next.js may keep the departing tree hidden during a client transition.
    // Scope content assertions to the single visible route landmark.
    const arabicMain = page.locator("main:visible");
    await expect(arabicMain).toHaveCount(1);
    await expect(
      arabicMain.getByRole("heading", {
        level: 1,
        name: `مجتمع ${owner.user.channel.name}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      arabicMain.getByText("Behind the scenes from the harbor.", { exact: true }),
    ).toBeVisible();
    await expect(arabicMain.getByText("استطلاع", { exact: true })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("design-community-channel-390-ar.png"),
      fullPage: true,
    });

    const anonymous = await browser.newContext();
    try {
      const anonymousPage = await anonymous.newPage();
      await anonymousPage.goto("/community?lang=en");
      await expect(anonymousPage).toHaveURL(/\/login(?:\?|$)/);
    } finally {
      await anonymous.close();
    }
  } finally {
    await ownerContext.close();
  }
});
