import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadMediaStorageConfig } from "./media-storage.config.js";
import { R2MediaStorageAdapter } from "./r2-media-storage.adapter.js";
import { MediaUploadService } from "./media-upload.service.js";

const config = loadMediaStorageConfig({
  APP_ENV: "test",
  R2_ACCOUNT_ID: "observation-fixture",
  R2_BUCKET: "ayin-test",
  R2_ACCESS_KEY_ID: "synthetic-access",
  R2_SECRET_ACCESS_KEY: "synthetic-secret",
  UPLOAD_SESSION_SECRET: "synthetic-upload-secret-more-than-32-characters",
});
const key = "channels/fixture/source.mp4";
const uploadId = "fixture-upload";
const part = (number: number, size = "16777216") =>
  `<Part><PartNumber>${number}</PartNumber><ETag>&quot;etag-${number}&quot;</ETag><Size>${size}</Size></Part>`;
const parts = (body = "", truncated = false, marker = "0", next = "") =>
  `<?xml version="1.0" encoding="UTF-8"?><ListPartsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Bucket>ayin-test</Bucket><Key>${key}</Key><UploadId>${uploadId}</UploadId><PartNumberMarker>${marker}</PartNumberMarker><MaxParts>1000</MaxParts><IsTruncated>${truncated}</IsTruncated>${next ? `<NextPartNumberMarker>${next}</NextPartNumberMarker>` : ""}${body}</ListPartsResult>`;
const upload = (name = key, id = uploadId, initiated = "2026-10-01T12:00:00.000Z") =>
  `<Upload><Key>${encodeURIComponent(name)}</Key><UploadId>${id}</UploadId><Initiated>${initiated}</Initiated></Upload>`;
const uploads = (
  body = "",
  truncated = false,
  marker = "",
  uploadMarker = "",
  nextKey = "",
  nextUpload = "",
) =>
  `<ListMultipartUploadsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Bucket>ayin-test</Bucket><EncodingType>url</EncodingType><Prefix>channels%2F</Prefix><KeyMarker>${encodeURIComponent(marker)}</KeyMarker><UploadIdMarker>${uploadMarker}</UploadIdMarker><MaxUploads>1000</MaxUploads><IsTruncated>${truncated}</IsTruncated>${nextKey ? `<NextKeyMarker>${encodeURIComponent(nextKey)}</NextKeyMarker>` : ""}${nextUpload ? `<NextUploadIdMarker>${nextUpload}</NextUploadIdMarker>` : ""}${body}</ListMultipartUploadsResult>`;
const response = (xml: string, status = 200) =>
  new Response(xml, { status, headers: { "content-type": "application/xml" } });

