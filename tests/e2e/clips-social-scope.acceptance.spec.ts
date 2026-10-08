import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
interface Identity {
  account: { id: string; displayName: string };
  profile: { id: string };
}
interface Fixture {
  channelId: string;
  firstVideoId: string;
  items: { id: string }[];
}
let seeded: Fixture | undefined;
test.use({
  serviceWorkers: "block",
  contextOptions: { reducedMotion: "reduce" },
  viewport: { width: 1440, height: 900 },
});
function fixture<T>(file: string, command: string, input: object = {}): T {
  if (!process.env.TEST_DATABASE_URL) throw Error("An isolated TEST_DATABASE_URL is required.");
  return JSON.parse(
    execFileSync(
      process.execPath,
      [path.resolve(`tests/e2e/${file}.mjs`), command, JSON.stringify(input)],
      { env: process.env, encoding: "utf8" },
    ),
  );
}
test.beforeEach(() => {
  seeded = fixture<Fixture>("db-helper", "seed-clips-viewer");
});
test.afterEach(() => {
  if (seeded)
    fixture("player-progress-fixture", "hide-clips", {
      videoIds: seeded.items.map((item) => item.id),
    });
  seeded = undefined;
});
async function register(page: Page, label: string): Promise<Identity> {
  const suffix = `clips-social-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await page.request.post(`${API}/auth/register`, {
    headers: { origin: WEB },
    data: { name: suffix, email: `progress-${suffix}@example.test`, password: "strong-pass-123" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).user;
}
function actions(page: Page) {
  const article = page.locator(`[data-clip-item='true'][data-video-id='${seeded!.firstVideoId}']`);
  return {
    // Next streaming can briefly retain an inert server segment with duplicate
    // attributes. Exercise only the action a viewer can actually see and use.
    like: article.locator(`[data-tv-focus-id='clip-${seeded!.firstVideoId}-like']:visible`),
    subscribe: article.locator(
      `[data-tv-focus-id='clip-${seeded!.firstVideoId}-subscribe']:visible`,
    ),
  };
}
async function seedSocial(page: Page, identity: Identity) {
  const options = {
    headers: { origin: WEB, "x-ayin-expected-account": identity.account.id },
    data: { profileId: identity.profile.id },
  };
  expect(
    (
      await page.request.put(`${API}/social/videos/${seeded!.firstVideoId}/reaction`, {
        ...options,
        data: { ...options.data, type: "LIKE" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.put(`${API}/social/channels/${seeded!.channelId}/subscription`, options)
    ).status(),
  ).toBe(200);
}
async function open(page: Page, identity: Identity) {
  await page.route("**/media-test/**", (route) => route.abort());
  await page.goto("/clips?lang=en");
  await expect(page.locator("[data-private-viewer-identity]:visible").first()).toContainText(
    identity.account.displayName,
  );
  await expect(actions(page).like).toBeEnabled();
}
async function settleRender(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function refocus(page: Page, identity: Identity) {
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("[data-private-viewer-identity]:visible").first()).toContainText(
    identity.account.displayName,
  );
}
async function state(page: Page, identity: Identity) {
  const options = { headers: { "x-ayin-expected-account": identity.account.id } };
  const video = await page.request.get(
    `${API}/social/videos/${seeded!.firstVideoId}?profileId=${identity.profile.id}`,
    options,
  );
  const channel = await page.request.get(
    `${API}/social/channels/${seeded!.channelId}?profileId=${identity.profile.id}`,
    options,
  );
  expect(video.status()).toBe(200);
  expect(channel.status()).toBe(200);
  return { video: await video.json(), channel: await channel.json() };
}

test("verified B never retains A's Clips reaction or subscription", async ({ page }, testInfo) => {
  const a = await register(page, "visible-a");
  await seedSocial(page, a);
  await open(page, a);
  await expect(actions(page).like).toHaveAttribute("aria-pressed", "true");
  await expect(actions(page).subscribe).toHaveAttribute("aria-pressed", "true");
  const b = await register(page, "visible-b");
  await refocus(page, b);
  const observed = {
    like: await actions(page).like.getAttribute("aria-pressed"),
    subscribed: await actions(page).subscribe.getAttribute("aria-pressed"),
    b: await state(page, b),
  };
  await testInfo.attach("verified-b-ui-and-real-api", {
    body: JSON.stringify(observed, null, 2),
    contentType: "application/json",
  });
  await expect(actions(page).like).toHaveAttribute("aria-pressed", "false");
  await expect(actions(page).subscribe).toHaveAttribute("aria-pressed", "false");
  await expect(actions(page).like).toBeEnabled();
});

for (const action of ["like", "subscribe"] as const) {
  test(`silent shared-cookie switch cannot apply A's ${action} intent to B`, async ({
    page,
  }, testInfo) => {
    const a = await register(page, `silent-${action}-a`);
    await open(page, a);
    const b = await register(page, `silent-${action}-b`);
    await actions(page)[action].click();
    await expect
      .poll(async () => {
        const current = await state(page, b);
        return action === "like" ? current.video.reaction : current.channel.subscribed;
      })
      .toBe(action === "like" ? null : false);
    // Wait for the whole browser operation, including the response/identity check.
    await expect(actions(page)[action]).not.toHaveAttribute("aria-busy", "true");
    const result = await state(page, b);
    await testInfo.attach("real-b-social-state", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });
    expect(result.video.reaction).toBeNull();
    expect(result.channel.subscribed).toBe(false);
  });
}

