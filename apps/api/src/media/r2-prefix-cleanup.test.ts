import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMediaStorageConfig } from "./media-storage.config.js";
import { R2MediaStorageAdapter } from "./r2-media-storage.adapter.js";

const config = loadMediaStorageConfig({
  APP_ENV: "test",
  R2_ACCOUNT_ID: "cleanup-fixture",
  R2_BUCKET: "ayin-test",
  R2_ACCESS_KEY_ID: "synthetic-access",
  R2_SECRET_ACCESS_KEY: "synthetic-secret",
  UPLOAD_SESSION_SECRET: "synthetic-upload-secret-more-than-32-characters",
});
const prefix = "channels/fixture/segments/";
function listing(keys: string[], more = false, next = "") {
  return `<ListBucketResult><Name>ayin-test</Name><Prefix>${encodeURIComponent(prefix)}</Prefix><EncodingType>url</EncodingType><KeyCount>${keys.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>${more}</IsTruncated>${keys.map((key) => `<Contents><Key>${encodeURIComponent(key)}</Key><Size>1</Size></Contents>`).join("")}${next ? `<NextContinuationToken>${next}</NextContinuationToken>` : ""}</ListBucketResult>`;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("bounded legacy prefix cleanup under fenced worker leases", () => {
  it("deletes exact provider-listed keys across all complete pages", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(listing([`${prefix}one.ts`], true, "next-page")))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(listing([`${prefix}two.ts`])))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await new R2MediaStorageAdapter(config).deletePrefix(prefix);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.map(([, init]) => init.method)).toEqual([
      "GET",
      "DELETE",
      "GET",
      "DELETE",
    ]);
    expect(new URL(fetch.mock.calls[2]![0]).searchParams.get("continuation-token")).toBe(
      "next-page",
    );
  });
  it.each([
    "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>",
    listing(["other-channel/private.ts"]),
    listing([`${prefix}one.ts`], true),
    listing([]).replace(
      "</ListBucketResult>",
      "<CommonPrefixes><Prefix>channels%2Ffixture%2Fsegments%2Fhidden%2F</Prefix></CommonPrefixes></ListBucketResult>",
    ),
    listing([]).replace("<KeyCount>0</KeyCount>", "<KeyCount>1</KeyCount>"),
    listing([]).replace("</ListBucketResult>", "<Delimiter>%2F</Delimiter></ListBucketResult>"),
    "<Error><Code>AccessDenied</Code></Error>",
  ])("rejects malformed or wrongly addressed inventory before deletion", async (xml) => {
    const fetch = vi.fn(async () => new Response(xml));
    vi.stubGlobal("fetch", fetch);
    await expect(new R2MediaStorageAdapter(config).deletePrefix(prefix)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      operation: "deletePrefix",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("bounds a stalled prefix operation without consuming a full five-minute lease", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetch);
    const operation = new R2MediaStorageAdapter(config).deletePrefix(prefix);
    const rejected = expect(operation).rejects.toMatchObject({
      code: "OBSERVATION_TIMEOUT",
      operation: "deletePrefix",
    });
    await vi.advanceTimersByTimeAsync(30001);
    await rejected;
    expect(fetch.mock.calls).toHaveLength(1);
  });
});
