import type { PlannedMediaRendition } from "./media-architecture-v2.js";

export const HLS_PLAYLIST_CONTENT_TYPE = "application/vnd.apple.mpegurl" as const;
export const HLS_SEGMENT_CONTENT_TYPE = "video/mp2t" as const;
export const HLS_VIDEO_CODEC_ATTRIBUTE = "avc1.64002a" as const;
export const HLS_AUDIO_CODEC_ATTRIBUTE = "mp4a.40.2" as const;

export function buildHlsMasterManifest(
  renditions: readonly PlannedMediaRendition[],
  input: { hasAudio: boolean },
): string {
  if (renditions.length === 0) {
    throw new Error("An HLS master manifest requires at least one rendition.");
  }
  const ordered = [...renditions].sort((left, right) => left.height - right.height);
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-INDEPENDENT-SEGMENTS"];

  for (const rendition of ordered) {
    const averageBandwidth =
      (rendition.videoBitrateKbps + (input.hasAudio ? rendition.audioBitrateKbps : 0)) * 1000;
    const peakBandwidth = Math.ceil(
      (rendition.videoBitrateKbps * 1.1 + (input.hasAudio ? rendition.audioBitrateKbps : 0)) * 1000,
    );
    const codecs = input.hasAudio
      ? `${HLS_VIDEO_CODEC_ATTRIBUTE},${HLS_AUDIO_CODEC_ATTRIBUTE}`
      : HLS_VIDEO_CODEC_ATTRIBUTE;
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${peakBandwidth},AVERAGE-BANDWIDTH=${averageBandwidth},RESOLUTION=${rendition.width}x${rendition.height},CODECS="${codecs}"`,
      `${rendition.identity}/index.m3u8`,
    );
  }

  return `${lines.join("\n")}\n`;
}

export function parseHlsMediaPlaylistSegments(playlist: string): readonly number[] {
  if (Buffer.byteLength(playlist, "utf8") > 2 * 1024 * 1024) {
    throw new Error("HLS media playlist exceeds the verification size limit.");
  }
  const lines = playlist
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0] !== "#EXTM3U") throw new Error("HLS media playlist is missing #EXTM3U.");
  if (!lines.includes("#EXT-X-ENDLIST")) {
    throw new Error("HLS VOD media playlist is missing #EXT-X-ENDLIST.");
  }

  const segments: number[] = [];
  const seen = new Set<number>();
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    const match = /^segment-(\d{6})\.ts$/.exec(line);
    if (!match) {
      throw new Error("HLS media playlist contains a non-deterministic segment URI.");
    }
    const sequence = Number(match[1]);
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 999_999) {
      throw new Error("HLS media playlist contains an invalid segment sequence.");
    }
    if (seen.has(sequence)) throw new Error("HLS media playlist contains a duplicate segment.");
    seen.add(sequence);
    segments.push(sequence);
  }
  if (segments.length === 0) throw new Error("HLS media playlist contains no media segments.");
  return segments;
}