function hold() {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { waiting, release };
}

for (const locale of ["en", "ar"] as const) {
  test(`pending ${locale} identity keeps Clips actions inert, then recovers one uncertain write`, async ({
    page,
  }) => {
    await register(page, `pending-${locale}`);
    const held = hold();
    let captured = false;
    let writes = 0;
    await page.route(`${API}/auth/me`, async (route) => {
      if (captured || route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      captured = true;
      await held.waiting;
      await route.fulfill({ response }).catch(() => undefined);
    });
    await page.route(`${API}/social/videos/${seeded!.firstVideoId}/reaction`, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      writes++;
      await route.abort("failed");
    });
    const canonicalClipsPath = `${locale === "ar" ? "/ar" : ""}/clips`;
    const clipsPath = `${canonicalClipsPath}?lang=${locale}`;
    try {
      await page.goto(clipsPath);
      // Locale selection redirects to the canonical path and removes ?lang.
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect.poll(() => captured).toBe(true);
      // No clip identity, title, source or clip-specific action exists until the
      // provider verifies the audience. The old SSR buttons are now a neutral shell.
      await expect(page.locator("[data-clip-item], video")).toHaveCount(0);
      await expect(actions(page).like).toHaveCount(0);
      await expect(actions(page).subscribe).toHaveCount(0);
      await settleRender(page);
      expect(page.url()).toBe(`${WEB}${canonicalClipsPath}`);
      expect(writes).toBe(0);

      held.release();
      await expect(actions(page).like).toBeEnabled();
      await actions(page).like.click();
      await expect(
        page.getByText(
          locale === "ar" ? /تعذر التأكد من تنفيذ التغيير/ : /could not confirm that change/i,
        ),
      ).toBeVisible();
      await expect(actions(page).like).toBeDisabled();
      expect(writes).toBe(1);
      expect(page.url()).toBe(`${WEB}${canonicalClipsPath}`);
    } finally {
      held.release();
    }
  });
}

test("failed initial Clips identity stays unavailable until explicit verification retry", async ({
  page,
}) => {
  await register(page, "initial-identity-failure");
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/social/")) writes++;
  });
  await page.route(`${API}/auth/me`, (route) => route.abort("failed"));
  await page.goto("/clips?lang=en");
  await expect(
    page.getByRole("heading", { name: "Clips could not be loaded", exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-clip-item], video")).toHaveCount(0);
  await expect(actions(page).like).toHaveCount(0);
  await expect(actions(page).subscribe).toHaveCount(0);
  expect(writes).toBe(0);
  expect(page.url()).toBe(`${WEB}/clips`);
  await page.unroute(`${API}/auth/me`);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(actions(page).like).toBeEnabled();
  await expect(actions(page).subscribe).toBeEnabled();
  expect(writes).toBe(0);
});

