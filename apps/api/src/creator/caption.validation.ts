import { z } from "zod";

export const CAPTION_FILE_MAX_BYTES = 2 * 1024 * 1024;
export const CAPTION_LABEL_MAX_LENGTH = 80;
export const CAPTION_UPLOAD_MIME = "text/vtt";

export const captionLanguageSchema = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .refine((value) => {
    try {
      return Intl.getCanonicalLocales(value).length === 1;
    } catch {
      return false;
    }
  }, "Use a valid BCP 47 language code, such as en or ar-EG.")
  .transform((value) => Intl.getCanonicalLocales(value)[0]!);

export const captionLabelSchema = z.string().trim().min(1).max(CAPTION_LABEL_MAX_LENGTH);

export const captionUploadSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine(
      (value) => value.toLowerCase().endsWith(".vtt"),
      "Caption files must use the .vtt extension.",
    ),
  sizeBytes: z.number().int().min(1).max(CAPTION_FILE_MAX_BYTES),
  mimeType: z
    .string()
    .trim()
    .transform((value) => value.toLowerCase().split(";", 1)[0] ?? value.toLowerCase())
    .refine(
      (value) => value === CAPTION_UPLOAD_MIME,
      "Caption files must use the text/vtt MIME type.",
    ),
  languageCode: captionLanguageSchema,
  label: captionLabelSchema.optional(),
  kind: z.enum(["CAPTIONS", "SUBTITLES"]).default("SUBTITLES"),
  default: z.boolean().default(false),
});

export const captionReplacementSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine(
      (value) => value.toLowerCase().endsWith(".vtt"),
      "Caption files must use the .vtt extension.",
    ),
  sizeBytes: z.number().int().min(1).max(CAPTION_FILE_MAX_BYTES),
  mimeType: z
    .string()
    .trim()
    .transform((value) => value.toLowerCase().split(";", 1)[0] ?? value.toLowerCase())
    .refine(
      (value) => value === CAPTION_UPLOAD_MIME,
      "Caption files must use the text/vtt MIME type.",
    ),
  default: z.boolean().optional(),
});

export const captionPatchSchema = z
  .object({
    languageCode: captionLanguageSchema.optional(),
    label: captionLabelSchema.optional(),
    kind: z.enum(["CAPTIONS", "SUBTITLES"]).optional(),
    enabled: z.boolean().optional(),
    default: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one caption-track change.");

export interface ParsedWebVtt {
  cueCount: number;
  lastCueEndMs: number;
}

export class WebVttValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WebVttValidationError";
  }
}

export function decodeUtf8WebVtt(bytes: Uint8Array): string {
  if (bytes.byteLength === 0 || bytes.byteLength > CAPTION_FILE_MAX_BYTES) {
    throw new WebVttValidationError("CAPTION_FILE_SIZE_INVALID", "Caption file size is invalid.");
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\u0000")) {
      throw new WebVttValidationError(
        "CAPTION_UTF8_INVALID",
        "Caption file contains invalid text bytes.",
      );
    }
    return text.replace(/^\uFEFF/, "");
  } catch (error) {
    if (error instanceof WebVttValidationError) throw error;
    throw new WebVttValidationError("CAPTION_UTF8_INVALID", "Caption file must be valid UTF-8.");
  }
}

export function validateWebVtt(bytes: Uint8Array, durationMs?: number | null): ParsedWebVtt {
  const source = decodeUtf8WebVtt(bytes).replace(/\r\n?/g, "\n");
  const firstLineEnd = source.indexOf("\n");
  const header = (firstLineEnd < 0 ? source : source.slice(0, firstLineEnd)).trimEnd();
  if (!(header === "WEBVTT" || /^WEBVTT[\t ].+$/.test(header)) || header.includes("-->")) {
    throw new WebVttValidationError(
      "CAPTION_WEBVTT_INVALID",
      "Caption file must start with a valid WEBVTT header.",
    );
  }

  const lines = source.split("\n");
  const timingPattern =
    /^(\d{2,}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2,}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})(?:\s+.*)?$/;
  let cueCount = 0;
  let previousStartMs = -1;
  let lastCueEndMs = 0;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (!line.includes("-->")) continue;
    const match = timingPattern.exec(line);
    if (!match) {
      throw new WebVttValidationError(
        "CAPTION_WEBVTT_INVALID",
        `Invalid WebVTT cue timing near line ${index + 1}.`,
      );
    }
    const startMs = webVttTimestampMs(match[1]!);
    const endMs = webVttTimestampMs(match[2]!);
    if (endMs <= startMs) {
      throw new WebVttValidationError(
        "CAPTION_WEBVTT_INVALID",
        "Every WebVTT cue must end after it starts.",
      );
    }
    if (startMs < previousStartMs) {
      throw new WebVttValidationError(
        "CAPTION_WEBVTT_INVALID",
        "WebVTT cue start times must be ordered.",
      );
    }
    if (durationMs && durationMs > 0 && endMs > durationMs + 250) {
      throw new WebVttValidationError(
        "CAPTION_OUTSIDE_VIDEO",
        "WebVTT cues cannot extend beyond the video duration.",
      );
    }
    cueCount += 1;
    previousStartMs = startMs;
    lastCueEndMs = Math.max(lastCueEndMs, endMs);
  }

  if (cueCount === 0) {
    throw new WebVttValidationError(
      "CAPTION_WEBVTT_EMPTY",
      "Caption file must contain at least one WebVTT cue.",
    );
  }
  return { cueCount, lastCueEndMs };
}

function webVttTimestampMs(value: string): number {
  const parts = value.split(":");
  const secondsPart = parts.pop()!;
  const minutes = Number(parts.pop()!);
  const hours = parts.length ? Number(parts.pop()!) : 0;
  const [secondsRaw, millisecondsRaw] = secondsPart.split(".");
  const seconds = Number(secondsRaw);
  const milliseconds = Number(millisecondsRaw);
  if (
    !Number.isInteger(hours) ||
    hours < 0 ||
    !Number.isInteger(minutes) ||
    minutes < 0 ||
    minutes > 59 ||
    !Number.isInteger(seconds) ||
    seconds < 0 ||
    seconds > 59 ||
    !Number.isInteger(milliseconds) ||
    milliseconds < 0 ||
    milliseconds > 999
  ) {
    throw new WebVttValidationError(
      "CAPTION_WEBVTT_INVALID",
      "WebVTT contains an invalid timestamp.",
    );
  }
  return (hours * 60 * 60 + minutes * 60 + seconds) * 1000 + milliseconds;
}
