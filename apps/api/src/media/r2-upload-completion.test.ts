import { afterEach, describe, expect, it, vi } from "vitest";

import { loadMediaStorageConfig } from "./media-storage.config.js";
import type { UploadCompletionObservationInput } from "./media-storage.adapter.js";
import { R2MediaStorageAdapter } from "./r2-media-storage.adapter.js";
import { uploadBindingHeaders } from "./r2-upload-completion.js";

const config = loadMediaStorageConfig({
  APP_ENV: "test",
  R2_ACCOUNT_ID: "completion-fixture",
  R2_BUCKET: "ayin-test",
  R2_ACCESS_KEY_ID: "synthetic-access",
  R2_SECRET_ACCESS_KEY: "synthetic-secret",
  UPLOAD_SESSION_SECRET: "synthetic-upload-secret-more-than-32-characters",
});
const key = "channels/fixture/source.mp4";
const uploadId = "fixture-upload";
const binding = {
  sessionId: "00000000-0000-4000-8000-000000000001",
  sourceAssetId: "00000000-0000-4000-8000-000000000002",
  contentIdentityDigest: "ab".repeat(32),
};
const expected = { sizeBytes: 42, contentType: "video/mp4", binding };
const single: UploadCompletionObservationInput = { key, uploadId: null, expected };
const multipart = { ...single, uploadId };
const headerValues = {
  "content-length": "42",
  "content-type": "video/mp4",
  etag: '"fixture-etag"',
  ...uploadBindingHeaders(binding),
};
function head(changes: Record<string, string | null> = {}) {
  const headers = new Headers(headerValues);
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  return new Response(null, { headers });
}
const xml = (body: string, status = 200) => new Response(body, { status });
const noSuchUpload = () => xml("<Error><Code>NoSuchUpload</Code></Error>", 404);
const parts = () =>
  xml(
    `<ListPartsResult><Bucket>ayin-test</Bucket><Key>${key}</Key><UploadId>${uploadId}</UploadId><PartNumberMarker>0</PartNumberMarker><MaxParts>1000</MaxParts><IsTruncated>false</IsTruncated></ListPartsResult>`,
  );
