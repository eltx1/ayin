import { describe, expect, it } from "vitest";
import {
  parseUploadCompletion,
  parseUploadPartUrl,
  parseUploadSession,
  parseResumedParts,
  validateUploadUrl,
} from "./upload-session";
const id = "11111111-1111-4111-8111-111111111111";
const multipart = {
  assetId: id,
  sessionToken: "token",
  mode: "multipart" as const,
  partSizeBytes: 5,
  partCount: 3,
};
describe("upload response contracts", () => {
  it("bounds part count and requires exact file segmentation", () => {
    expect(parseUploadSession(multipart, 12)).toEqual(multipart);
    for (const value of [
      { ...multipart, partCount: 2 },
      { ...multipart, partCount: 10001 },
      { ...multipart, partSizeBytes: 0 },
      { ...multipart, assetId: "other" },
      { ...multipart, sessionToken: "" },
    ])
      expect(() => parseUploadSession(value, 12)).toThrow();
  });
  it("accepts HTTPS storage and only the exact configured loopback HTTP origin", () => {
    expect(validateUploadUrl("https://storage.example.test/object?signature=abc")).toContain(
      "signature=abc",
    );
    expect(validateUploadUrl("http://localhost:3001/media/e2e-put")).toContain("e2e-put");
    for (const url of [
      "http://storage.example.test/object",
      "http://localhost:9999/put",
      "https://user:pass@storage.example.test/object",
      "javascript:alert(1)",
      "https://storage.example.test/object#fragment",
    ])
      expect(() => validateUploadUrl(url)).toThrow();
  });
  it("rejects malformed part authorizations before sending bytes", () => {
    for (const value of [null, {}, { url: "http://untrusted.example/put" }])
      expect(() => parseUploadPartUrl(value)).toThrow();
  });
  it("rejects duplicate, oversized, foreign or incorrectly sized resumed parts", () => {
    const last = { partNumber: 3, sizeBytes: 2, etag: '"last"' };
    expect(parseResumedParts({ parts: [last] }, multipart, 12)).toEqual([last]);
    for (const parts of [
      [last, last],
      [{ ...last, partNumber: 4 }],
      [{ ...last, sizeBytes: 5 }],
      [{ ...last, etag: "" }],
    ])
      expect(() => parseResumedParts({ parts }, multipart, 12)).toThrow();
  });
  it("only acknowledges completion for the prepared asset", () => {
    expect(parseUploadCompletion({ assetId: id, status: "UPLOADED", secret: "omit" }, id)).toEqual({
      assetId: id,
      status: "UPLOADED",
    });
    for (const value of [
      null,
      { assetId: id, status: "PENDING" },
      { assetId: "22222222-2222-4222-8222-222222222222", status: "UPLOADED" },
    ])
      expect(() => parseUploadCompletion(value, id)).toThrow();
  });
});
