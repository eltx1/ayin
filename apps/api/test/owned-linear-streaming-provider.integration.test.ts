import { spawn } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  LinearChannelPlan,
  LinearOutputState,
} from "../src/creator/creator-tv-linear.provider.js";
import { OwnedLinearStreamingProvider } from "../src/creator/owned-linear-streaming.provider.js";

describe("owned Creator TV linear provider end to end", () => {
  it("packages a real continuous HLS test channel, reconciles schedule, measures sync and stops", async () => {
    const ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const root = await mkdtemp(join(tmpdir(), "ayin-task75-"));
    const firstSource = join(root, "first.mp4");
    const secondSource = join(root, "second.mp4");
    let provider: OwnedLinearStreamingProvider | null = null;
    let server: Server | null = null;

    try {
      await makeFixture(ffmpegPath, firstSource, 440);
      await makeFixture(ffmpegPath, secondSource, 880);

      server = createServer(async (request, response) => {
        try {
          if (!provider || !request.url) {
            response.statusCode = 503;
            response.end();
            return;
          }
          const url = new URL(request.url, "http://127.0.0.1");
          const match = /^\/public\/linear\/([^/]+)\/([^/]+)$/.exec(url.pathname);
          if (!match) {
            response.statusCode = 404;
            response.end();
            return;
          }
          const output = await provider.readPublicOutput(
            decodeURIComponent(match[1] ?? ""),
            decodeURIComponent(match[2] ?? ""),
          );
          if (!output) {
            response.statusCode = 404;
            response.end();
            return;
          }
          response.statusCode = 200;
          response.setHeader("content-type", output.contentType);
          response.setHeader("cache-control", output.cacheControl);
          if (output.contentLength !== null) {
            response.setHeader("content-length", String(output.contentLength));
          }
          if (Buffer.isBuffer(output.body)) response.end(output.body);
          else output.body.pipe(response);
        } catch {
          response.statusCode = 500;
          response.end();
        }
      });
      await listen(server);
      const address = server.address() as AddressInfo;

      provider = new OwnedLinearStreamingProvider(
        {
          LINEAR_COMPUTE_ENABLED: "1",
          LINEAR_PUBLIC_BASE_URL: "http://127.0.0.1:" + String(address.port) + "/public/linear",
          LINEAR_OUTPUT_ROOT: join(root, "linear"),
          LINEAR_SEGMENT_DURATION_SECONDS: "1",
          LINEAR_MAX_RECOVERY_ATTEMPTS: "1",
          FFMPEG_PATH: ffmpegPath,
        },
        async (objectKey, destinationPath) => {
          const source =
            objectKey === "fixtures/first.mp4"
              ? firstSource
              : objectKey === "fixtures/second.mp4"
                ? secondSource
                : null;
          if (!source) throw new Error("Unknown Task 75 fixture source.");
          await copyFile(source, destinationPath);
        },
      );

      const generatedAtMs = Date.now();
      const firstStartsAtMs = generatedAtMs - 300;
      const firstEndsAtMs = generatedAtMs + 2_500;
      const secondEndsAtMs = firstEndsAtMs + 2_800;
      const plan = task75Plan({
        generatedAtMs,
        firstStartsAtMs,
        firstEndsAtMs,
        secondEndsAtMs,
      });

      const provisioned = await provider.provision(plan);
      expect(provisioned.providerKey).toBe("owned-ffmpeg");
      expect(provisioned.providerResourceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(provisioned.hlsUrl).toBeNull();

      const ready = await waitForState(
        () => provider!.getState(plan.tvChannelId),
        (state) => state.status === "READY" && Boolean(state.hlsUrl),
        8_000,
      );
      expect(ready.hlsUrl).toContain("/public/linear/" + ready.providerResourceId + "/index.m3u8");
      expect(ready.hlsMasterUrl).toContain(
        "/public/linear/" + ready.providerResourceId + "/master.m3u8",
      );
      const masterResponse = await fetch(ready.hlsMasterUrl!);
      expect(masterResponse.ok).toBe(true);
      const masterManifest = await masterResponse.text();
      expect(masterManifest).toContain("#EXT-X-STREAM-INF:");
      expect(masterManifest).toContain('CODECS="avc1.640029,mp4a.40.2"');
      expect(masterManifest).toContain("RESOLUTION=1280x720");
      expect(masterManifest).toContain("index.m3u8");

      const initialManifestResponse = await fetch(ready.hlsUrl!);
      expect(initialManifestResponse.ok).toBe(true);
      const initialManifest = await initialManifestResponse.text();
      expect(initialManifest).toContain("#EXTM3U");
      expect(initialManifest).toContain("#EXT-X-VERSION:3");
      expect(initialManifest).not.toContain("#EXT-X-INDEPENDENT-SEGMENTS");
      expect(initialManifest).toContain("#EXT-X-PROGRAM-DATE-TIME:");
      const firstSegment = segmentName(initialManifest);
      expect(firstSegment).toMatch(/^segment-\d+\.ts$/);

      const segmentResponse = await fetch(new URL(firstSegment, ready.hlsUrl!));
      expect(segmentResponse.ok).toBe(true);
      expect((await segmentResponse.arrayBuffer()).byteLength).toBeGreaterThan(1_000);

      const secondProgram = await waitForState(
        () => provider!.getState(plan.tvChannelId),
        (state) => state.monitoring?.runningOccurrenceKey === "task75:second",
        8_000,
      );
      expect(secondProgram.monitoring?.scheduleDriftMs).not.toBeNull();
      expect(secondProgram.monitoring?.maxScheduleDriftMs).not.toBeNull();
      expect(secondProgram.monitoring!.maxScheduleDriftMs!).toBeLessThan(2_500);

      const transitionedManifest = await waitForManifest(
        ready.hlsUrl!,
        (manifest) =>
          count(manifest, "#EXT-X-DISCONTINUITY") >= 2 &&
          manifest.includes("#EXT-X-CUE-OUT:") &&
          manifest.includes("BREAKID=task76-opportunity-1") &&
          manifest.includes("#EXT-X-CUE-IN"),
        6_000,
      );
      expect(count(transitionedManifest, "BREAKID=task76-opportunity-1")).toBe(1);
      const cue = cueWindow(transitionedManifest, "task76-opportunity-1");
      const plannedCueStartMs = firstEndsAtMs + 500;
      expect(cue.startsAtMs).toBeGreaterThanOrEqual(plannedCueStartMs);
      expect(cue.startsAtMs - plannedCueStartMs).toBeLessThan(1_500);
      expect(cue.endsAtMs).toBeGreaterThanOrEqual(cue.startsAtMs + 1_000);
      expect(cue.endsAtMs - cue.startsAtMs).toBeLessThan(2_500);
      expect(transitionedManifest).not.toContain("SCTE35-OUT");
      expect(transitionedManifest).not.toContain("SCTE35-IN");

      const reconciledPlan: LinearChannelPlan = {
        ...plan,
        generatedAt: new Date().toISOString(),
        windowEndsAt: new Date(secondEndsAtMs + 2_000).toISOString(),
        programs: [
          ...plan.programs,
          {
            occurrenceKey: "task75:third",
            videoId: "video-task75-first",
            title: "Task 75 reconciled program",
            startsAt: new Date(secondEndsAtMs).toISOString(),
            endsAt: new Date(secondEndsAtMs + 2_000).toISOString(),
            playbackOffsetMs: 0,
            source: { objectKey: "fixtures/first.mp4", mimeType: "video/mp4" },
          },
        ],
      };
      const reconciled = await provider.reconcile(reconciledPlan);
      expect(reconciled.providerResourceId).toBe(ready.providerResourceId);
      expect(reconciled.lastPlanGeneratedAt).toBe(reconciledPlan.generatedAt);

      const reconciledReady = await waitForState(
        () => provider!.getState(plan.tvChannelId),
        (state) =>
          state.status === "READY" &&
          state.providerResourceId === ready.providerResourceId &&
          Boolean(state.hlsUrl),
        6_000,
      );
      expect(reconciledReady.hlsUrl).toBe(ready.hlsUrl);
      expect(reconciledReady.hlsMasterUrl).toBe(ready.hlsMasterUrl);

      const providerEnvironment = {
        LINEAR_COMPUTE_ENABLED: "1",
        LINEAR_PUBLIC_BASE_URL: "http://127.0.0.1:" + String(address.port) + "/public/linear",
        LINEAR_OUTPUT_ROOT: join(root, "linear"),
        LINEAR_SEGMENT_DURATION_SECONDS: "1",
        LINEAR_MAX_RECOVERY_ATTEMPTS: "1",
        FFMPEG_PATH: ffmpegPath,
      };
      const materializer = async (objectKey: string, destinationPath: string) => {
        const source =
          objectKey === "fixtures/first.mp4"
            ? firstSource
            : objectKey === "fixtures/second.mp4"
              ? secondSource
              : null;
        if (!source) throw new Error("Unknown Task 75 fixture source.");
        await copyFile(source, destinationPath);
      };

      await provider.onModuleDestroy();
      provider = new OwnedLinearStreamingProvider(providerEnvironment, materializer);
      await provider.onModuleInit();

      const recovered = await waitForState(
        () => provider!.getState(plan.tvChannelId),
        (state) => state.status === "READY" && Boolean(state.hlsUrl),
        6_000,
      );
      expect(recovered.providerResourceId).toBe(ready.providerResourceId);
      expect(recovered.hlsUrl).toBe(ready.hlsUrl);
      expect(recovered.monitoring?.recoveryCount).toBeGreaterThanOrEqual(1);

      const stopped = await provider.stop(plan.tvChannelId);
      expect(stopped).toMatchObject({
        status: "STOPPED",
        providerResourceId: ready.providerResourceId,
        hlsUrl: null,
      });
      const stoppedManifest = await fetch(ready.hlsUrl!);
      expect(stoppedManifest.status).toBe(404);
    } finally {
      if (provider) await provider.onModuleDestroy();
      if (server) await close(server);
      await rm(root, { recursive: true, force: true });
    }
  }, 25_000);
});

function task75Plan(input: {
  generatedAtMs: number;
  firstStartsAtMs: number;
  firstEndsAtMs: number;
  secondEndsAtMs: number;
}): LinearChannelPlan {
  return {
    tvChannelId: "tv-task75-e2e",
    channelId: "channel-task75-e2e",
    channelHandle: "task75-e2e",
    generatedAt: new Date(input.generatedAtMs).toISOString(),
    windowEndsAt: new Date(input.secondEndsAtMs).toISOString(),
    programs: [
      {
        occurrenceKey: "task75:first",
        videoId: "video-task75-first",
        title: "Task 75 first program",
        startsAt: new Date(input.firstStartsAtMs).toISOString(),
        endsAt: new Date(input.firstEndsAtMs).toISOString(),
        playbackOffsetMs: input.generatedAtMs - input.firstStartsAtMs,
        source: { objectKey: "fixtures/first.mp4", mimeType: "video/mp4" },
      },
      {
        occurrenceKey: "task75:second",
        videoId: "video-task75-second",
        title: "Task 75 second program",
        startsAt: new Date(input.firstEndsAtMs).toISOString(),
        endsAt: new Date(input.secondEndsAtMs).toISOString(),
        playbackOffsetMs: 0,
        source: { objectKey: "fixtures/second.mp4", mimeType: "video/mp4" },
      },
    ],
    adMarkers: [
      {
        id: "task76-opportunity-1",
        opportunityId: "task76-opportunity-1",
        occurrenceKey: "task75:second",
        offsetMs: 500,
        durationMs: 1_000,
        source: "PROGRAMMATIC",
        signaling: "SCTE35_INTENT",
      },
    ],
    epg: {
      format: "XMLTV",
      xml: '<?xml version="1.0"?><tv><channel id="tv-task75-e2e"/></tv>',
    },
    adSignaling: { enabled: true, format: "HLS_CUE_OUT_IN", scte35Binary: false },
    fallback: { strategy: "PROGRESSIVE_MP4", enabled: true },
  };
}

async function makeFixture(
  ffmpegPath: string,
  destination: string,
  frequency: number,
): Promise<void> {
  await run(
    ffmpegPath,
    [
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=640x360:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=" + String(frequency) + ":sample_rate=48000",
      "-t",
      "6",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-shortest",
      destination,
    ],
    "Task 75 fixture generation",
  );
}

async function run(executable: string, args: readonly string[], label: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [...args], {
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr = (stderr + String(chunk)).slice(-8_000);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(label + " failed with code " + String(code) + ". " + stderr));
    });
  });
}