function fixture(...pages: Response[]) {
  const fetch = vi.fn();
  pages.forEach((page) => fetch.mockResolvedValueOnce(page));
  vi.stubGlobal("fetch", fetch);
  return { storage: new R2MediaStorageAdapter(config), fetch };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("bounded, complete R2 upload observations", () => {
  it("follows part markers and returns every page without changing storage", async () => {
    const { storage, fetch } = fixture(
      response(parts(part(1) + part(3), true, "0", "3")),
      response(parts(part(4, "42"), false, "3")),
    );
    expect(await storage.listParts({ key, uploadId })).toEqual([
      { partNumber: 1, etag: '"etag-1"', sizeBytes: 16777216 },
      { partNumber: 3, etag: '"etag-3"', sizeBytes: 16777216 },
      { partNumber: 4, etag: '"etag-4"', sizeBytes: 42 },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const urls = fetch.mock.calls.map(([url]) => new URL(url));
    expect(urls.map((url) => url.searchParams.get("max-parts"))).toEqual(["1000", "1000"]);
    expect(urls.map((url) => url.searchParams.get("part-number-marker"))).toEqual([null, "3"]);
    expect(fetch.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });

  it("follows paired multipart cursors and decodes keys exactly once", async () => {
    const first = "channels/فيديو & 100%/source.mp4";
    const { storage, fetch } = fixture(
      response(uploads(upload(first, "z+first"), true, "", "", first, "z+first")),
      response(uploads(upload(first, "a+later"), false, first, "z+first")),
    );
    const result = await storage.listMultipartUploads("channels/");
    expect(result.map(({ key, uploadId }) => ({ key, uploadId }))).toEqual([
      { key: first, uploadId: "z+first" },
      { key: first, uploadId: "a+later" },
    ]);
    expect(result[0]?.initiatedAt.toISOString()).toBe("2026-10-01T12:00:00.000Z");
    const next = new URL(fetch.mock.calls[1]?.[0]);
    expect(next.searchParams.get("key-marker")).toBe(first);
    expect(next.searchParams.get("upload-id-marker")).toBe("z+first");
    expect(next.searchParams.get("encoding-type")).toBe("url");
    expect(next.searchParams.get("max-uploads")).toBe("1000");
    expect(fetch.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });

  it("accepts genuinely complete empty observations", async () => {
    const { storage } = fixture(response(parts()), response(uploads()));
    expect(await storage.listParts({ key, uploadId })).toEqual([]);
    expect(await storage.listMultipartUploads("channels/")).toEqual([]);
  });

  it.each([
    ["unclosed XML", parts(part(1)).replace("</ListPartsResult>", "")],
    ["wrong root", "<Other><IsTruncated>false</IsTruncated></Other>"],
    ["missing truncation flag", parts().replace("<IsTruncated>false</IsTruncated>", "")],
    [
      "duplicate flag",
      parts().replace("</ListPartsResult>", "<IsTruncated>true</IsTruncated></ListPartsResult>"),
    ],
    ["invalid flag", parts().replace("false", "FALSE")],
    ["foreign key", parts().replace(`<Key>${key}</Key>`, "<Key>other</Key>")],
    ["foreign upload", parts().replace(uploadId, "other")],
    ["foreign bucket", parts().replace("ayin-test", "other")],
    ["duplicate part", parts(part(1) + part(1))],
    ["out of order part", parts(part(2) + part(1))],
    ["out of range part", parts(part(10001))],
    ["negative size", parts(part(1, "-1"))],
    ["unsafe size", parts(part(1, "9007199254740992"))],
    ["nondecimal size", parts(part(1, "1e3"))],
    ["missing ETag", parts(part(1).replace(/<ETag>.*?<\/ETag>/, ""))],
    ["duplicate field", parts(part(1).replace("</Part>", "<Size>3</Size></Part>"))],
    [
      "nested scalar",
      parts(part(1).replace("<Size>16777216</Size>", "<Size><Value>3</Value></Size>")),
    ],
    ["unknown entity", parts(part(1).replace("etag-1", "&unknown;"))],
    ["DTD", '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>' + parts()],
    ["missing next marker", parts(part(1), true)],
    ["next marker skips rows", parts(part(1), true, "0", "3")],
    ["empty truncated page", parts("", true, "0", "1")],
    ["too many page rows", parts(Array.from({ length: 1001 }, (_, i) => part(i + 1)).join(""))],
  ])("rejects %s rather than returning a partial part list", async (_label, xml) => {
    const { storage, fetch } = fixture(response(xml));
    await expect(storage.listParts({ key, uploadId })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate or stale parts on a later page", async () => {
    const { storage, fetch } = fixture(
      response(parts(part(1), true, "0", "1")),
      response(parts(part(1), false, "1")),
    );
    await expect(storage.listParts({ key, uploadId })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["unclosed XML", uploads(upload()).replace("</ListMultipartUploadsResult>", "")],
    ["foreign prefix", uploads(upload("elsewhere/source.mp4"))],
    ["wrong echoed prefix", uploads().replace("channels%2F", "elsewhere%2F")],
    ["duplicate identity", uploads(upload() + upload())],
    ["invalid timestamp", uploads(upload(key, uploadId, "not-a-date"))],
    ["impossible calendar date", uploads(upload(key, uploadId, "2026-02-30T12:00:00.000Z"))],
    ["missing upload ID", uploads(upload().replace(/<UploadId>.*?<\/UploadId>/, ""))],
    ["missing paired cursor", uploads(upload(), true, "", "", key)],
    ["empty truncated page", uploads("", true, "", "", key, uploadId)],
    [
      "wrong encoding",
      uploads().replace("<EncodingType>url</EncodingType>", "<EncodingType>base64</EncodingType>"),
    ],
    ["invalid percent encoding", uploads(upload()).replace(encodeURIComponent(key), "%ZZ")],
    [
      "unexpected common prefixes",
      uploads().replace(
        "</ListMultipartUploadsResult>",
        "<CommonPrefixes><Prefix>channels/</Prefix></CommonPrefixes></ListMultipartUploadsResult>",
      ),
    ],
  ])("rejects %s rather than returning incomplete multipart inventory", async (_label, xml) => {
    const { storage, fetch } = fixture(response(xml));
    await expect(storage.listMultipartUploads("channels/")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a repeated paired cursor without returning earlier pages", async () => {
    const { storage, fetch } = fixture(
      response(uploads(upload(), true, "", "", key, uploadId)),
      response(uploads(upload("channels/second", "other"), true, key, uploadId, key, uploadId)),
    );
    await expect(storage.listMultipartUploads("channels/")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    [404, "NoSuchUpload", "NO_SUCH_UPLOAD"],
    [404, "NoSuchBucket", "PROVIDER_ERROR"],
    [403, "AccessDenied", "PROVIDER_ERROR"],
    [503, "ServiceUnavailable", "PROVIDER_ERROR"],
    [500, "NoSuchUpload", "PROVIDER_ERROR"],
  ])(
    "classifies HTTP %i %s without confusing failure with absence",
    async (status, providerCode, code) => {
      const { storage, fetch } = fixture(
        response(
          `<Error><Code>${providerCode}</Code><Message>private provider detail</Message></Error>`,
          status,
        ),
      );
      const result = storage.listParts({ key, uploadId });
      await expect(result).rejects.toMatchObject({ code });
      await expect(result).rejects.not.toThrow("private provider detail");
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("does not return the first page when a later provider request fails", async () => {
    const { storage, fetch } = fixture(
      response(parts(part(1), true, "0", "1")),
      response("<Error><Code>ServiceUnavailable</Code></Error>", 503),
    );
    await expect(storage.listParts({ key, uploadId })).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects a successful HTTP response carrying an Error document", async () => {
    const { storage } = fixture(response("<Error><Code>NoSuchUpload</Code></Error>"));
    await expect(storage.listParts({ key, uploadId })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("bounds declared and streamed response bytes", async () => {
    const excessive = "x".repeat(2 * 1024 * 1024 + 1);
    const { storage } = fixture(
      new Response("", { headers: { "content-length": "2097153" } }),
      response(excessive),
    );
    await expect(storage.listParts({ key, uploadId })).rejects.toMatchObject({
      code: "OBSERVATION_LIMIT_EXCEEDED",
    });
    await expect(storage.listParts({ key, uploadId })).rejects.toMatchObject({
      code: "OBSERVATION_LIMIT_EXCEEDED",
    });
  });

  it("bounds a stalled fetch, aborts it and does not retry", async () => {
    vi.useFakeTimers();
    const { storage, fetch } = fixture();
    fetch.mockImplementation(() => new Promise(() => undefined));
    const result = storage.listParts({ key, uploadId });
    const rejected = expect(result).rejects.toMatchObject({ code: "OBSERVATION_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(30001);
    await rejected;
    expect(fetch.mock.calls[0]?.[1].signal.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a stalled response body and cancels its reader", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const { storage } = fixture(new Response(new ReadableStream({ cancel })));
    const rejected = expect(storage.listMultipartUploads("channels/")).rejects.toMatchObject({
      code: "OBSERVATION_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(30001);
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts all 10000 parts only when the final page is explicitly complete", async () => {
    const pages = Array.from({ length: 10 }, (_, page) =>
      response(
        parts(
          Array.from({ length: 1000 }, (_, i) => part(page * 1000 + i + 1)).join(""),
          page !== 9,
          String(page * 1000),
          page !== 9 ? String((page + 1) * 1000) : "",
        ),
      ),
    );
    const { storage, fetch } = fixture(...pages);
    const result = await storage.listParts({ key, uploadId });
    expect(result).toHaveLength(10000);
    expect(result.at(-1)?.partNumber).toBe(10000);
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it("fails closed when the page cap is reached while parts remain", async () => {
    const { storage, fetch } = fixture(
      ...Array.from({ length: 100 }, (_, page) =>
        response(parts(part(page + 1), true, String(page), String(page + 1))),
      ),
    );
    await expect(storage.listParts({ key, uploadId })).rejects.toMatchObject({
      code: "OBSERVATION_LIMIT_EXCEEDED",
    });
    expect(fetch).toHaveBeenCalledTimes(100);
  });

  it.each([false, true])(
    "bounds multipart inventory at 10000 rows, truncation=%s",
    async (hasMore) => {
      const pages = Array.from({ length: 10 }, (_, page) => {
        const last = (page + 1) * 1000;
        const more = page !== 9 || hasMore;
        return response(
          uploads(
            Array.from({ length: 1000 }, (_, i) =>
              upload(key, `upload-${page * 1000 + i + 1}`),
            ).join(""),
            more,
            page ? key : "",
            page ? `upload-${page * 1000}` : "",
            more ? key : "",
            more ? `upload-${last}` : "",
          ),
        );
      });
      const { storage, fetch } = fixture(...pages);
      const result = storage.listMultipartUploads("channels/");
      if (hasMore)
        await expect(result).rejects.toMatchObject({ code: "OBSERVATION_LIMIT_EXCEEDED" });
      else expect(await result).toHaveLength(10000);
      expect(fetch).toHaveBeenCalledTimes(10);
    },
  );

  it("bounds total observation bytes even when each page is individually small enough", async () => {
    const padding = `<!--${"x".repeat(1024 * 1024)}-->`;
    const { storage, fetch } = fixture(
      ...Array.from({ length: 32 }, (_, page) =>
        response(parts(padding + part(page + 1), true, String(page), String(page + 1))),
      ),
    );
    await expect(storage.listParts({ key, uploadId })).rejects.toMatchObject({
      code: "OBSERVATION_LIMIT_EXCEEDED",
    });
    expect(fetch).toHaveBeenCalledTimes(32);
  });

  it("rejects changed echoed cursors and duplicate uploads across pages", async () => {
    const first = uploads(upload(), true, "", "", key, uploadId);
    for (const next of [uploads(upload(key, "second")), uploads(upload(), false, key, uploadId)]) {
      const { storage } = fixture(response(first), response(next));
      await expect(storage.listMultipartUploads("channels/")).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
      });
    }
  });

  it("rejects too many uploads on one page", async () => {
    const { storage } = fixture(
      response(
        uploads(Array.from({ length: 1001 }, (_, i) => upload(key, `upload-${i}`)).join("")),
      ),
    );
    await expect(storage.listMultipartUploads("channels/")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("does not interpret a network failure or unverified 404 body as missing upload", async () => {
    const { storage, fetch } = fixture(response("<html>private failure</html>", 404));
    fetch.mockRejectedValueOnce(new Error("private request URL"));
    await expect(storage.listParts({ key, uploadId })).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
    const result = storage.listParts({ key, uploadId });
    await expect(result).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    await expect(result).rejects.not.toThrow("private request URL");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("aborts cleanup before any database lookup or destructive call when a later inventory page fails", async () => {
    const { storage, fetch } = fixture(
      response(uploads(upload(), true, "", "", key, uploadId)),
      response("<Error><Code>ServiceUnavailable</Code></Error>", 503),
    );
    const asset = { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() };
    const abort = vi.spyOn(storage, "abortMultipartUpload"),
      remove = vi.spyOn(storage, "deleteObject");
    const service = new MediaUploadService(
      { client: { mediaAsset: asset } } as never,
      {} as never,
      storage,
      config,
      {} as never,
      {} as never,
    );
    await expect(
      service.cleanupAbandonedUploads(new Date("2026-10-03T00:00:00.000Z")),
    ).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    Object.values(asset).forEach((operation) => expect(operation).not.toHaveBeenCalled());
    expect(abort).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(fetch.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });

  it("accepts fetch-decoded XML without comparing compressed Content-Length to decoded size", async () => {
    const { storage } = fixture(
      new Response(parts(), { headers: { "content-encoding": "gzip", "content-length": "42" } }),
    );
    expect(await storage.listParts({ key, uploadId })).toEqual([]);
  });

  it.each([
    "<Error><Code>NoSuchUpload</Code><Code>ServiceUnavailable</Code></Error>",
    "<Error>unexpected text<Code>NoSuchUpload</Code></Error>",
    "<Error><Other><Code>NoSuchUpload</Code></Other></Error>",
    "<Error><Code>NoSuchUpload</Code>",
  ])("never derives missing-upload state from malformed error XML", async (xml) => {
    const { storage } = fixture(response(xml, 404));
    await expect(storage.listParts({ key, uploadId })).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });

  it("cancels a response that arrives after the observation already timed out", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const { storage, fetch } = fixture();
    let finish!: (response: Response) => void;
    fetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const rejected = expect(storage.listParts({ key, uploadId })).rejects.toMatchObject({
      code: "OBSERVATION_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(30001);
    await rejected;
    finish(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["mismatched closing tag", parts(part(1)).replace("</Size>", "</Other>")],
    ["multiple roots", parts() + "<Other/>"],
    ["mixed record text", parts(part(1).replace("</Part>", "unexpected</Part>"))],
    [
      "duplicate attribute",
      parts().replace("<ListPartsResult xmlns=", '<ListPartsResult a="1" a="2" xmlns='),
    ],
  ])("rejects structurally invalid %s", async (_label, xml) => {
    const { storage } = fixture(response(xml));
    await expect(storage.listParts({ key, uploadId })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("distinguishes invalid UTF-8 from a failed body transport", async () => {
    const { storage } = fixture(
      new Response(new Uint8Array([0xff])),
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError("private socket failure"));
          },
        }),
      ),
    );
    await expect(storage.listParts({ key, uploadId })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(storage.listParts({ key, uploadId })).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });

  it("does not reset the total deadline when another page begins", async () => {
    vi.useFakeTimers();
    const { storage, fetch } = fixture();
    let finish!: (response: Response) => void;
    fetch
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockImplementation(() => new Promise(() => undefined));
    const rejected = expect(storage.listParts({ key, uploadId })).rejects.toMatchObject({
      code: "OBSERVATION_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(20000);
    finish(response(parts(part(1), true, "0", "1")));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10001);
    await rejected;
    expect(fetch.mock.calls[1]?.[1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never interprets NoSuchUpload as successful empty bucket inventory", async () => {
    const { storage } = fixture(response("<Error><Code>NoSuchUpload</Code></Error>", 404));
    await expect(storage.listMultipartUploads("channels/")).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
    });
  });
});