test("verified anonymous Clips actions still navigate to sign in", async ({ page }) => {
  const held = hold();
  let captured = false;
  let socialRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/social/")) socialRequests++;
  });
  await page.route(`${API}/auth/me`, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(401);
    captured = true;
    await held.waiting;
    await route.fulfill({ response }).catch(() => undefined);
  });
  try {
    await page.goto("/clips?lang=en");
    await expect.poll(() => captured).toBe(true);
    await expect(page.locator("[data-clip-item], video")).toHaveCount(0);
    await expect(actions(page).like).toHaveCount(0);
    await expect(actions(page).subscribe).toHaveCount(0);
    held.release();
    await expect(actions(page).like).toBeEnabled();
    await actions(page).like.click();
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
    expect(socialRequests).toBe(0);
  } finally {
    held.release();
  }
});

for (const action of ["like", "subscribe"] as const) {
  test(`late A ${action} ACK cannot change verified B or replay the command`, async ({
    page,
  }, testInfo) => {
    const a = await register(page, `late-${action}-a`);
    await open(page, a);
    const held = hold();
    let captured = false;
    const commands: { method: string; account: string | undefined; body: unknown }[] = [];
    const url =
      action === "like"
        ? `${API}/social/videos/${seeded!.firstVideoId}/reaction`
        : `${API}/social/channels/${seeded!.channelId}/subscription`;
    await page.route(url, async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      commands.push({
        method: route.request().method(),
        account: route.request().headers()["x-ayin-expected-account"],
        body: route.request().postDataJSON(),
      });
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      captured = true;
      await held.waiting;
      await route.fulfill({ response }).catch(() => undefined);
    });
    try {
      await actions(page)[action].click();
      await expect.poll(() => captured).toBe(true);
      const b = await register(page, `late-${action}-b`);
      await refocus(page, b);
      await expect(actions(page).like).toBeEnabled();
      await expect(actions(page).subscribe).toBeEnabled();
      held.release();
      await settleRender(page);
      await expect(actions(page).like).toHaveAttribute("aria-pressed", "false");
      await expect(actions(page).subscribe).toHaveAttribute("aria-pressed", "false");
      const observed = await state(page, b);
      expect(observed.video.reaction).toBeNull();
      expect(observed.channel.subscribed).toBe(false);
      expect(commands).toEqual([
        {
          method: "PUT",
          account: a.account.id,
          body: { profileId: a.profile.id, ...(action === "like" ? { type: "LIKE" } : {}) },
        },
      ]);
      await testInfo.attach("original-actor-target-and-real-b-state", {
        body: JSON.stringify({ commands, b: observed }, null, 2),
        contentType: "application/json",
      });
      expect(page.url()).toContain("/clips");
    } finally {
      held.release();
    }
  });
}

test("a held A social read is cancelled and cannot replace B's fresh state", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch;
    const aborted: string[] = [];
    Object.assign(window, { abortedClipSocialReads: aborted });
    window.fetch = (...args) => {
      if (String(args[0]).includes("/social/") && (!args[1]?.method || args[1].method === "GET")) {
        args[1]?.signal?.addEventListener("abort", () => aborted.push(String(args[0])), {
          once: true,
        });
      }
      return original(...args);
    };
  });
  const a = await register(page, "read-a");
  await seedSocial(page, a);
  const held = hold();
  let captured = false;
  await page.route(`${API}/social/videos/${seeded!.firstVideoId}?*`, async (route) => {
    if (captured || route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    expect((await response.json()).reaction).toBe("LIKE");
    captured = true;
    await held.waiting;
    await route.fulfill({ response }).catch(() => undefined);
  });
  try {
    await page.goto("/clips?lang=en");
    await expect.poll(() => captured).toBe(true);
    const b = await register(page, "read-b");
    await refocus(page, b);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { abortedClipSocialReads: string[] }).abortedClipSocialReads.length,
      ),
    ).toBeGreaterThan(0);
    await expect(actions(page).like).toBeEnabled();
    held.release();
    await settleRender(page);
    await expect(actions(page).like).toHaveAttribute("aria-pressed", "false");
    await expect(actions(page).subscribe).toHaveAttribute("aria-pressed", "false");
  } finally {
    held.release();
  }
});

