import { describe, expect, it } from "vitest";

import {
  CAPTION_FILE_MAX_BYTES,
  captionUploadSchema,
  validateWebVtt,
  WebVttValidationError,
} from "./caption.validation.js";

const encode = (value: string) => new TextEncoder().encode(value);

describe("caption WebVTT validation", () => {
  it("accepts ordered UTF-8 WebVTT cues", () => {
    const parsed = validateWebVtt(
      encode("WEBVTT\n\n00:00.000 --> 00:02.000\nHello\n\n00:02.000 --> 00:04.500\nمرحبا\n"),
      10_000,
    );
    expect(parsed.cueCount).toBe(2);
    expect(parsed.lastCueEndMs).toBe(4_500);
  });

  it("rejects invalid UTF-8, missing headers and invalid cue order", () => {
    expect(() => validateWebVtt(new Uint8Array([0xff, 0xfe, 0xfd]))).toThrow(WebVttValidationError);
    expect(() => validateWebVtt(encode("00:00.000 --> 00:01.000\nNo header"))).toThrow(
      /WEBVTT header/,
    );
    expect(() =>
      validateWebVtt(
        encode(
          "WEBVTT\n\n00:05.000 --> 00:06.000\nLater\n\n00:02.000 --> 00:03.000\nEarlier\n",
        ),
      ),
    ).toThrow(/ordered/);
  });

  it("rejects zero-length cues and cues beyond video duration", () => {
    expect(() =>
      validateWebVtt(encode("WEBVTT\n\n00:01.000 --> 00:01.000\nBad\n")),
    ).toThrow(/end after it starts/);
    expect(() =>
      validateWebVtt(encode("WEBVTT\n\n00:08.000 --> 00:12.000\nToo late\n"), 10_000),
    ).toThrow(/video duration/);
  });

  it("requires at least one cue", () => {
    expect(() => validateWebVtt(encode("WEBVTT\n"))).toThrow(/at least one/);
  });

  it("validates canonical upload metadata and hard file-size limit", () => {
    expect(
      captionUploadSchema.parse({
        fileName: "english.vtt",
        sizeBytes: 1024,
        mimeType: "text/vtt",
        languageCode: "ar-eg",
        label: "Arabic",
        kind: "SUBTITLES",
      }).languageCode,
    ).toBe("ar-EG");
    expect(
      captionUploadSchema.safeParse({
        fileName: "captions.srt",
        sizeBytes: 1024,
        mimeType: "text/plain",
        languageCode: "en",
        label: "English",
      }).success,
    ).toBe(false);
    expect(
      captionUploadSchema.safeParse({
        fileName: "captions.vtt",
        sizeBytes: CAPTION_FILE_MAX_BYTES + 1,
        mimeType: "text/vtt",
        languageCode: "en",
        label: "English",
      }).success,
    ).toBe(false);
  });
});