async function waitForState(
  read: () => Promise<LinearOutputState>,
  predicate: (state: LinearOutputState) => boolean,
  timeoutMs: number,
): Promise<LinearOutputState> {
  const deadline = Date.now() + timeoutMs;
  let latest = await read();
  while (Date.now() < deadline) {
    if (predicate(latest)) return latest;
    await delay(100);
    latest = await read();
  }
  throw new Error("Timed out waiting for linear state: " + JSON.stringify(latest));
}

async function waitForManifest(
  url: string,
  predicate: (manifest: string) => boolean,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let latest = "";
  while (Date.now() < deadline) {
    const response = await fetch(url);
    if (response.ok) {
      latest = await response.text();
      if (predicate(latest)) return latest;
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for transitioned HLS manifest.\n" + latest);
}

function segmentName(manifest: string): string {
  const line = manifest
    .split("\n")
    .map((value) => value.trim())
    .find((value) => /^segment-\d+\.ts$/.test(value));
  if (!line) throw new Error("No media segment was present in the HLS manifest.");
  return line;
}

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function cueWindow(manifest: string, breakId: string) {
  const lines = manifest.split("\n").map((line) => line.trim());
  const cueOutIndex = lines.findIndex(
    (line) => line.startsWith("#EXT-X-CUE-OUT:") && line.includes("BREAKID=" + breakId),
  );
  if (cueOutIndex < 0) throw new Error("Cue-out was not found for " + breakId);
  const startsAtMs = nextProgramDateMs(lines, cueOutIndex + 1);
  const cueInIndex = lines.findIndex(
    (line, index) => index > cueOutIndex && line === "#EXT-X-CUE-IN",
  );
  if (cueInIndex < 0) throw new Error("Cue-in was not found for " + breakId);
  const endsAtMs = nextProgramDateMs(lines, cueInIndex + 1);
  return { startsAtMs, endsAtMs };
}

function nextProgramDateMs(lines: string[], fromIndex: number): number {
  for (let index = fromIndex; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) continue;
    const value = Date.parse(line.slice("#EXT-X-PROGRAM-DATE-TIME:".length));
    if (Number.isFinite(value)) return value;
  }
  throw new Error("No program-date-time followed the ad cue.");
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
