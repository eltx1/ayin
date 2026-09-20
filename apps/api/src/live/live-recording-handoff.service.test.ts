import { describe, expect, it, vi } from "vitest";

import type {
  AbandonedMultipartUpload,
  ExistingUploadPart,
  MediaStorageAdapter,
  StoredObjectMetadata,
} from "../media/media-storage.adapter.js";
import type { MediaStorageConfig } from "../media/media-storage.config.js";
import { copyLiveRecordingToStorage } from "./live-recording-handoff.service.js";

function configFixture(): MediaStorageConfig {
  return {
    mode: "r2",
    appEnv: "test",
    accountId: "account",
    bucket: "bucket",
    accessKeyId: "access",
    secretAccessKey: "secret",
    region: "auto",
    endpoint: "https://account.r2.cloudflarestorage.com",
    uploadUrlTtlSeconds: 900,
    partSizeBytes: 4,
    multipartThresholdBytes: 8,
    uploadSessionSecret: "test-secret",
  };
}

describe("live recording R2 handoff", () => {
  it("streams a Mux MP4 into verified multipart R2 storage", async () => {
    let uploadedBytes = 0;
    const uploadedParts: number[] = [];
    const storage: MediaStorageAdapter = {
      kind: "r2",
      available: true,
      createMultipartUpload: vi.fn(async () => ({ uploadId: "upload-1" })),
      authorizeMultipartPart: vi.fn(async ({ partNumber }) => ({
        url: `https://r2-upload.invalid/part/${partNumber}`,
        expiresAt: new Date(Date.now() + 60_000),
      })),
      authorizeSinglePut: vi.fn(async () => {
        throw new Error("single put not expected");
      }),
      listParts: vi.fn(async (): Promise<ExistingUploadPart[]> => []),
      completeMultipartUpload: vi.fn(async () => ({ etag: '"complete"' })),
      abortMultipartUpload: vi.fn(async () => undefined),
      headObject: vi.fn(async (): Promise<StoredObjectMetadata> => ({
        sizeBytes: uploadedBytes,
        contentType: "video/mp4",
        etag: '"complete"',
      })),
      deleteObject: vi.fn(async () => undefined),
      deletePrefix: vi.fn(async () => undefined),
      listMultipartUploads: vi.fn(async (): Promise<AbandonedMultipartUpload[]> => []),
    };
    const source = new TextEncoder().encode("0123456789");
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://stream.mux.com/playback/highest.mp4") {
        return new Response(source, {
          status: 200,
          headers: {
            "content-type": "video/mp4",
            "content-length": String(source.byteLength),
          },
        });
      }
      if (url.startsWith("https://r2-upload.invalid/part/")) {
        const partNumber = Number(url.split("/").at(-1));
        uploadedParts.push(partNumber);
        const body = init?.body as Uint8Array;
        uploadedBytes += body.byteLength;
        return new Response(null, { status: 200, headers: { etag: `"part-${partNumber}"` } });
      }
      return new Response(null, { status: 404 });
    });

    const result = await copyLiveRecordingToStorage(
      storage,
      configFixture(),
      {
        streamId: "stream-1",
        channelId: "channel-1",
        providerAssetId: "asset-1",
        downloadUrl: "https://stream.mux.com/playback/highest.mp4",
      },
      fetchImpl,
    );

    expect(result).toEqual({
      r2ObjectKey: "channels/channel-1/live/stream-1/recordings/asset-1.mp4",
      sizeBytes: 10,
    });
    expect(uploadedParts).toEqual([1, 2, 3]);
    expect(storage.completeMultipartUpload).toHaveBeenCalledWith({
      key: result.r2ObjectKey,
      uploadId: "upload-1",
      parts: [
        { partNumber: 1, etag: '"part-1"' },
        { partNumber: 2, etag: '"part-2"' },
        { partNumber: 3, etag: '"part-3"' },
      ],
    });
  });

  it("rejects recording URLs outside the fixed Mux media origin", async () => {
    const storage = { kind: "r2", available: true } as MediaStorageAdapter;
    await expect(
      copyLiveRecordingToStorage(
        storage,
        configFixture(),
        {
          streamId: "stream-1",
          channelId: "channel-1",
          providerAssetId: "asset-1",
          downloadUrl: "https://attacker.example/recording.mp4",
        },
        vi.fn(),
      ),
    ).rejects.toThrow(/outside the allowed Mux origin/);
  });
});