function fixture(...responses: Response[]) {
  const fetch = vi.fn();
  responses.forEach((response) => fetch.mockResolvedValueOnce(response));
  vi.stubGlobal("fetch", fetch);
  return { storage: new R2MediaStorageAdapter(config), fetch };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("read-only R2 upload completion identity observation", () => {
  it("verifies bound single objects with normalized content type", async () => {
    const { storage, fetch } = fixture(head({ "content-type": "Video/MP4; codecs=avc1" }));
    expect(await storage.observeUploadCompletion(single)).toEqual({
      status: "OBJECT_VERIFIED",
      metadata: {
        sizeBytes: 42,
        contentType: "Video/MP4; codecs=avc1",
        etag: '"fixture-etag"',
        uploadBinding: binding,
      },
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1].method).toBe("HEAD");
    expect("verifyUploadCleanupSettlement" in storage).toBe(false);
  });

  it("requires verified NoSuchUpload before multipart HEAD and never replays Complete", async () => {
    const { storage, fetch } = fixture(noSuchUpload(), head());
    expect((await storage.observeUploadCompletion(multipart)).status).toBe("OBJECT_VERIFIED");
    expect(fetch.mock.calls.map(([, init]) => init.method)).toEqual(["GET", "HEAD"]);
    expect(new URL(fetch.mock.calls[0]?.[0]).searchParams.get("uploadId")).toBe(uploadId);
    expect(new URL(fetch.mock.calls[1]?.[0]).search).toBe("");
  });

  it("reports a still-open multipart even with an empty part list and does not HEAD", async () => {
    const { storage, fetch } = fixture(parts(), head());
    expect(await storage.observeUploadCompletion(multipart)).toEqual({
      status: "MULTIPART_PRESENT",
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1].method).toBe("GET");
  });

  it.each([single, multipart])(
    "observes absence without any settlement claim: $uploadId",
    async (input) => {
      const { storage, fetch } = fixture(
        ...(input.uploadId ? [noSuchUpload()] : []),
        new Response(null, { status: 404 }),
      );
      expect(await storage.observeUploadCompletion(input)).toEqual({ status: "OBJECT_ABSENT" });
      expect(fetch.mock.calls.every(([, init]) => ["HEAD", "GET"].includes(init.method))).toBe(
        true,
      );
    },
  );

  it.each([
    ["untyped 404", 404, ""],
    ["foreign 404", 404, "<Error><Code>NoSuchBucket</Code></Error>"],
    ["wrong HTTP status", 503, "<Error><Code>NoSuchUpload</Code></Error>"],
    ["HTTP success with error XML", 200, "<Error><Code>NoSuchUpload</Code></Error>"],
    ["duplicate code", 404, "<Error><Code>NoSuchUpload</Code><Code>NoSuchUpload</Code></Error>"],
    ["bad XML", 404, "<Error><Code>NoSuchUpload</Code>"],
  ])("does not HEAD after %s", async (_label, status, body) => {
    const { storage, fetch } = fixture(xml(body as string, status as number), head());
    await expect(storage.observeUploadCompletion(multipart)).rejects.toMatchObject({
      operation: "observeUploadCompletion",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "missing binding",
      {
        "x-amz-meta-ayin-upload-session": null,
        "x-amz-meta-ayin-source-asset": null,
        "x-amz-meta-ayin-identity-root": null,
      },
    ],
    [
      "foreign session",
      { "x-amz-meta-ayin-upload-session": "00000000-0000-4000-8000-000000000003" },
    ],
    ["foreign asset", { "x-amz-meta-ayin-source-asset": "00000000-0000-4000-8000-000000000003" }],
    ["foreign identity", { "x-amz-meta-ayin-identity-root": "cd".repeat(32) }],
    ["wrong size", { "content-length": "43" }],
    ["empty object", { "content-length": "0" }],
    ["wrong type", { "content-type": "video/webm" }],
    ["missing type", { "content-type": null }],
    ["combined type", { "content-type": "video/mp4, video/webm" }],
    ["missing ETag", { etag: null }],
  ] satisfies Array<[string, Record<string, string | null>]>)(
    "never verifies %s",
    async (_label, changes) => {
      const { storage } = fixture(head(changes));
      expect(await storage.observeUploadCompletion(single)).toEqual({ status: "OBJECT_MISMATCH" });
    },
  );

  it.each([
    ["missing length", { "content-length": null }],
    ["empty length", { "content-length": "" }],
    ["negative length", { "content-length": "-1" }],
    ["fractional length", { "content-length": "42.0" }],
    ["exponential length", { "content-length": "4.2e1" }],
    ["combined length", { "content-length": "42, 42" }],
    ["unsafe length", { "content-length": "9007199254740992" }],
    ["partial binding", { "x-amz-meta-ayin-source-asset": null }],
    [
      "noncanonical UUID",
      { "x-amz-meta-ayin-upload-session": binding.sessionId.replace("4000", "A000") },
    ],
    ["invalid UUID", { "x-amz-meta-ayin-source-asset": "arbitrary" }],
    ["uppercase digest", { "x-amz-meta-ayin-identity-root": "AB".repeat(32) }],
    ["invalid digest", { "x-amz-meta-ayin-identity-root": "a".repeat(63) }],
    ["omitted metadata", { "x-amz-missing-meta": "1" }],
    ["empty ETag", { etag: "" }],
    ["empty quoted ETag", { etag: '""' }],
    ["weak ETag", { etag: 'W/"weak"' }],
    ["unterminated ETag", { etag: '"unclosed' }],
    ["spaces in ETag", { etag: '"not safe"' }],
    ["combined ETag", { etag: '"first", "second"' }],
    ["oversized ETag", { etag: '"' + "a".repeat(255) + '"' }],
  ] satisfies Array<[string, Record<string, string | null>]>)(
    "rejects malformed %s without fabricating metadata",
    async (_label, changes) => {
      const { storage, fetch } = fixture(head(changes));
      await expect(storage.observeUploadCompletion(single)).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
        operation: "observeUploadCompletion",
      });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it.each([202, 206])("rejects unexpected successful HEAD status %i", async (status) => {
    const { storage } = fixture(new Response(null, { status, headers: headerValues }));
    await expect(storage.observeUploadCompletion(single)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("preserves ordinary metadata-only HEAD for unbound legacy objects", async () => {
    const { storage } = fixture(
      head({
        "x-amz-meta-ayin-upload-session": null,
        "x-amz-meta-ayin-source-asset": null,
        "x-amz-meta-ayin-identity-root": null,
        etag: "legacy-etag",
      }),
    );
    expect(await storage.headObject(key)).toEqual({
      sizeBytes: 42,
      contentType: "video/mp4",
      etag: "legacy-etag",
    });
  });

  it("rejects malformed standalone HEAD metadata", async () => {
    const { storage } = fixture(head({ "content-length": null }));
    await expect(storage.headObject(key)).rejects.toThrow("object metadata is invalid");
  });

  it("sanitizes transport and HEAD provider errors", async () => {
    const { storage, fetch } = fixture();
    fetch.mockRejectedValueOnce(new Error("private key signed-url provider-detail"));
    const result = storage.observeUploadCompletion(single);
    await expect(result).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    await expect(result).rejects.not.toThrow("private");
    fetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(storage.observeUploadCompletion(single)).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      providerStatus: 403,
    });
  });

  it.each([single, multipart])("bounds a fetch ignoring abort for $uploadId", async (input) => {
    vi.useFakeTimers();
    const { storage, fetch } = fixture();
    fetch.mockImplementation(() => new Promise(() => undefined));
    const rejected = expect(storage.observeUploadCompletion(input)).rejects.toMatchObject({
      code: "OBSERVATION_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(30001);
    await rejected;
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses one deadline across NoSuchUpload and a hung final HEAD", async () => {
    vi.useFakeTimers();
    const { storage, fetch } = fixture();
    fetch.mockImplementationOnce(
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(noSuchUpload()), 20000)),
    );
    fetch.mockImplementationOnce(() => new Promise(() => undefined));
    const rejected = expect(storage.observeUploadCompletion(multipart)).rejects.toMatchObject({
      code: "OBSERVATION_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(30001);
    await rejected;
    expect(fetch.mock.calls.map(([, init]) => init.method)).toEqual(["GET", "HEAD"]);
    expect(fetch.mock.calls.every(([, init]) => init.signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a stalled NoSuchUpload error body rather than treating its status as proof", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const { storage, fetch } = fixture(
      new Response(new ReadableStream({ cancel }), { status: 404 }),
    );
    const rejected = expect(storage.observeUploadCompletion(multipart)).rejects.toMatchObject({
      code: "OBSERVATION_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(30001);
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not start HEAD if an abort-ignoring ListParts request resolves after deadline", async () => {
    vi.useFakeTimers();
    const { storage, fetch } = fixture();
    let resolve: (response: Response) => void = () => undefined;
    fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const rejected = expect(storage.observeUploadCompletion(multipart)).rejects.toMatchObject({
      code: "OBSERVATION_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(30001);
    await rejected;
    resolve(noSuchUpload());
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects invalid server expectations before provider I/O", async () => {
    const { storage, fetch } = fixture();
    for (const expectedChange of [
      { sizeBytes: 0 },
      { sizeBytes: 1.5 },
      { contentType: "invalid" },
      { binding: { ...binding, contentIdentityDigest: "bad" } },
    ]) {
      await expect(
        storage.observeUploadCompletion({
          ...single,
          expected: { ...expected, ...expectedChange },
        }),
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
