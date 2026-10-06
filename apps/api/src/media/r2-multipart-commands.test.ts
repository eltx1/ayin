import { afterEach, describe, expect, it, vi } from "vitest";

import { loadMediaStorageConfig } from "./media-storage.config.js";
import { R2MediaStorageAdapter } from "./r2-media-storage.adapter.js";

const config = loadMediaStorageConfig({
  APP_ENV: "test",
  R2_ACCOUNT_ID: "multipart-command-fixture",
  R2_BUCKET: "ayin-test",
  R2_ACCESS_KEY_ID: "synthetic-access",
  R2_SECRET_ACCESS_KEY: "synthetic-secret",
  UPLOAD_SESSION_SECRET: "synthetic-upload-secret-more-than-32-characters",
});
const key = "channels/fixture/source.mp4";
const uploadId = "fixture-upload";
const contentType = "video/mp4";
const created = (fields = "", responseKey = key) =>
  `<?xml version="1.0" encoding="UTF-8"?><InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Bucket>ayin-test</Bucket><Key>${responseKey}</Key><UploadId>${uploadId}</UploadId>${fields}</InitiateMultipartUploadResult>`;
const completed = (fields = "", responseKey = key) =>
  `<CompleteMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Location>https://fixture.invalid/source.mp4</Location><Bucket>ayin-test</Bucket><Key>${responseKey}</Key><ETag>&quot;completed-1&quot;</ETag>${fields}</CompleteMultipartUploadResult>`;
const operations = ["create", "complete"] as const;
type Operation = (typeof operations)[number];
const xmlFor = (operation: Operation) => (operation === "create" ? created() : completed());

function fixture(...responses: Response[]) {
  const fetch = vi.fn<(url: URL, init: RequestInit) => Promise<Response>>();
  responses.forEach((response) => fetch.mockResolvedValueOnce(response));
  vi.stubGlobal("fetch", fetch);
  return { storage: new R2MediaStorageAdapter(config), fetch };
}

