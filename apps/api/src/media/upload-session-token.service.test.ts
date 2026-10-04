import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMediaStorageConfig } from "./media-storage.config.js";
import {
  MAX_UPLOAD_SESSION_TOKEN_LENGTH,
  UploadSessionTokenService,
  type UploadSessionPayload,
} from "./upload-session-token.service.js";
const secret = "isolated-upload-token-fixture-secret-more-than32";
const service = new UploadSessionTokenService(
  loadMediaStorageConfig({ APP_ENV: "test", UPLOAD_SESSION_SECRET: secret }),
);
const fixture = (): UploadSessionPayload => ({
  version: 1,
  accountId: "11111111-1111-4111-8111-111111111111",
  channelId: "22222222-2222-4222-8222-222222222222",
  assetId: "33333333-3333-4333-8333-333333333333",
  objectKey: "channels/fixture/media/fixture/source.mp4",
  uploadId: null,
  mode: "single",
  mimeType: "video/mp4",
  sizeBytes: 1024,
  partSizeBytes: 5 * 1024 * 1024,
  expiresAtMs: Date.now() + 60000,
});
function raw(bytes: Uint8Array | string): string {
  const encoded = typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("base64url");
  return encoded + "." + createHmac("sha256", secret).update(encoded).digest("base64url");
}
const signRaw = (value: unknown) => raw(Buffer.from(JSON.stringify(value)));
afterEach(() => vi.useRealTimers());
describe("bounded exact upload token protocol", () => {
  it("preserves actual single and multipart V1 tokens with explicit administrator provenance", () => {
    for (const payload of [
      fixture(),
      {
        ...fixture(),
        mode: "multipart" as const,
        uploadId: "actual-multipart-id",
        adminOverride: true,
      },
    ])
      expect(service.verify(service.sign(payload))).toEqual(payload);
  });
  it("rejects extra segments that previously survived valid signature verification", () => {
    const token = service.sign(fixture());
    for (const value of [token + ".", token + ".ignored", "." + token, token + ".x.y"])
      expect(() => service.verify(value)).toThrow();
  });
  it("rejects empty, oversized, padded and non-base64url inputs before accepting data", () => {
    for (const token of [
      "",
      ".",
      "x",
      "x".repeat(MAX_UPLOAD_SESSION_TOKEN_LENGTH + 1),
      " " + service.sign(fixture()),
      service.sign(fixture()) + "\n",
      raw("YWJj="),
    ])
      expect(() => service.verify(token)).toThrow();
  });
  it("rejects modified payload or signature and wrong-key authenticators", () => {
    const token = service.sign(fixture()),
      [encoded, signature] = token.split(".");
    expect(() => service.verify("A" + encoded + "." + signature)).toThrow();
    expect(() => service.verify(encoded + "." + "x".repeat(43))).toThrow();
    expect(() =>
      service.verify(
        encoded + "." + createHmac("sha256", "wrong-key").update(encoded!).digest("base64url"),
      ),
    ).toThrow();
  });
  it("rejects even validly authenticated malformed UTF-8, JSON, arrays and unsupported versions", () => {
    for (const token of [
      raw(new Uint8Array([0xff])),
      raw(Buffer.from("{")),
      signRaw([]),
      signRaw(null),
      signRaw({ ...fixture(), version: 2 }),
    ])
      expect(() => service.verify(token)).toThrow();
  });
  it("rejects authentic schema additions instead of silently discarding authority fields", () => {
    const value = { ...fixture(), futureAuthority: true };
    expect(() => service.verify(signRaw(value))).toThrow();
    expect(() => service.sign(value as UploadSessionPayload)).toThrow();
  });
  it("rejects unsafe integer quantities and invalid UUID/type fields on both signing and verification", () => {
    for (const value of [
      { ...fixture(), sizeBytes: Number.MAX_SAFE_INTEGER + 1 },
      { ...fixture(), partSizeBytes: 1.5 },
      { ...fixture(), expiresAtMs: Number.MAX_SAFE_INTEGER + 1 },
      { ...fixture(), sizeBytes: 0 },
      { ...fixture(), accountId: "not-an-account" },
      { ...fixture(), mimeType: "text/html" },
      { ...fixture(), adminOverride: "true" },
    ]) {
      expect(() => service.verify(signRaw(value))).toThrow();
      expect(() => service.sign(value as UploadSessionPayload)).toThrow();
    }
  });
  it("binds single/multipart mode to the presence of its original multipart ID", () => {
    for (const value of [
      { ...fixture(), uploadId: "inconsistent" },
      { ...fixture(), mode: "multipart", uploadId: null },
      { ...fixture(), mode: "multipart", uploadId: "x".repeat(1025) },
    ])
      expect(() => service.verify(signRaw(value))).toThrow();
  });
  it("checks expiry against actual verification time including the exact boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
    const payload = fixture(),
      token = service.sign(payload);
    vi.setSystemTime(payload.expiresAtMs - 1);
    expect(service.verify(token)).toEqual(payload);
    vi.setSystemTime(payload.expiresAtMs);
    expect(() => service.verify(token)).toThrow("expired");
  });
});
