import { describe, expect, it, vi, afterEach } from "vitest";
import {
  parseQuickConfirmation,
  parseQuickDraft,
  parseQuickProcessing,
  parseQuickPublication,
  scheduleTimestamp,
} from "./quick-upload-contract";
import { confirmQuickUpload, uploadQuickThumbnail } from "./quick-upload";
import {
  buildMetadataPayload,
  EMPTY_METADATA_DRAFT,
} from "../components/upload/video-metadata-fields";
const id = "11111111-1111-4111-8111-111111111111",
  channel = "22222222-2222-4222-8222-222222222222";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("creator workflow contracts", () => {
  it("requires the prepared root to belong to the requested channel and a validated file session", () => {
    const draft = {
      video: {
        id,
        channelId: channel,
        title: "Video",
        status: "UPLOADING",
        visibility: "PUBLIC",
        commentsEnabled: true,
        durationMs: null,
        videoForm: "LONG_FORM",
      },
      uploadSession: {
        assetId: id,
        sessionToken: "token",
        mode: "single",
        upload: { url: "https://storage.example/put", method: "PUT", headers: {} },
      },
    };
    expect(parseQuickDraft(draft, channel, 10).video.id).toBe(id);
    expect(() => parseQuickDraft(draft, id, 10)).toThrow();
    expect(() =>
      parseQuickDraft(
        {
          ...draft,
          uploadSession: {
            ...draft.uploadSession,
            upload: { ...draft.uploadSession.upload, url: "http://untrusted.example/put" },
          },
        },
        channel,
        10,
      ),
    ).toThrow();
  });
  it("rejects unrelated acknowledgments and invalid publication destinations", () => {
    expect(parseQuickConfirmation({ videoId: id, status: "DRAFT" }, id)).toEqual({
      videoId: id,
      status: "DRAFT",
    });
    expect(() => parseQuickConfirmation({ videoId: channel, status: "DRAFT" }, id)).toThrow();
    expect(() =>
      parseQuickPublication({ video: { id, status: "PUBLISHED", slug: "../admin" } }, id),
    ).toThrow();
    expect(() =>
      parseQuickPublication({ video: { id: channel, status: "PUBLISHED", slug: "video" } }, id),
    ).toThrow();
    expect(
      parseQuickPublication({ video: { id, status: "SCHEDULED", slug: "video" } }, id).video.status,
    ).toBe("SCHEDULED");
  });
  it("bounds processing progress and never confuses a foreign video with the current upload", () => {
    const status = { videoId: id, ready: false, videoStatus: "VALIDATING", processing: null };
    expect(parseQuickProcessing(status, id).ready).toBe(false);
    expect(() => parseQuickProcessing({ ...status, videoId: channel }, id)).toThrow();
    expect(() =>
      parseQuickProcessing(
        {
          ...status,
          processing: { status: "PROCESSING", progressPercent: 101, generation: 1, attempt: 0 },
        },
        id,
      ),
    ).toThrow();
  });
  it("validates a future schedule before any write and sends an explicit clear", () => {
    expect(scheduleTimestamp("")).toBeNull();
    for (const value of ["invalid", "2020-01-01T10:00", "2027-01-01T10:00:99", "2027-02-31T10:00"])
      expect(() => scheduleTimestamp(value)).toThrow();
    expect(new Date(scheduleTimestamp("2027-01-01T10:00", 0)!).getFullYear()).toBe(2027);
  });
  it("clears removed metadata and rejects invalid limits or conflicting territory policy locally", () => {
    expect(buildMetadataPayload(EMPTY_METADATA_DRAFT, { includeEmpty: true }).tags).toEqual([]);
    for (const changes of [
      { tags: "x".repeat(41) },
      { seasonNumber: "10001" },
      { allowedTerritories: "EG", blockedTerritories: "eg" },
      { chapters: "00:10 Later\n00:01 Earlier" },
      { adBreakPreference: "CUSTOM" as const, adBreakOffsets: "" },
      { rightsExpiresAt: "invalid" },
    ])
      expect(() => buildMetadataPayload({ ...EMPTY_METADATA_DRAFT, ...changes })).toThrow();
    expect(() =>
      buildMetadataPayload(
        { ...EMPTY_METADATA_DRAFT, chapters: "00:10 Outside" },
        { durationSeconds: 10 },
      ),
    ).toThrow();
  });
  it("does not replay a stalled confirmation mutation", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const operation = confirmQuickUpload(id);
    const failure = expect(operation).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.runAllTimersAsync();
    await failure;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects invalid thumbnails before allocating a server asset", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      uploadQuickThumbnail(id, new Blob(["image"], { type: "image/gif" })),
    ).rejects.toThrow("JPG or PNG");
    expect(fetch).not.toHaveBeenCalled();
  });
});
