import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { planAdaptiveRenditions } from "../src/media/media-architecture-v2.js";
import { parseHlsMediaPlaylistSegments } from "../src/media/media-hls-manifest.js";
import { MediaHlsTranscoderService } from "../src/media/media-hls-transcoder.service.js";

const execFileAsync = promisify(execFile);
const createdDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }).catch(() => undefined)),
  );
});

describe("Task 40 real FFmpeg HLS packaging", () => {
  it("packages a real 360p canonical MP4 into a verified VOD playlist and segment set", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ayin-task40-ffmpeg-"));
    createdDirectories.push(directory);
    const canonicalPath = join(directory, "canonical.mp4");
    const hlsDirectory = join(directory, "hls", "360p");

    await execFileAsync(
      process.env.FFMPEG_PATH?.trim() || "ffmpeg",
      [
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:rate=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1000:sample_rate=48000",
        "-t",
        "1",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        canonicalPath,
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );

    const rendition = planAdaptiveRenditions({ width: 640, height: 360 })[0]!;
    const result = await new MediaHlsTranscoderService().transcode({
      canonicalPath,
      outputDirectory: hlsDirectory,
      rendition,
      threads: 1,
      preset: "ultrafast",
      segmentDurationSeconds: 2,
    });

    expect(result.playlistSizeBytes).toBeGreaterThan(0);
    expect(result.playlistText).toContain("#EXTM3U");
    expect(result.playlistText).toContain("#EXT-X-ENDLIST");
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.segments.every((segment) => segment.sizeBytes > 0)).toBe(true);
    expect(parseHlsMediaPlaylistSegments(result.playlistText)).toEqual(
      result.segments.map((segment) => segment.sequence),
    );
  });
});
