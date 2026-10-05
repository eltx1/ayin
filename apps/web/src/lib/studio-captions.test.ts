import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountScopeError } from "./account-scope";
import { finalizeStudioCaptionUpload, getStudioCaptions, removeStudioCaption } from "./studio";
import {
  CAPTION_MAX_BYTES,
  parseCaptionFinalized,
  parseCaptionPrepared,
  parseCaptionRemoved,
  parseCaptionUpdated,
  parseStudioCaptions,
  prepareStudioCaptionReplacement,
  prepareStudioCaptionUpload,
  putCaptionFile,
  updateStudioCaption,
  validateCaptionFile,
} from "./studio-captions";
const video = "10000000-0000-4000-8000-000000000001",
  track = "20000000-0000-4000-8000-000000000001",
  account = "30000000-0000-4000-8000-000000000001";
const row = {
  id: track,
  videoId: video,
  languageCode: "en",
  label: "English",
  kind: "SUBTITLES",
  default: false,
  enabled: true,
  status: "READY",
  sizeBytes: 50,
  replacing: false,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};
const prepared = {
  trackId: track,
  uploadUrl: "https://media.example.test/signed?token=test",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  maxBytes: CAPTION_MAX_BYTES,
  contentType: "text/vtt",
};
const scope = { expectedAccountId: account };
function mock(value: unknown, after: unknown = { account: { id: account } }) {
  return vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ account: { id: account } }))
      .mockResolvedValueOnce(Response.json(value))
      .mockResolvedValueOnce(Response.json(after)),
  );
}
afterEach(() => vi.unstubAllGlobals());
describe("caption response authority", () => {
  it("rejects invalid list rather than trusting tracks", async () => {
    mock({ tracks: {} });
    await expect(getStudioCaptions(video, scope)).rejects.toBeDefined();
  });
  it("rejects finalize acknowledgement for a different track", async () => {
    mock({ trackId: video, status: "READY", cueCount: 1 });
    await expect(finalizeStudioCaptionUpload(video, track, scope)).rejects.toMatchObject({
      writeStarted: true,
      acknowledged: false,
    });
  });
  it("rejects a false remove acknowledgement", async () => {
    mock({ removed: false, trackId: track });
    await expect(removeStudioCaption(video, track, scope)).rejects.toMatchObject({
      writeStarted: true,
      acknowledged: false,
    });
  });
  it("validates every list identity, date, enum, boolean and byte bound", () => {
    expect(parseStudioCaptions({ tracks: [row] }, video).tracks).toEqual([row]);
    for (const patch of [
      { videoId: account },
      { id: "not-an-id" },
      { status: "DELETED" },
      { kind: "OTHER" },
      { default: "false" },
      { default: true, enabled: false },
      { replacing: 1 },
      { languageCode: "arabic_invalid" },
      { label: "" },
      { sizeBytes: -1 },
      { sizeBytes: CAPTION_MAX_BYTES + 1 },
      { status: "READY", sizeBytes: null },
      { createdAt: "yesterday" },
    ])
      expect(() => parseStudioCaptions({ tracks: [{ ...row, ...patch }] }, video)).toThrow();
    expect(() => parseStudioCaptions({ tracks: [row, row] }, video)).toThrow();
    expect(() => parseStudioCaptions({ tracks: [row, { ...row, id: account }] }, video)).toThrow();
    expect(() =>
      parseStudioCaptions(
        {
          tracks: [
            { ...row, default: true },
            { ...row, id: account, languageCode: "ar", default: true },
          ],
        },
        video,
      ),
    ).toThrow();
  });
  it("validates scoped upload URLs, expiry and replacement track", () => {
    expect(parseCaptionPrepared(prepared, track)).toEqual(prepared);
    for (const patch of [
      { trackId: account },
      { contentType: "text/plain" },
      { maxBytes: 1 },
      { expiresAt: "2000-01-01T00:00:00Z" },
      { uploadUrl: "javascript:alert(1)" },
      { uploadUrl: "http://evil.example/object" },
      { uploadUrl: "https://user:password@media.example/object" },
    ])
      expect(() => parseCaptionPrepared({ ...prepared, ...patch }, track)).toThrow();
  });
  it("validates mutations against requested identity and values", () => {
    expect(
      parseCaptionFinalized({ trackId: track, status: "READY", cueCount: 1 }, track).status,
    ).toBe("READY");
    expect(() =>
      parseCaptionFinalized({ trackId: track, status: "READY", cueCount: -1 }, track),
    ).toThrow();
    expect(() => parseCaptionUpdated(row, track, { enabled: false })).toThrow();
    expect(() => parseCaptionRemoved({ removed: true, trackId: account }, track)).toThrow();
  });
  it("protects all API requests with expected account and no-store", async () => {
    mock({ tracks: [row] });
    const result = await getStudioCaptions(video, scope);
    expect(result.accountId).toBe(account);
    for (const [, init] of vi.mocked(fetch).mock.calls)
      expect(init).toMatchObject({
        credentials: "include",
        cache: "no-store",
        headers: { "x-ayin-expected-account": account },
      });
  });
  it("does not start writes after account changed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ account: { id: video } })));
    await expect(removeStudioCaption(video, track, scope)).rejects.toMatchObject({
      code: "ACCOUNT_CHANGED",
      writeStarted: false,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps a validated commit acknowledged after a failed trailing identity read", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ account: { id: account } }))
        .mockResolvedValueOnce(Response.json({ removed: true, trackId: track }))
        .mockRejectedValueOnce(new Error("offline")),
    );
    await expect(removeStudioCaption(video, track, scope)).rejects.toMatchObject({
      acknowledged: true,
      writeStarted: true,
    });
  });
  it("never replays an uncertain write", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ account: { id: account } }))
        .mockRejectedValueOnce(new Error("lost acknowledgement")),
    );
    await expect(removeStudioCaption(video, track, scope)).rejects.toMatchObject({
      acknowledged: false,
      writeStarted: true,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("preserves original API routes and payloads", async () => {
    mock(prepared);
    const file = new File(["WEBVTT"], "en.vtt");
    await prepareStudioCaptionReplacement(video, track, file, scope);
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toContain(
      `/videos/${video}/captions/${track}/uploads`,
    );
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body))).toEqual({
      fileName: "en.vtt",
      sizeBytes: 6,
      mimeType: "text/vtt",
    });
    mock(prepared);
    await prepareStudioCaptionUpload(
      video,
      {
        fileName: "en.vtt",
        sizeBytes: 6,
        mimeType: "text/vtt",
        languageCode: "en",
        label: "English",
        kind: "SUBTITLES",
        default: false,
      },
      scope,
    );
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toContain(`/videos/${video}/captions/uploads`);
    mock({ ...row, enabled: false });
    await updateStudioCaption(video, track, { enabled: false }, scope);
    expect(vi.mocked(fetch).mock.calls[1]?.[1]).toMatchObject({
      method: "PATCH",
      body: '{"enabled":false}',
    });
  });
  it("sends bytes directly without cookies and does not retry a failed PUT", async () => {
    const file = new File(["WEBVTT"], "en.vtt");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(putCaptionFile(prepared.uploadUrl, file)).rejects.toBeInstanceOf(
      AccountScopeError,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      prepared.uploadUrl,
      expect.objectContaining({
        method: "PUT",
        credentials: "omit",
        redirect: "error",
        body: file,
      }),
    );
  });
  it("checks actual non-empty WebVTT selection bounds", () => {
    expect(validateCaptionFile(new File(["WEBVTT"], "a.VTT"))).toBeNull();
    expect(validateCaptionFile(new File(["WEBVTT"], "a.txt"))).toBe("fileType");
    expect(validateCaptionFile(new File([], "a.vtt"))).toBe("fileSize");
    expect(validateCaptionFile(new File([new Uint8Array(CAPTION_MAX_BYTES + 1)], "a.vtt"))).toBe(
      "fileSize",
    );
  });
});