function run(storage: R2MediaStorageAdapter, operation: Operation) {
  return operation === "create"
    ? storage.createMultipartUpload({ key, contentType })
    : storage.completeMultipartUpload({
        key,
        uploadId,
        parts: [{ partNumber: 1, etag: '"part-1"' }],
      });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("bounded R2 multipart command responses", () => {
  it("decodes XML entities once while preserving opaque IDs and exact object keys", async () => {
    const specialKey = "channels/فيديو & 100%2F/source.mp4";
    const opaqueId = "opaque&+/%2F==";
    const { storage, fetch } = fixture(
      new Response(
        created("", specialKey.replaceAll("&", "&amp;")).replace(
          `<UploadId>${uploadId}</UploadId>`,
          "<UploadId>opaque&amp;+/%2F==</UploadId>",
        ),
      ),
      new Response(completed("", specialKey.replaceAll("&", "&amp;"))),
    );
    expect(await storage.createMultipartUpload({ key: specialKey, contentType })).toEqual({
      uploadId: opaqueId,
    });
    expect(
      await storage.completeMultipartUpload({
        key: specialKey,
        uploadId: opaqueId,
        parts: [{ partNumber: 1, etag: "part-1" }],
      }),
    ).toEqual({ etag: '"completed-1"' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([, init]) => init.method === "POST")).toBe(true);
    expect(fetch.mock.calls[0]![0].searchParams.get("uploads")).toBe("");
    expect(fetch.mock.calls[1]![0].searchParams.get("uploadId")).toBe(opaqueId);
  });

  describe.each(operations)("%s", (operation) => {
    it.each([
      ["wrong root", (xml: string) => xml.replaceAll("MultipartUploadResult", "OtherResult")],
      ["wrong bucket", (xml: string) => xml.replace("ayin-test", "foreign-bucket")],
      ["wrong key", (xml: string) => xml.replace(key, "channels/other/source.mp4")],
      ["missing bucket", (xml: string) => xml.replace("<Bucket>ayin-test</Bucket>", "")],
      ["missing key", (xml: string) => xml.replace(`<Key>${key}</Key>`, "")],
      [
        "duplicate key",
        (xml: string) => xml.replace(`<Key>${key}</Key>`, `<Key>${key}</Key><Key>${key}</Key>`),
      ],
      ["nested scalar", (xml: string) => xml.replace(key, `<Value>${key}</Value>`)],
      ["unknown entity", (xml: string) => xml.replace(key, "&unknown;")],
      ["multiple roots", (xml: string) => xml + "<Other/>"],
      ["unclosed root", (xml: string) => xml.replace(/<\/[^>]+>$/, "")],
      ["mixed content", (xml: string) => xml.replace("<Bucket>", "unexpected<Bucket>")],
      ["unknown field", (xml: string) => xml.replace("<Bucket>", "<Unexpected/><Bucket>")],
      ["DTD", (xml: string) => '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///private">]>' + xml],
      [
        "embedded error",
        () => "<Error><Code>InternalError</Code><Message>private</Message></Error>",
      ],
    ] as const)("rejects %s after exactly one request", async (_label, mutate) => {
      const { storage, fetch } = fixture(new Response(mutate(xmlFor(operation))));
      await expect(run(storage, operation)).rejects.toMatchObject({ name: "R2XmlError" });
      expect(fetch).toHaveBeenCalledOnce();
    });

    it.each(["declared", "streamed"])("bounds %s response bytes", async (kind) => {
      const response =
        kind === "declared"
          ? new Response("", { headers: { "content-length": "65537" } })
          : new Response("ف".repeat(32769));
      const { storage, fetch } = fixture(response);
      await expect(run(storage, operation)).rejects.toMatchObject({
        name: "R2XmlError",
        limitExceeded: true,
      });
      expect(fetch).toHaveBeenCalledOnce();
    });

    it.each([
      ["invalid UTF-8", () => new Response(new Uint8Array([0xc3, 0x28]))],
      [
        "incorrect declared length",
        () => new Response(xmlFor(operation), { headers: { "content-length": "1" } }),
      ],
      ["missing body", () => new Response(null)],
    ] as const)("rejects %s", async (_label, response) => {
      const { storage } = fixture(response());
      await expect(run(storage, operation)).rejects.toMatchObject({ name: "R2XmlError" });
    });

    it("times out a stalled request, aborts it, and never retries", async () => {
      vi.useFakeTimers();
      const { storage, fetch } = fixture();
      fetch.mockImplementation(() => new Promise(() => undefined));
      const rejected = expect(run(storage, operation)).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(30001);
      await rejected;
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0]![1].signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("bounds the response body under the same deadline and cancels its reader", async () => {
      vi.useFakeTimers();
      const cancel = vi.fn();
      const { storage, fetch } = fixture(new Response(new ReadableStream({ cancel })));
      const rejected = expect(run(storage, operation)).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(30001);
      await rejected;
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("cancels a response that arrives after the request deadline", async () => {
      vi.useFakeTimers();
      let respond!: (response: Response) => void;
      const { storage, fetch } = fixture();
      fetch.mockImplementation(() => new Promise((resolve) => (respond = resolve)));
      const rejected = expect(run(storage, operation)).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(30001);
      await rejected;
      const cancel = vi.fn();
      respond(new Response(new ReadableStream({ cancel })));
      await vi.advanceTimersByTimeAsync(0);
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
    });

    it("clears the response deadline after success", async () => {
      vi.useFakeTimers();
      const { storage } = fixture(new Response(xmlFor(operation)));
      await run(storage, operation);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it.each([
    "",
    " ",
    "has space",
    " padded ",
    "line&#10;break",
    "x".repeat(1025),
    "<Value>nested</Value>",
  ])("rejects invalid create upload IDs", async (id) => {
    const { storage } = fixture(
      new Response(
        created().replace(`<UploadId>${uploadId}</UploadId>`, `<UploadId>${id}</UploadId>`),
      ),
    );
    await expect(run(storage, "create")).rejects.toMatchObject({ name: "R2XmlError" });
  });

  it.each([
    created().replace(`<UploadId>${uploadId}</UploadId>`, ""),
    created(`<UploadId>${uploadId}</UploadId>`),
  ])("requires exactly one create upload ID", async (xml) => {
    const { storage } = fixture(new Response(xml));
    await expect(run(storage, "create")).rejects.toMatchObject({ name: "R2XmlError" });
  });

  it.each([
    "",
    "&quot;&quot;",
    "unquoted",
    "&quot;unterminated",
    "&quot;has space&quot;",
    "&quot;line&#10;break&quot;",
    `&quot;${"x".repeat(255)}&quot;`,
    "<Value>nested</Value>",
  ])("rejects invalid completion ETags", async (etag) => {
    const { storage } = fixture(
      new Response(
        completed().replace("<ETag>&quot;completed-1&quot;</ETag>", `<ETag>${etag}</ETag>`),
      ),
    );
    await expect(run(storage, "complete")).rejects.toMatchObject({ name: "R2XmlError" });
  });

  it.each([
    completed().replace("<ETag>&quot;completed-1&quot;</ETag>", ""),
    completed("<ETag>&quot;other&quot;</ETag>"),
    completed("<Location>duplicate</Location>"),
  ])("rejects missing or duplicate completion fields", async (xml) => {
    const { storage } = fixture(new Response(xml));
    await expect(run(storage, "complete")).rejects.toMatchObject({ name: "R2XmlError" });
  });

  it("XML-escapes opaque request ETags and sorts a copy of the supplied parts", async () => {
    const { storage, fetch } = fixture(new Response(completed()));
    const parts = [
      { partNumber: 2, etag: '"opaque<&>\'"' },
      { partNumber: 1, etag: "plain" },
    ];
    await storage.completeMultipartUpload({ key, uploadId, parts });
    expect(fetch.mock.calls[0]![1].body).toBe(
      "<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>&quot;plain&quot;</ETag></Part><Part><PartNumber>2</PartNumber><ETag>&quot;opaque&lt;&amp;&gt;&apos;&quot;</ETag></Part></CompleteMultipartUpload>",
    );
    expect(parts.map((part) => part.partNumber)).toEqual([2, 1]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { parts: [] },
    { parts: [{ partNumber: 0, etag: "etag" }] },
    { parts: [{ partNumber: 1.5, etag: "etag" }] },
    { parts: [{ partNumber: 10001, etag: "etag" }] },
    { parts: [{ partNumber: 1, etag: '"embedded"quote"' }] },
    { parts: [{ partNumber: 1, etag: "bad\uD800" }] },
    { parts: [{ partNumber: 1, etag: "" }] },
    {
      parts: [
        { partNumber: 1, etag: "etag" },
        { partNumber: 1, etag: "other" },
      ],
    },
  ])("rejects invalid parts before sending a completion command", async ({ parts }) => {
    const { storage, fetch } = fixture();
    await expect(storage.completeMultipartUpload({ key, uploadId, parts })).rejects.toMatchObject({
      name: "R2XmlError",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the exact supplied signing instant for both grant kinds without provider requests", async () => {
    const { storage, fetch } = fixture();
    const now = new Date("2026-10-06T01:02:03.456Z");
    const grants = await Promise.all([
      storage.authorizeSinglePut({ key, contentType, expiresInSeconds: 60, now }),
      storage.authorizeMultipartPart({ key, uploadId, partNumber: 1, expiresInSeconds: 60, now }),
    ]);
    for (const grant of grants) {
      expect(new URL(grant.url).searchParams.get("X-Amz-Date")).toBe("20261006T010203Z");
      expect(new URL(grant.url).searchParams.get("X-Amz-Expires")).toBe("60");
      expect(grant.expiresAt.toISOString()).toBe("2026-10-06T01:03:03.456Z");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
