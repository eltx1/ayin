import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { Injectable } from "@nestjs/common";

import type { PlannedMediaRendition } from "./media-architecture-v2.js";
import { parseHlsMediaPlaylistSegments } from "./media-hls-manifest.js";
import { runBoundedMediaProcess } from "./media-process-runner.js";
import { resolveMediaProcessingTimeouts } from "./media-processing-timeouts.js";

export interface HlsTranscodeResult {
  playlistPath: string;
  playlistText: string;
  playlistSizeBytes: number;
  segments: readonly { sequence: number; filePath: string; sizeBytes: number }[];
}

export interface HlsTranscodeInput {
  canonicalPath: string;
  outputDirectory: string;
  rendition: PlannedMediaRendition;
  threads: number;
  preset: string;
  segmentDurationSeconds: number;
}

@Injectable()
export class MediaHlsTranscoderService {
  private readonly ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  private readonly ffmpegTimeoutMs = resolveMediaProcessingTimeouts().ffmpegMs;

  async transcode(input: HlsTranscodeInput): Promise<HlsTranscodeResult> {
    await rm(input.outputDirectory, { recursive: true, force: true });
    await mkdir(input.outputDirectory, { recursive: true });
    const playlistPath = join(input.outputDirectory, "index.m3u8");
    const segmentPattern = join(input.outputDirectory, "segment-%06d.ts");
    const args = buildHlsFfmpegArgs({ ...input, playlistPath, segmentPattern });

    await runBoundedMediaProcess({
      executable: this.ffmpegPath,
      args,
      timeoutMs: this.ffmpegTimeoutMs,
      label: `FFmpeg HLS ${input.rendition.identity}`,
    });

    const playlistText = await readFile(playlistPath, "utf8");
    const sequences = parseHlsMediaPlaylistSegments(playlistText);
    const playlistMetadata = await stat(playlistPath);
    if (!playlistMetadata.isFile() || playlistMetadata.size <= 0) {
      throw new Error(`HLS ${input.rendition.identity} playlist is empty.`);
    }

    const segments = await Promise.all(
      sequences.map(async (sequence) => {
        const filePath = join(
          input.outputDirectory,
          `segment-${String(sequence).padStart(6, "0")}.ts`,
        );
        const metadata = await stat(filePath);
        if (!metadata.isFile() || metadata.size <= 0) {
          throw new Error(`HLS ${input.rendition.identity} segment ${sequence} is empty.`);
        }
        return { sequence, filePath, sizeBytes: metadata.size };
      }),
    );

    return {
      playlistPath,
      playlistText,
      playlistSizeBytes: playlistMetadata.size,
      segments,
    };
  }
}

export function buildHlsFfmpegArgs(
  input: HlsTranscodeInput & { playlistPath: string; segmentPattern: string },
): readonly string[] {
  const maxRateKbps = Math.ceil(input.rendition.videoBitrateKbps * 1.1);
  const bufferKbps = input.rendition.videoBitrateKbps * 2;
  const keyframeExpression = `expr:gte(t,n_forced*${input.segmentDurationSeconds})`;

  return [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "warning",
    "-y",
    "-i",
    input.canonicalPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-map_metadata",
    "-1",
    "-vf",
    `scale=${input.rendition.width}:${input.rendition.height}:flags=lanczos`,
    "-c:v",
    "libx264",
    "-preset",
    input.preset,
    "-profile:v",
    "high",
    "-level:v",
    "4.2",
    "-b:v",
    `${input.rendition.videoBitrateKbps}k`,
    "-maxrate",
    `${maxRateKbps}k`,
    "-bufsize",
    `${bufferKbps}k`,
    "-pix_fmt",
    "yuv420p",
    "-threads",
    String(input.threads),
    "-force_key_frames",
    keyframeExpression,
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    `${input.rendition.audioBitrateKbps}k`,
    "-ac",
    "2",
    "-max_muxing_queue_size",
    "1024",
    "-f",
    "hls",
    "-hls_time",
    String(input.segmentDurationSeconds),
    "-hls_playlist_type",
    "vod",
    "-hls_flags",
    "independent_segments",
    "-start_number",
    "1",
    "-hls_segment_filename",
    input.segmentPattern,
    input.playlistPath,
  ];
}
