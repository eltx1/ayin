import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
const DB_HELPER = path.resolve(process.cwd(), "tests/e2e/db-helper.mjs");

function db<T>(command: string, payload: Record<string, unknown> = {}): T {
  return JSON.parse(
    execFileSync(process.execPath, [DB_HELPER, command, JSON.stringify(payload)], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
    }),
  ) as T;
}

async function register(page: Page, label: string, email: string) {
  const response = await page.request.post(`${API}/auth/register`, {
    data: { name: label, email, password: "strong-pass-123" },
    headers: { origin: WEB },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    user: {
      account: { id: string };
      channel: { id: string; handle: string; name: string };
      creatorTv: { id: string; name: string };
    };
  };
}

async function publishVideo(page: Page, channelId: string, title: string) {
  const draftResponse = await page.request.post(`${API}/creator/videos/drafts`, {
    data: {
      channelId,
      title,
      sizeBytes: 70 * 1024 * 1024,
      mimeType: "video/mp4",
      durationMs: 90_000,
    },
    headers: { origin: WEB },
  });
  expect(draftResponse.ok()).toBe(true);
  const draft = (await draftResponse.json()) as {
    video: { id: string };
    uploadSession: { partCount: number; sessionToken: string };
  };
  const parts = Array.from({ length: draft.uploadSession.partCount }, (_, index) => ({
    partNumber: index + 1,
    etag: `phase5d-etag-${index + 1}`,
  }));
  const completed = await page.request.post(`${API}/media/uploads/sessions/complete`, {
    data: { sessionToken: draft.uploadSession.sessionToken, parts },
    headers: { origin: WEB },
  });
  expect(completed.ok()).toBe(true);
  expect(
    (
      await page.request.post(`${API}/creator/videos/${draft.video.id}/upload-complete`, {
        data: {},
        headers: { origin: WEB },
      })
    ).ok(),
  ).toBe(true);
  db("mark-media-ready", { videoId: draft.video.id });
  const publish = await page.request.post(`${API}/creator/videos/${draft.video.id}/publish`, {
    data: { rightsConfirmed: true, title },
    headers: { origin: WEB },
  });
  expect(publish.ok()).toBe(true);
  return ((await publish.json()) as { video: { id: string; slug: string } }).video;
}

test.beforeEach(() => {
  db("reset");
});

test("public channel and playlist use real localized destinations and durable handles", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const registration = await register(
    page,
    "Phase5D Creator",
    "phase5d-playlist@e2e.ayin.test",
  );
  const video = await publishVideo(page, registration.user.channel.id, "Phase5D Public Film");

  const created = await page.request.post(
    `${API}/creator/channels/${registration.user.channel.id}/playlists`,
    {
      data: {
        name: "Phase5D Picks",
        description: "A public creator collection.",
        visibility: "PUBLIC",
      },
      headers: { origin: WEB },
    },
  );
  expect(created.ok()).toBe(true);
  const playlist = ((await created.json()) as { playlist: { id: string; slug: string } }).playlist;
  expect(
    (
      await page.request.post(`${API}/creator/playlists/${playlist.id}/items`, {
        data: { videoId: video.id },
        headers: { origin: WEB },
      })
    ).ok(),
  ).toBe(true);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    `/c/${registration.user.channel.handle}/playlists/${playlist.slug}?lang=en`,
  );
  const main = page.locator("main:visible");
  await expect(main.getByRole("heading", { level: 1, name: "Phase5D Picks" })).toBeVisible();
  await expect(main.getByText("1 video", { exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: /Phase5D Public Film/ })).toHaveAttribute(
    "href",
    `/watch/${video.slug}`,
  );
  await expect(page.getByText(/server-side ad insertion|media configuration/i)).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("design-public-playlist-1440-en.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    `/ar/c/${registration.user.channel.handle}/playlists/${playlist.slug}?lang=ar`,
  );
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(main.getByRole("heading", { level: 2, name: "الفيديوهات" })).toBeVisible();
  await expect(main.getByRole("link", { name: /Phase5D Public Film/ })).toHaveAttribute(
    "href",
    `/ar/watch/${video.slug}`,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("design-public-playlist-390-ar.png"),
    fullPage: true,
  });

  const oldHandle = registration.user.channel.handle;
  const updated = await page.request.patch(
    `${API}/creator/channels/${registration.user.channel.id}`,
    {
      data: { handle: "phase5d.creator" },
      headers: { origin: WEB },
    },
  );
  expect(updated.ok()).toBe(true);
  const redirect = await page.request.get(
    `${WEB}/ar/c/${oldHandle}/playlists/${playlist.slug}?lang=ar`,
    { maxRedirects: 0 },
  );
  expect(redirect.status()).toBe(308);
  expect(new URL(redirect.headers().location!, WEB).pathname).toBe(
    `/ar/c/phase5d.creator/playlists/${playlist.slug}`,
  );
});

test("Creator TV localizes off-air recovery without changing playback state", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const registration = await register(page, "Phase5D TV", "phase5d-tv@e2e.ayin.test");
  const handle = registration.user.channel.handle;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/ar/c/${handle}/tv?lang=ar`);
  const main = page.locator("main:visible");
  await expect(main.getByRole("heading", { level: 1, name: registration.user.creatorTv.name })).toBeVisible();
  await expect(
    main.getByRole("heading", { level: 2, name: "تبدأ البرمجة مع أول فيديو مؤهل" }),
  ).toBeVisible();
  await expect(page.getByText(/server-side ad insertion|Media configuration needed|MP4/i)).toHaveCount(0);

  const tvUrl = `${API}/public/channels/${handle}/tv`;
  let refreshReads = 0;
  await page.route(tvUrl, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    refreshReads += 1;
    await route.abort("failed");
  });
  await main.getByRole("button", { name: "تحقق مرة أخرى", exact: true }).click();
  await expect(main.getByRole("status")).toContainText("تعذر تحديث دليل تلفزيون صانع المحتوى");
  expect(refreshReads).toBe(1);

  await page.unroute(tvUrl);
  await main.getByRole("button", { name: "تحقق مرة أخرى", exact: true }).click();
  await expect(main.getByRole("status")).toHaveCount(0);
  await expect(
    main.getByRole("heading", { level: 2, name: "تبدأ البرمجة مع أول فيديو مؤهل" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("design-creator-tv-390-ar.png"),
    fullPage: true,
  });
});
