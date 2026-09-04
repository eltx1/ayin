export interface MediaProcessingTimeouts {
  ffprobeMs: number;
  ffmpegMs: number;
}

const DEFAULT_FFPROBE_TIMEOUT_SECONDS = 120;
const DEFAULT_FFMPEG_TIMEOUT_SECONDS = 6 * 60 * 60;

export function resolveMediaProcessingTimeouts(
  env: NodeJS.ProcessEnv = process.env,
): MediaProcessingTimeouts {
  return {
    ffprobeMs:
      parseTimeoutSeconds(
        env.MEDIA_PROCESSING_FFPROBE_TIMEOUT_SECONDS,
        "MEDIA_PROCESSING_FFPROBE_TIMEOUT_SECONDS",
        DEFAULT_FFPROBE_TIMEOUT_SECONDS,
        10,
        600,
      ) * 1000,
    ffmpegMs:
      parseTimeoutSeconds(
        env.MEDIA_PROCESSING_FFMPEG_TIMEOUT_SECONDS,
        "MEDIA_PROCESSING_FFMPEG_TIMEOUT_SECONDS",
        DEFAULT_FFMPEG_TIMEOUT_SECONDS,
        60,
        24 * 60 * 60,
      ) * 1000,
  };
}

function parseTimeoutSeconds(
  raw: string | undefined,
  name: string,
  fallbackSeconds: number,
  minimumSeconds: number,
  maximumSeconds: number,
): number {
  const value = raw?.trim();
  if (!value) return fallbackSeconds;
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `${name} must be an integer number of seconds between ${minimumSeconds} and ${maximumSeconds}.`,
    );
  }
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < minimumSeconds || seconds > maximumSeconds) {
    throw new Error(
      `${name} must be an integer number of seconds between ${minimumSeconds} and ${maximumSeconds}.`,
    );
  }
  return seconds;
}
