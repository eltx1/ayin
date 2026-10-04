import { describe, expect, it } from "vitest";
import { E2eMediaStorageAdapter } from "./e2e-media-storage.adapter.js";

describe("explicit E2E multipart provider metadata", () => {
  it("HEAD exposes the sum of simulated parts and created MIME, independently of desired asset size", async () => {
    const storage = new E2eMediaStorageAdapter();
    const upload = await storage.createMultipartUpload({
      key: "source-a",
      contentType: "video/webm",
    });
    await storage.completeMultipartUpload({
      key: "source-a",
      uploadId: upload.uploadId,
      parts: [
        { partNumber: 1, etag: "e2e-bytes-8388608" },
        { partNumber: 2, etag: "e2e-bytes-1" },
      ],
    });
    expect(await storage.headObject("source-a")).toEqual({
      sizeBytes: 8388609,
      contentType: "video/webm",
      etag: '"e2e-complete"',
    });
    expect((await storage.headObject("other-source")).sizeBytes).toBe(1024);
  });
  it("wrong key and nonexistent multipart cannot manufacture completed metadata", async () => {
    const storage = new E2eMediaStorageAdapter();
    const upload = await storage.createMultipartUpload({ key: "source", contentType: "video/mp4" });
    const parts = [{ partNumber: 1, etag: "e2e-bytes-7" }];
    await expect(
      storage.completeMultipartUpload({ key: "other", uploadId: upload.uploadId, parts }),
    ).rejects.toThrow("Unknown");
    await expect(
      storage.completeMultipartUpload({ key: "source", uploadId: "missing", parts }),
    ).rejects.toThrow("Unknown");
    expect((await storage.headObject("other")).sizeBytes).toBe(1024);
  });
  it("rejects missing, malformed and unsafe simulated bytes without changing metadata", async () => {
    const storage = new E2eMediaStorageAdapter();
    const upload = await storage.createMultipartUpload({ key: "source", contentType: "video/mp4" });
    for (const etag of ["legacy-etag", "e2e-bytes-0", "e2e-bytes-01", "e2e-bytes-9007199254740992"])
      await expect(
        storage.completeMultipartUpload({
          key: "source",
          uploadId: upload.uploadId,
          parts: [{ partNumber: 1, etag }],
        }),
      ).rejects.toThrow("explicit");
    await expect(
      storage.completeMultipartUpload({ key: "source", uploadId: upload.uploadId, parts: [] }),
    ).rejects.toThrow("Unknown");
    expect((await storage.headObject("source")).sizeBytes).toBe(1024);
  });
  it("abort retires only its matching simulated upload; completion cannot replay", async () => {
    const storage = new E2eMediaStorageAdapter();
    const upload = await storage.createMultipartUpload({ key: "source", contentType: "video/mp4" });
    await storage.abortMultipartUpload({ key: "other", uploadId: upload.uploadId });
    const input = {
      key: "source",
      uploadId: upload.uploadId,
      parts: [{ partNumber: 1, etag: "e2e-bytes-12" }],
    };
    await storage.completeMultipartUpload(input);
    await expect(storage.completeMultipartUpload(input)).rejects.toThrow("Unknown");
    const second = await storage.createMultipartUpload({ key: "second", contentType: "video/mp4" });
    await storage.abortMultipartUpload({ key: "second", uploadId: second.uploadId });
    await expect(
      storage.completeMultipartUpload({ ...input, key: "second", uploadId: second.uploadId }),
    ).rejects.toThrow("Unknown");
  });
});