test("suspension conceals old social facts synchronously before any focus reread", async ({
  page,
}) => {
  const a = await register(page, "conceal-a");
  await seedSocial(page, a);
  await open(page, a);
  await expect(actions(page).like).toHaveAttribute("aria-pressed", "true");
  const result = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("[data-private-viewer-state]")!;
    window.dispatchEvent(new Event("blur"));
    return {
      oldHidden: root.hidden || getComputedStyle(root).display === "none",
      pressedVisible: [
        ...document.querySelectorAll<HTMLElement>(
          '[data-private-viewer-state] [aria-pressed="true"]',
        ),
      ].some((node) => node.getClientRects().length > 0),
    };
  });
  expect(result.oldHidden || !result.pressedVisible).toBe(true);
  expect(result.pressedVisible).toBe(false);
  await refocus(page, a);
  await expect(actions(page).like).toHaveAttribute("aria-pressed", "true");
});

for (const action of ["like", "subscribe"] as const) {
  test(`contradictory ${action} ACK stays uncertain until an explicit read`, async ({ page }) => {
    const a = await register(page, `bad-${action}`);
    await open(page, a);
    const url =
      action === "like"
        ? `${API}/social/videos/${seeded!.firstVideoId}/reaction`
        : `${API}/social/channels/${seeded!.channelId}/subscription`;
    let writes = 0;
    await page.route(url, async (route) => {
      writes++;
      await route.fulfill({
        status: 200,
        json:
          action === "like"
            ? {
                videoId: seeded!.firstVideoId,
                reaction: null,
                likeCount: 0,
                watchLater: false,
                myList: false,
              }
            : { channelId: seeded!.channelId, subscribed: false, subscriberCount: 0 },
      });
    });
    await actions(page)[action].click();
    await expect(page.getByText(/could not confirm that change/i)).toBeVisible();
    await expect(actions(page)[action]).toBeDisabled();
    expect(writes).toBe(1);
    await page.unroute(url);
    await page.getByRole("button", { name: "Refresh actions", exact: true }).click();
    await expect(actions(page)[action]).toBeEnabled();
    await expect(actions(page)[action]).toHaveAttribute("aria-pressed", "false");
  });
}

test("two synchronous activations send one exact command, and explicit removal is scoped", async ({
  page,
}, testInfo) => {
  const a = await register(page, "duplicate");
  await open(page, a);
  const commands: { method: string; url: string; account: string | undefined; body: unknown }[] =
    [];
  page.on("request", (request) => {
    if (request.url().includes(`/social/videos/${seeded!.firstVideoId}/reaction`))
      commands.push({
        method: request.method(),
        url: request.url(),
        account: request.headers()["x-ayin-expected-account"],
        body: request.postDataJSON(),
      });
  });
  await actions(page).like.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(actions(page).like).toHaveAttribute("aria-pressed", "true");
  expect(commands).toHaveLength(1);
  await actions(page).like.click();
  await expect(actions(page).like).toHaveAttribute("aria-pressed", "false");
  expect(commands).toHaveLength(2);
  expect(commands[0]).toMatchObject({
    method: "PUT",
    account: a.account.id,
    body: { profileId: a.profile.id, type: "LIKE" },
  });
  expect(commands[1]).toMatchObject({ method: "DELETE", account: a.account.id, body: null });
  expect(new URL(commands[1].url).searchParams.get("profileId")).toBe(a.profile.id);
  await testInfo.attach("exact-command-log", {
    body: JSON.stringify(commands, null, 2),
    contentType: "application/json",
  });
});

test("silent active-profile change cannot target the old or newly selected profile", async ({
  page,
}) => {
  const a = await register(page, "profile");
  await open(page, a);
  const second = fixture<{ id: string }>("player-progress-fixture", "default-profile", {
    accountId: a.account.id,
  });
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/social/")) writes++;
  });
  await actions(page).like.click();
  await expect(actions(page).like).toBeEnabled();
  await expect(actions(page).like).toHaveAttribute("aria-pressed", "false");
  expect(writes).toBe(0);
  expect((await state(page, a)).video.reaction).toBeNull();
  expect((await state(page, { ...a, profile: second })).video.reaction).toBeNull();
});

