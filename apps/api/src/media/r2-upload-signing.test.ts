import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadMediaStorageConfig } from "./media-storage.config.js";
import { R2MediaStorageAdapter } from "./r2-media-storage.adapter.js";
import { R2SigV4 } from "./r2-sigv4.js";
import { uploadBindingHeaders } from "./r2-upload-completion.js";

const config = loadMediaStorageConfig({
  APP_ENV: "test",
  R2_ACCOUNT_ID: "signing-fixture",
  R2_BUCKET: "ayin-test",
  R2_ACCESS_KEY_ID: "synthetic-access",
  R2_SECRET_ACCESS_KEY: "synthetic-secret",
  UPLOAD_SESSION_SECRET: "synthetic-upload-secret-more-than-32-characters",
});
const key = "channels/fixture/source.mp4";
const binding = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  sourceAssetId: "22222222-2222-4222-8222-222222222222",
  contentIdentityDigest: "ab".repeat(32),
};
const bindingHeaders = uploadBindingHeaders(binding);
const now = new Date("2026-10-08T12:00:00Z");
const input = { key, contentType: "video/mp4", expiresInSeconds: 60, now };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const mac = (key: Buffer | string, value: string) =>
  createHmac("sha256", key).update(value).digest();
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

// Independently reconstruct the signed canonical request, so assertions verify
// header values affect authentication rather than just appearing in a header list.
function verifies(url: URL, method: string, suppliedHeaders: Record<string, string>, body = "") {
  const querySigned = url.searchParams.has("X-Amz-Signature");
  const authorization = suppliedHeaders.authorization ?? "";
  const headerNames = querySigned
    ? url.searchParams.get("X-Amz-SignedHeaders")!
    : /SignedHeaders=([^,]+)/.exec(authorization)![1]!;
  const scope = querySigned
    ? url.searchParams.get("X-Amz-Credential")!.split("/").slice(1).join("/")
    : /Credential=[^/]+\/([^,]+)/.exec(authorization)![1]!;
  const time = querySigned ? url.searchParams.get("X-Amz-Date")! : suppliedHeaders["x-amz-date"]!;
  const signature = querySigned
    ? url.searchParams.get("X-Amz-Signature")!
    : /Signature=([a-f0-9]+)$/.exec(authorization)![1]!;
  const headers = { ...suppliedHeaders, host: url.host };
  const canonicalHeaders = headerNames
    .split(";")
    .map((name) => `${name}:${headers[name as keyof typeof headers] ?? ""}\n`)
    .join("");
  const query = Array.from(url.searchParams.entries())
    .filter(([name]) => name !== "X-Amz-Signature")
    .map(([name, value]) => [encode(name), encode(value)])
    .sort(([a, av], [b, bv]) => (a! < b! ? -1 : a! > b! ? 1 : av! < bv! ? -1 : av! > bv! ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  const request = [
    method,
    url.pathname,
    query,
    canonicalHeaders,
    headerNames,
    querySigned ? "UNSIGNED-PAYLOAD" : digest(body),
  ].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", time, scope, digest(request)].join("\n");
  const [date, region] = scope.split("/");
  const signingKey = mac(
    mac(mac(mac("AWS4synthetic-secret", date!), region!), "s3"),
    "aws4_request",
  );
  return mac(signingKey, toSign).toString("hex") === signature;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("R2 upload identity metadata signing", () => {
  it("returns only the three exact canonical identity metadata headers", () => {
    expect(bindingHeaders).toEqual({
      "x-amz-meta-ayin-upload-session": binding.sessionId,
      "x-amz-meta-ayin-source-asset": binding.sourceAssetId,
      "x-amz-meta-ayin-identity-root": binding.contentIdentityDigest,
    });
  });

  it.each([
    { sessionId: "not-a-uuid" },
    { sessionId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
    { sessionId: "00000000-0000-0000-0000-000000000000" },
    { sourceAssetId: "22222222-2222-4222-7222-222222222222" },
    { sourceAssetId: " " + binding.sourceAssetId },
    { contentIdentityDigest: "AB".repeat(32) },
    { contentIdentityDigest: "a".repeat(63) },
    { contentIdentityDigest: "a".repeat(65) },
    { contentIdentityDigest: "a".repeat(64) + "\r\nx-other: injected" },
  ])("rejects invalid or noncanonical binding %j", (change) => {
    expect(() => uploadBindingHeaders({ ...binding, ...change })).toThrow(
      "identity or object metadata is invalid",
    );
  });

  it("signs all three single-PUT metadata headers and every value is authenticated", async () => {
    const storage = new R2MediaStorageAdapter(config);
    const signed = await storage.authorizeSinglePut({ ...input, uploadBinding: binding });
    const url = new URL(signed.url);
    const headers = { "content-type": input.contentType, ...bindingHeaders };
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-type;host;x-amz-meta-ayin-identity-root;x-amz-meta-ayin-source-asset;x-amz-meta-ayin-upload-session",
    );
    expect(verifies(url, "PUT", headers)).toBe(true);
    for (const name of Object.keys(bindingHeaders)) {
      expect(verifies(url, "PUT", { ...headers, [name]: "tampered" })).toBe(false);
      const omitted: Record<string, string> = { ...headers };
      delete omitted[name];
      expect(verifies(url, "PUT", omitted)).toBe(false);
    }
    expect(signed.expiresAt).toEqual(new Date(now.getTime() + 60000));
  });

  it("preserves unbound single-PUT and multipart-part signing", async () => {
    const storage = new R2MediaStorageAdapter(config);
    const signed = await storage.authorizeSinglePut(input);
    const url = new URL(signed.url);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
    expect(verifies(url, "PUT", { "content-type": input.contentType })).toBe(true);
    expect(signed).toEqual(new R2SigV4(config).presign({ ...input, method: "PUT" }));
    const part = await storage.authorizeMultipartPart({
      key,
      uploadId: "fixture-upload",
      partNumber: 1,
      expiresInSeconds: 60,
      now,
    });
    expect(new URL(part.url).searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(verifies(new URL(part.url), "PUT", {})).toBe(true);
  });

  it.each([true, false])(
    "binds multipart metadata at creation only when requested: %s",
    async (bound) => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      const fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(
            `<InitiateMultipartUploadResult><Bucket>ayin-test</Bucket><Key>${key}</Key><UploadId>fixture-upload</UploadId></InitiateMultipartUploadResult>`,
          ),
        );
      vi.stubGlobal("fetch", fetch);
      const storage = new R2MediaStorageAdapter(config);
      expect(
        await storage.createMultipartUpload({
          key,
          contentType: input.contentType,
          ...(bound ? { uploadBinding: binding } : {}),
        }),
      ).toEqual({ uploadId: "fixture-upload" });
      const [url, init] = fetch.mock.calls[0]!;
      const headers = init.headers as Record<string, string>;
      expect(init.method).toBe("POST");
      expect(new URL(url).searchParams.has("uploads")).toBe(true);
      expect(verifies(new URL(url), "POST", headers)).toBe(true);
      for (const [name, value] of Object.entries(bindingHeaders)) {
        if (bound) {
          expect(headers[name]).toBe(value);
          expect(headers.authorization).toContain(name);
          expect(verifies(new URL(url), "POST", { ...headers, [name]: "tampered" })).toBe(false);
        } else {
          expect(headers[name]).toBeUndefined();
          expect(headers.authorization).not.toContain(name);
        }
      }
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("rejects invalid binding before either signing or creating", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const storage = new R2MediaStorageAdapter(config);
    const uploadBinding = { ...binding, sessionId: "invalid" };
    await expect(storage.authorizeSinglePut({ ...input, uploadBinding })).rejects.toThrow(
      "identity or object metadata is invalid",
    );
    await expect(
      storage.createMultipartUpload({ key, contentType: input.contentType, uploadBinding }),
    ).rejects.toThrow("identity or object metadata is invalid");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not allow supplied metadata to replace signer-owned headers or inject headers", () => {
    const signer = new R2SigV4(config);
    for (const metadataHeaders of [
      { host: "evil.test" },
      { "X-Amz-Meta-Owner": "value" },
      { "x-amz-meta-owner": "value\r\nx-other: injected" },
    ]) {
      expect(() => signer.presign({ ...input, method: "PUT", metadataHeaders })).toThrow(
        "Invalid R2 metadata signing header",
      );
    }
  });
});