describe("caption intermediate outcome privacy", () => {
  it("retains a validated prepared target without claiming a ready caption or leaking its signed URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ account: { id: account } }))
        .mockResolvedValueOnce(Response.json(prepared))
        .mockRejectedValueOnce(new Error("identity offline")),
    );
    try {
      await prepareStudioCaptionUpload(
        video,
        {
          fileName: "en.vtt",
          sizeBytes: 6,
          mimeType: "text/vtt",
          languageCode: "en",
          label: "English",
          kind: "SUBTITLES",
          default: false,
        },
        scope,
      );
      throw new Error("Expected identity failure");
    } catch (error) {
      expect(error).toMatchObject({
        identityUnverified: true,
        stage: "PREPARED",
        trackId: track,
        acknowledged: true,
      });
      expect(error).not.toHaveProperty("uploadUrl");
    }
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("marks failed pre-PUT verification as prepared and sends no file", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("identity offline")));
    await expect(
      putCaptionFile(prepared.uploadUrl, new File(["WEBVTT"], "en.vtt"), scope),
    ).rejects.toMatchObject({ identityUnverified: true, stage: "PREPARED", acknowledged: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("marks received bytes as uploaded, never a final-caption acknowledgement, if post-PUT identity fails", async () => {
    const identity = {
      account: { id: account, displayName: "Test", email: "test@example.test" },
      channel: { id: video, handle: "test", name: "Test" },
      profile: { id: video, slug: "test", name: "Test" },
      creatorTv: { id: video, slug: "test", name: "Test" },
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(identity))
      .mockResolvedValueOnce(Response.json(identity))
      .mockResolvedValueOnce(Response.json(identity))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new Error("identity offline"));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      putCaptionFile(prepared.uploadUrl, new File(["WEBVTT"], "en.vtt"), scope),
    ).rejects.toMatchObject({ identityUnverified: true, stage: "UPLOADED", acknowledged: false });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
});
