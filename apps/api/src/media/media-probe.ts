export interface MediaProbeMetadata {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  encodedWidth: number | null;
  encodedHeight: number | null;
  rotationDegrees: 0 | 90 | 180 | 270;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number | string }>;
}

interface FfprobeDocument {
  format?: { duration?: string };
  streams?: FfprobeStream[];
}

export function parseFfprobeOutput(stdout: string): MediaProbeMetadata {
  let parsed: FfprobeDocument;
  try {
    parsed = JSON.parse(stdout) as FfprobeDocument;
  } catch (error) {
    throw new Error("FFprobe returned invalid JSON metadata.", { cause: error });
  }

  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
  const encodedWidth = positiveInteger(video?.width);
  const encodedHeight = positiveInteger(video?.height);
  const rotationDegrees = resolveRotation(video);
  const swapsDisplayAxes = rotationDegrees === 90 || rotationDegrees === 270;
  const durationSeconds = positiveNumber(parsed.format?.duration) ?? positiveNumber(video?.duration);

  return {
    durationMs: durationSeconds === null ? null : Math.round(durationSeconds * 1000),
    width:
      encodedWidth === null || encodedHeight === null
        ? null
        : swapsDisplayAxes
          ? encodedHeight
          : encodedWidth,
    height:
      encodedWidth === null || encodedHeight === null
        ? null
        : swapsDisplayAxes
          ? encodedWidth
          : encodedHeight,
    encodedWidth,
    encodedHeight,
    rotationDegrees,
    videoCodec: normalizeCodec(video?.codec_name),
    audioCodec: normalizeCodec(audio?.codec_name),
    hasAudio: Boolean(audio),
  };
}

function resolveRotation(video: FfprobeStream | undefined): 0 | 90 | 180 | 270 {
  const sideDataRotation = video?.side_data_list
    ?.map((entry) => Number(entry.rotation))
    .find((value) => Number.isFinite(value));
  const tagRotation = Number(video?.tags?.rotate);
  const raw = sideDataRotation ?? (Number.isFinite(tagRotation) ? tagRotation : 0);
  const normalized = ((raw % 360) + 360) % 360;
  const nearestQuarterTurn = Math.round(normalized / 90) * 90;
  if (Math.abs(normalized - nearestQuarterTurn) > 0.01) return 0;
  return (nearestQuarterTurn % 360) as 0 | 90 | 180 | 270;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeCodec(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const codec = value.trim().toLowerCase();
  return codec ? codec.slice(0, 64) : null;
}
