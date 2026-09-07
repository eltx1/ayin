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

function db<T>(command: string, payload: Record<string, unknown> = {}): T {
  const output = execFileSync(process.execPath, [DB_HELPER, command, JSON.stringify(payload)], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });
  return JSON.parse(output) as T;
}

async function register(label: string) {
  const api = await playwrightRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { origin: WEB },
  });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await api.post("/auth/register", {
    data: {
      name: label,
      email: `task42-${suffix}@e2e.ayin.test`,
      password: "strong-pass-123",
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { user: { channel: { id: string } } };
  return { api, channelId: body.user.channel.id };
}

async function uploadAndPublish(api: APIRequestContext, channelId: string) {
  const title = `Task 42 Adaptive ${Date.now()}`;
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
    etag: `task42-etag-${index + 1}`,
  }));
  const completed = await api.post("/media/uploads/sessions/complete", {
    data: { sessionToken: draft.uploadSession.sessionToken, parts },
  });
  expect(completed.ok()).toBeTruthy();
  expect(
    (await api.post(`/creator/videos/${draft.video.id}/upload-complete`, { data: {} })).ok(),
  ).toBeTruthy();

  // The E2E environment intentionally has no long-lived FFmpeg worker. This helper mirrors
  // the already-tested canonical worker READY state before the adaptive verification step.
  db("mark-media-ready", { videoId: draft.video.id });
  const published = await api.post(`/creator/videos/${draft.video.id}/publish`, {
    data: { rightsConfirmed: true, title },
  });
  expect(published.ok()).toBeTruthy();
  const video = (
    (await published.json()) as { video: { id: string; slug: string; status: string } }
  ).video;
  expect(video.status).toBe("PUBLISHED");
  return video;
}

test("Task 42 new upload becomes HLS-ready and is advertised safely on watch", async ({ page }) => {
  const creator = await register("Task 42 Creator");
  try {
    const video = await uploadAndPublish(creator.api, creator.channelId);

    const before = await creator.api.get(`/public/videos/${video.slug}/playback`);
    expect(before.ok()).toBeTruthy();
    expect(
      ((await before.json()) as { video: { adaptiveSource: unknown } }).video.adaptiveSource,
    ).toBeNull();

    const ready = db<{ enabled: boolean; masterKey: string }>("configure-hls-playback", {
      enabled: true,
      videoId: video.id,
    });
    expect(ready.enabled).toBe(true);

    const playback = await creator.api.get(`/public/videos/${video.slug}/playback`);
    expect(playback.ok()).toBeTruthy();
    const body = (await playback.json()) as {
      video: {
        source: { objectKey: string; mimeType: string };
        adaptiveSource: { objectKey: string; mimeType: string; renditions: unknown[] } | null;
      };
      playerPolicy: { hlsPlaybackEnabled: boolean };
    };
    expect(body.video.source.mimeType).toBe("video/mp4");
    expect(body.playerPolicy.hlsPlaybackEnabled).toBe(true);
    expect(body.video.adaptiveSource?.objectKey).toBe(ready.masterKey);
    expect(body.video.adaptiveSource?.mimeType).toBe("application/vnd.apple.mpegurl");
    expect(body.video.adaptiveSource?.renditions.length).toBeGreaterThan(0);

    await page.goto(`/watch/${video.slug}`);
    await expect(page.getByRole("heading", { name: /Task 42 Adaptive/ })).toBeVisible();
  } finally {
    await creator.api.dispose();
  }
});