test("account changes at the protected write boundary conceal old state and reverify", async ({
  page,
}) => {
  const a = await register(page, "boundary-a");
  await seedSocial(page, a);
  await open(page, a);
  const held = hold();
  let reached = false;
  let protectedStatus: number | undefined;
  await page.route(`${API}/social/videos/${seeded!.firstVideoId}/reaction?*`, async (route) => {
    reached = true;
    await held.waiting;
    // Fetch now with the browser context's changed cookies, retaining A's
    // expected-account header. This exercises the real AuthGuard rejection.
    const response = await page.request.delete(route.request().url(), {
      headers: { origin: WEB, "x-ayin-expected-account": a.account.id },
    });
    protectedStatus = response.status();
    await route.fulfill({ response });
  });
  try {
    await actions(page).like.click();
    await expect.poll(() => reached).toBe(true);
    const b = await register(page, "boundary-b");
    held.release();
    await expect.poll(() => protectedStatus).toBe(409);
    await expect(page.locator("[data-private-viewer-identity]:visible").first()).toContainText(
      b.account.displayName,
    );
    await expect(actions(page).like).toBeEnabled();
    await expect(actions(page).like).toHaveAttribute("aria-pressed", "false");
    await expect(actions(page).subscribe).toHaveAttribute("aria-pressed", "false");
    expect((await state(page, b)).video.reaction).toBeNull();
  } finally {
    held.release();
  }
});

for (const action of ["like", "subscribe"] as const) {
  test(`a successful ${action} ACK for a different target cannot confirm this clip`, async ({
    page,
  }) => {
    const a = await register(page, `wrong-target-${action}`);
    await open(page, a);
    const url =
      action === "like"
        ? `${API}/social/videos/${seeded!.firstVideoId}/reaction`
        : `${API}/social/channels/${seeded!.channelId}/subscription`;
    await page.route(url, (route) =>
      route.fulfill({
        status: 200,
        json:
          action === "like"
            ? {
                videoId: seeded!.items[1].id,
                reaction: "LIKE",
                likeCount: 1,
                watchLater: false,
                myList: false,
              }
            : { channelId: seeded!.items[1].id, subscribed: true, subscriberCount: 1 },
      }),
    );
    await actions(page)[action].click();
    await expect(page.getByText(/could not confirm that change/i)).toBeVisible();
    await expect(actions(page)[action]).toHaveAttribute("aria-pressed", "false");
    await expect(actions(page)[action]).toBeDisabled();
  });
}

test("a lost committed like ACK is read back explicitly without a duplicate write", async ({
  page,
}) => {
  const a = await register(page, "lost-ack");
  await open(page, a);
  let writes = 0;
  const url = `${API}/social/videos/${seeded!.firstVideoId}/reaction`;
  page.on("request", (request) => {
    if (request.url().split("?")[0] === url && request.method() !== "GET") writes++;
  });
  await page.route(url, async (route) => {
    expect((await route.fetch()).status()).toBe(200);
    await route.abort("failed");
  });
  await actions(page).like.click();
  await expect(page.getByText(/could not confirm that change/i)).toBeVisible();
  expect((await state(page, a)).video.reaction).toBe("LIKE");
  expect(writes).toBe(1);
  await page.unroute(url);
  await page.getByRole("button", { name: "Refresh actions", exact: true }).click();
  await expect(actions(page).like).toBeEnabled();
  await expect(actions(page).like).toHaveAttribute("aria-pressed", "true");
  expect(writes).toBe(1);
});

test("late A command completion after navigation cannot affect another clip", async ({ page }) => {
  const a = await register(page, "target-navigation");
  await open(page, a);
  const held = hold();
  let captured = false;
  await page.route(`${API}/social/videos/${seeded!.firstVideoId}/reaction`, async (route) => {
    const response = await route.fetch();
    captured = true;
    await held.waiting;
    await route.fulfill({ response }).catch(() => undefined);
  });
  try {
    await actions(page).like.click();
    await expect.poll(() => captured).toBe(true);
    const second = page.locator(`[data-clip-item='true'][data-video-id='${seeded!.items[1].id}']`);
    await second.evaluate((element) =>
      element.scrollIntoView({ block: "center", behavior: "instant" }),
    );
    const like = second.locator(`[data-tv-focus-id='clip-${seeded!.items[1].id}-like']`);
    await expect(like).toBeEnabled();
    held.release();
    await settleRender(page);
    await expect(like).toBeEnabled();
    await expect(like).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText(/could not confirm that change/i)).toHaveCount(0);
  } finally {
    held.release();
  }
});
