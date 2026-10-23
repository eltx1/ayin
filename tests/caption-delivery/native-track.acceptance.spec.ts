import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";
import { captionTrackPath } from "../../apps/web/src/lib/caption-delivery";

const mediaOrigin = "http://127.0.0.1:3228";
const key =
  "captions/videos/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/track.vtt";
const arabic = "هذه ترجمة عربية ظاهرة داخل الفيديو.";
const vtt = `WEBVTT\n\n00:01.000 --> 00:04.500\n${arabic}\n`;
let server: Server;
let scratch: string;
const mediaRequests: IncomingHttpHeaders[] = [];
const captionRequests: IncomingHttpHeaders[] = [];

test.beforeAll(async () => {
  scratch = mkdtempSync(path.join(tmpdir(), "ayin-caption-delivery-"));
  const mediaPath = path.join(scratch, "fixture.mp4");
  // Bundled Chromium has VP9 support but may omit H.264; the transport is real MP4.
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=480x270:d=5:r=24",
    "-an",
    "-c:v",
    "libvpx-vp9",
    "-deadline",
    "realtime",
    "-cpu-used",
    "8",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    mediaPath,
  ]);
  const mp4 = readFileSync(mediaPath);
  server = createServer((request, response) => {
    if (request.url === "/fixture.mp4") {
      mediaRequests.push(request.headers);
      // Deliberately no video CORS grant: changing the video's request mode would break it.
      response.writeHead(200, { "content-type": "video/mp4", "content-length": mp4.length });
      response.end(mp4);
    } else if (request.url === `/${key}`) {
      captionRequests.push(request.headers);
      response.writeHead(200, {
        "content-type": "text/vtt",
        "access-control-allow-origin": "http://127.0.0.1:3227",
      });
      response.end(vtt);
    } else response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(3228, "127.0.0.1", resolve);
  });
});

test.afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

test("native cross-origin MP4 keeps playing while owned Arabic captions load through the actual same-origin route", async ({
  page,
}, testInfo) => {
  await page.route("**/__caption-delivery", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="ar"><meta charset="utf-8"><title>Caption transport regression</title>
      <body><video id="before" controls muted src="${mediaOrigin}/fixture.mp4" width="480">
        <track kind="subtitles" srclang="ar" label="العربية" default src="${mediaOrigin}/${key}">
      </video><video id="after" controls muted src="${mediaOrigin}/fixture.mp4" width="480">
        <track kind="subtitles" srclang="ar" label="العربية" default src="${captionTrackPath(key)}">
      </video></body></html>`,
    }),
  );
  await page.goto("/__caption-delivery");
  const before = page.locator("#before");
  const after = page.locator("#after");

  // Reproduce the original failure even when the VTT origin grants CORS.
  await expect
    .poll(() => before.locator("track").evaluate((track: HTMLTrackElement) => track.readyState))
    .toBe(3);
  await expect
    .poll(() => after.locator("track").evaluate((track: HTMLTrackElement) => track.readyState))
    .toBe(2);
  await expect
    .poll(() => after.evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(2);
  expect(await after.getAttribute("crossorigin")).toBeNull();
  expect(await after.evaluate((video: HTMLVideoElement) => video.currentSrc)).toBe(
    `${mediaOrigin}/fixture.mp4`,
  );
  await after.evaluate(async (video: HTMLVideoElement) => {
    video.currentTime = 2;
    await video.play();
  });
  await expect
    .poll(() =>
      after.evaluate((video: HTMLVideoElement) => video.getVideoPlaybackQuality().totalVideoFrames),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      after.evaluate((video: HTMLVideoElement) => {
        const cue = video.textTracks[0]?.activeCues?.[0] as VTTCue | undefined;
        return cue?.text;
      }),
    )
    .toBe(arabic);
  expect(
    await after.locator("track").evaluate((track: HTMLTrackElement) => track.track.cues?.length),
  ).toBe(1);
  await after.evaluate((video: HTMLVideoElement) => video.pause());
  await after.screenshot({ path: testInfo.outputPath("arabic-native-caption.png") });

  expect(mediaRequests.length).toBeGreaterThan(0);
  expect(mediaRequests.every((headers) => headers.origin === undefined)).toBe(true);
  expect(captionRequests).toHaveLength(1);
  expect(captionRequests[0]?.cookie).toBeUndefined();
  expect(captionRequests[0]?.authorization).toBeUndefined();
});
