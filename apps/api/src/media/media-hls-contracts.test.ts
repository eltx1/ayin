import { describe, expect, it } from "vitest";

import { planAdaptiveRenditions } from "./media-architecture-v2.js";
import { buildHlsMasterManifest, parseHlsMediaPlaylistSegments } from "./media-hls-manifest.js";
import { buildHlsFfmpegArgs } from "./media-hls-transcoder.service.js";
import { parseFfprobeOutput } from "./media-probe.js";

function identities(width: number, height: number) {
  return planAdaptiveRenditions({ width, height }).map((rendition) => rendition.identity);
}

describe("Task 40 HLS contracts", () => {
  it("plans only 360p for a 360p source", () => {
    expect(identities(640, 360)).toEqual(["360p"]);
  });

  it("plans 360p/480p/720p for a 720p source", () => {
    expect(identities(1280, 720)).toEqual(["360p", "480p", "720p"]);
  });

  it("plans the full initial ladder for a 1080p source", () => {
    expect(identities(1920, 1080)).toEqual(["360p", "480p", "720p", "1080p"]);
  });

  it("never upscales and respects allowed renditions and the operational maximum", () => {
    expect(identities(638, 359)).toEqual([]);
    const renditions = planAdaptiveRenditions(
      { width: 1919, height: 1080 },
      {
        allowedIdentities: ["360p", "720p", "1080p"],
        maxOutputHeight: 720,
        videoBitrateKbps: { "720p": 2500 },
        audioBitrateKbps: { "720p": 112 },
      },
    );
    expect(renditions.map((rendition) => rendition.identity)).toEqual(["360p", "720p"]);
    expect(renditions.at(-1)).toMatchObject({
      identity: "720p",
      videoBitrateKbps: 2500,
      audioBitrateKbps: 112,
    });
    for (const rendition of renditions) {
      expect(rendition.width).toBeLessThanOrEqual(1919);
      expect(rendition.height).toBeLessThanOrEqual(1080);
      expect(rendition.width % 2).toBe(0);
    }
  });

  it("builds a deterministic master manifest containing every available variant", () => {
    const renditions = planAdaptiveRenditions({ width: 1280, height: 720 });
    const manifest = buildHlsMasterManifest(renditions, { hasAudio: true });
    expect(manifest).toContain("#EXTM3U");
    expect(manifest).toContain("#EXT-X-INDEPENDENT-SEGMENTS");
    expect(manifest).toContain("360p/index.m3u8");
    expect(manifest).toContain("480p/index.m3u8");
    expect(manifest).toContain("720p/index.m3u8");
    expect(manifest).not.toContain("1080p/index.m3u8");
    expect(manifest).toContain('CODECS="avc1.64002a,mp4a.40.2"');
    expect(manifest.indexOf("360p/index.m3u8")).toBeLessThan(manifest.indexOf("720p/index.m3u8"));
  });

  it("accepts only deterministic VOD segment references during verification", () => {
    const playlist = [
      "#EXTM3U",
      "#EXT-X-TARGETDURATION:6",
      "#EXTINF:6.0,",
      "segment-000001.ts",
      "#EXTINF:2.0,",
      "segment-000002.ts",
      "#EXT-X-ENDLIST",
      "",
    ].join("\n");
    expect(parseHlsMediaPlaylistSegments(playlist)).toEqual([1, 2]);
    expect(() =>
      parseHlsMediaPlaylistSegments(
        playlist.replace("segment-000001.ts", "https://evil.example/segment.ts"),
      ),
    ).toThrow(/non-deterministic/);
    expect(() => parseHlsMediaPlaylistSegments(playlist.replace("#EXT-X-ENDLIST", ""))).toThrow(
      /ENDLIST/,
    );
  });

  it("builds FFmpeg HLS arguments without shell interpolation or arbitrary command strings", () => {
    const rendition = planAdaptiveRenditions({ width: 1280, height: 720 }).at(-1)!;
    const args = buildHlsFfmpegArgs({
      canonicalPath: "/tmp/input with spaces.mp4",
      outputDirectory: "/tmp/hls",
      rendition,
      threads: 2,
      preset: "medium",
      segmentDurationSeconds: 6,
      playlistPath: "/tmp/hls/index.m3u8",
      segmentPattern: "/tmp/hls/segment-%06d.ts",
    });
    expect(args).toContain("/tmp/input with spaces.mp4");
    expect(args).toContain("libx264");
    expect(args).toContain("high");
    expect(args).toContain("yuv420p");
    expect(args).toContain("hls");
    expect(args).toContain("/tmp/hls/segment-%06d.ts");
    expect(args).toContain("2");
    expect(args.join(" ")).not.toContain("sh -c");
    expect(args.join(" ")).not.toContain(";");
    expect(args.join(" ")).not.toContain("&&");
  });

  it("parses duration/codecs/audio and normalizes rotated display dimensions", () => {
    const metadata = parseFfprobeOutput(
      JSON.stringify({
        format: { duration: "12.345" },
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 1920,
            height: 1080,
            side_data_list: [{ rotation: -90 }],
          },
          { codec_type: "audio", codec_name: "aac" },
        ],
      }),
    );
    expect(metadata).toMatchObject({
      durationMs: 12345,
      width: 1080,
      height: 1920,
      encodedWidth: 1920,
      encodedHeight: 1080,
      rotationDegrees: 270,
      videoCodec: "h264",
      audioCodec: "aac",
      hasAudio: true,
    });
  });

  it("rejects invalid probe JSON and exposes unreadable sources without inventing dimensions", () => {
    expect(() => parseFfprobeOutput("not-json")).toThrow(/invalid JSON/);
    expect(parseFfprobeOutput(JSON.stringify({ format: {}, streams: [] }))).toEqual({
      durationMs: null,
      width: null,
      height: null,
      encodedWidth: null,
      encodedHeight: null,
      rotationDegrees: 0,
      videoCodec: null,
      audioCodec: null,
      hasAudio: false,
    });
  });
});
