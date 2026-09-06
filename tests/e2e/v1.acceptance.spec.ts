import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";
const DB_HELPER = path.resolve(process.cwd(), "tests/e2e/db-helper.mjs");

type Registered = {
  account: { id: string; displayName: string };
  profile: { id: string };
  channel: { id: string; handle: string };
  creatorTv: { id: string };
};

type VideoRecord = { id: string; slug: string; title: string; status: string };

function db<T>(command: string, payload: Record<string, unknown> = {}): T {
  const output = execFileSync(process.execPath, [DB_HELPER, command, JSON.stringify(payload)], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  return JSON.parse(output) as T;
}

async function apiContext(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: API, extraHTTPHeaders: { origin: WEB } });
}

async function registerApi(label: string) {
  const api = await apiContext();
  const response = await api.post("/auth/register", {
    data: {
      name: label,
      email: `${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}@e2e.ayin.test`,
      password: "strong-pass-123",
    },
  });
  expect(response.ok()).toBeTruthy();
  return { api, user: ((await response.json()) as { user: Registered }).user };
}

async function publishThroughDirectUpload(
  api: APIRequestContext,
  channelId: string,
  title: string,
) {
  const draftResponse = await api.post("/creator/videos/drafts", {
    data: {
      channelId,
      title,
      sizeBytes: 70 * 1024 * 1024,
      mimeType: "video/mp4",
      durationMs: 120_000,
    },
  });
  expect(draftResponse.ok()).toBeTruthy();
  const draft = (await draftResponse.json()) as {
    video: { id: string };
    uploadSession: { partCount: number; sessionToken: string };
  };
  const parts = Array.from({ length: draft.uploadSession.partCount }, (_, index) => ({
    partNumber: index + 1,
    etag: `e2e-etag-${index + 1}`,
  }));
  expect(
    (
      await api.post("/media/uploads/sessions/complete", {
        data: { sessionToken: draft.uploadSession.sessionToken, parts },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (await api.post(`/creator/videos/${draft.video.id}/upload-complete`, { data: {} })).ok(),
  ).toBeTruthy();
  db("mark-media-ready", { videoId: draft.video.id });
  const publish = await api.post(`/creator/videos/${draft.video.id}/publish`, {
    data: { rightsConfirmed: true, title },
  });
  expect(publish.ok()).toBeTruthy();
  const body = (await publish.json()) as { video: VideoRecord };
  expect(body.video.status).toBe("PUBLISHED");
  return body.video;
}

test.beforeAll(() => {
  db("reset");
});

test("V1 critical journeys remain launchable end to end", async ({ page }) => {
  let creator: Awaited<ReturnType<typeof registerApi>> | null = null;
  let viewer: Awaited<ReturnType<typeof registerApi>> | null = null;
  let admin: Awaited<ReturnType<typeof registerApi>> | null = null;

  await test.step("1. register automatically creates profile, channel, Uploads and TV", async () => {
    await page.goto("/register");
    await page.getByLabel("Name").fill("Browser Creator");
    await page.getByLabel("Email").fill("browser-creator@e2e.ayin.test");
    await page.getByLabel("Password").fill("strong-pass-123");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Your AYIN channel and TV are ready.")).toBeVisible();
    expect(db("bootstrap", { email: "browser-creator@e2e.ayin.test" })).toEqual({
      profiles: 1,
      memberships: 1,
      uploads: 1,
      tv: 1,
    });
  });

  await test.step("2. login and logout work through the browser UI", async () => {
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    await page.goto("/login");
    await page.getByLabel("Email").fill("browser-creator@e2e.ayin.test");
    await page.getByLabel("Password").fill("strong-pass-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Signed in as Browser Creator")).toBeVisible();
  });

  await test.step("3-4. direct upload test adapter publishes into channel, Uploads and Creator TV", async () => {
    creator = await registerApi("Upload Creator");
    const video = await publishThroughDirectUpload(
      creator.api,
      creator.user.channel.id,
      "E2E Launch Film",
    );
    expect(
      db("upload-association", {
        channelId: creator.user.channel.id,
        tvId: creator.user.creatorTv.id,
        videoId: video.id,
      }),
    ).toEqual({ playlistItems: 1, tvUsesUploads: true });
    await page.goto(`/c/${creator.user.channel.handle}`);
    await expect(page.getByText("E2E Launch Film")).toBeVisible();
  });

  await test.step("5. watch progress persists and resumes", async () => {
    if (!creator) throw new Error("Creator setup missing.");
    const video = db<VideoRecord>("find-video", {
      channelId: creator.user.channel.id,
      title: "E2E Launch Film",
    });
    expect(
      (
        await creator.api.put(`/watch/progress/${video.id}`, {
          data: { positionMs: 42_000, durationMs: 120_000 },
        })
      ).ok(),
    ).toBeTruthy();
    const resumed = await creator.api.get(`/watch/progress/${video.id}`);
    expect(resumed.ok()).toBeTruthy();
    expect((await resumed.json()).positionMs).toBe(42_000);
    await page.goto(`/watch/${video.slug}`);
    await expect(page.getByRole("heading", { name: "E2E Launch Film" })).toBeVisible();
  });

  await test.step("6. subscribe, like and comment traverse authenticated APIs", async () => {
    if (!creator) throw new Error("Creator setup missing.");
    viewer = await registerApi("Social Viewer");
    const video = db<VideoRecord>("find-video", { channelId: creator.user.channel.id });
    expect(
      (
        await viewer.api.put(`/social/channels/${creator.user.channel.id}/subscription`, {
          data: {},
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await viewer.api.put(`/social/videos/${video.id}/reaction`, { data: { type: "LIKE" } })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await viewer.api.post(`/comments/videos/${video.id}`, {
          data: { body: "Launch looks good." },
        })
      ).ok(),
    ).toBeTruthy();
    expect(db("social-counts", { channelId: creator.user.channel.id, videoId: video.id })).toEqual({
      subscriptions: 1,
      reactions: 1,
      comments: 1,
    });
  });

  await test.step("7. admin finds and edits user, channel and video", async () => {
    if (!creator) throw new Error("Creator setup missing.");
    admin = await registerApi("Launch Admin");
    db("grant-admin", { accountId: admin.user.account.id });
    const users = await admin.api.get("/admin/control/users?query=upload&take=10&page=1");
    expect(users.ok()).toBeTruthy();
    expect(((await users.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);
    expect(
      (
        await admin.api.patch(`/admin/control/users/${creator.user.account.id}`, {
          data: { displayName: "Edited Creator", reason: "E2E admin acceptance" },
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await admin.api.patch(`/admin/control/channels/${creator.user.channel.id}`, {
          data: { name: "Edited Channel", reason: "E2E admin acceptance" },
        })
      ).ok(),
    ).toBeTruthy();
    const video = db<VideoRecord>("find-video", { channelId: creator.user.channel.id });
    expect(
      (
        await admin.api.patch(`/admin/control/videos/${video.id}`, {
          data: { title: "Edited Launch Film", reason: "E2E admin acceptance" },
        })
      ).ok(),
    ).toBeTruthy();
  });

  await test.step("8. admin homepage row change reaches the public UI", async () => {
    if (!admin) throw new Error("Admin setup missing.");
    const snapshotResponse = await admin.api.get("/admin/product-controls");
    expect(snapshotResponse.ok()).toBeTruthy();
    const snapshot = (await snapshotResponse.json()) as { rows: Array<{ id: string }> };
    expect(snapshot.rows.length).toBeGreaterThan(0);
    expect(
      (
        await admin.api.patch(`/admin/product-controls/home-rows/${snapshot.rows[0]!.id}`, {
          data: { title: "E2E Editor Picks", reason: "E2E merchandising acceptance" },
        })
      ).ok(),
    ).toBeTruthy();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "E2E Editor Picks" })).toBeVisible();
  });

  await test.step("9. failed IMA ad startup never blocks the content element", async () => {
    if (!creator) throw new Error("Creator setup missing.");
    const video = db<VideoRecord>("find-video", { channelId: creator.user.channel.id });
    await page.route(`**/ads/video/decision/${video.id}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          enabled: true,
          provider: "GOOGLE_IMA",
          tagUrl: "https://ads.invalid/e2e-vast",
          preRollEnabled: true,
          midRollEnabled: false,
          postRollEnabled: false,
          midRollEverySec: 900,
          frequencyCapPerSession: 1,
          attribution: { videoId: video.id, channelId: creator!.user.channel.id },
        }),
      });
    });
    let imaRequested = false;
    await page.route("https://imasdk.googleapis.com/**", async (route) => {
      imaRequested = true;
      await route.abort();
    });
    await page.goto(`/watch/${video.slug}`);
    await expect.poll(() => imaRequested).toBe(true);
    await expect(page.locator("video")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Start playback" })).toHaveCount(0);
  });

  await test.step("10. external display no-fill/load failure collapses cleanly", async () => {
    await page.route("**/ads/page/decision/home_top**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          enabled: true,
          placementId: "00000000-0000-4000-8000-000000000001",
          key: "home_top",
          sizes: [[300, 250]],
          responsive: [],
          demand: { provider: "GOOGLE_GPT", adUnitPath: "/e2e/no-fill" },
          fallback: null,
        }),
      });
    });
    await page.route("https://securepubads.g.doubleclick.net/**", (route) => route.abort());
    await page.goto("/");
    await page.waitForTimeout(500);
    await expect(page.locator('aside[aria-label="Advertisement"]')).toHaveCount(0);
  });

  await test.step("11. creator revenue contract math smoke path", async () => {
    if (!admin || !creator) throw new Error("Revenue setup missing.");
    const contract = await admin.api.post(
      `/admin/revenue/channels/${creator.user.channel.id}/contracts`,
      {
        data: {
          revenueShareBps: 7000,
          effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
          status: "ACTIVE",
          termsVersion: "e2e-v1",
        },
      },
    );
    expect(contract.ok()).toBeTruthy();
    const imported = await admin.api.post("/admin/revenue/imports", {
      data: {
        source: "E2E",
        entries: [
          {
            idempotencyKey: "e2e-launch-revenue-001",
            channelId: creator.user.channel.id,
            periodStart: new Date(Date.now() - 3_600_000).toISOString(),
            periodEnd: new Date().toISOString(),
            grossAmount: "100.000000",
            currency: "USD",
            state: "FINAL",
          },
        ],
      },
    });
    expect(imported.ok()).toBeTruthy();
    expect(
      db("ledger", {
        channelId: creator.user.channel.id,
        idempotencyKey: "E2E:e2e-launch-revenue-001",
      }),
    ).toEqual({ grossAmount: "100", amount: "70", revenueShareBps: 7000 });
  });

  await test.step("12. suspension and unpublish moderation path is enforceable and audited", async () => {
    if (!admin || !creator) throw new Error("Moderation setup missing.");
    const video = db<VideoRecord>("find-video", { channelId: creator.user.channel.id });
    expect(
      (
        await admin.api.post("/admin/control/videos/bulk", {
          data: { ids: [video.id], action: "UNPUBLISH", reason: "E2E moderation acceptance" },
        })
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await admin.api.patch(`/admin/control/users/${creator.user.account.id}`, {
          data: { status: "SUSPENDED", reason: "E2E moderation acceptance" },
        })
      ).ok(),
    ).toBeTruthy();
    const state = db<{ videoStatus: string; accountStatus: string; auditCount: number }>(
      "moderation",
      {
        videoId: video.id,
        accountId: creator.user.account.id,
        adminAccountId: admin.user.account.id,
      },
    );
    expect(state.videoStatus).toBe("DRAFT");
    expect(state.accountStatus).toBe("SUSPENDED");
    expect(state.auditCount).toBeGreaterThan(0);
  });

  await creator?.api.dispose();
  await viewer?.api.dispose();
  await admin?.api.dispose();
});
