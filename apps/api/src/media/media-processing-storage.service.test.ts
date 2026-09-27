import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { MediaStorageAdapter } from "./media-storage.adapter.js";
import { loadMediaStorageConfig } from "./media-storage.config.js";
import { R2HttpError } from "./r2-sigv4.js";
import { MediaProcessingStorageService } from "./media-processing-storage.service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("MediaProcessingStorageService", () => {
  function metadataService() {
    return new MediaProcessingStorageService(
      createR2Adapter(vi.fn()),
      loadMediaStorageConfig({
        APP_ENV: "test",
        R2_ACCOUNT_ID: "account123",
        R2_BUCKET: "ayin-media",
        R2_ACCESS_KEY_ID: "access-key",
        R2_SECRET_ACCESS_KEY: "secret-key",
        UPLOAD_SESSION_SECRET: "media-processing-test-secret-at-least-32-characters",
      } as NodeJS.ProcessEnv),
    );
  }
  it.each([404, 403, 429, 500, 503])("preserves typed HEAD status %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
    const pending = metadataService().headObject("master.m3u8");
    await expect(pending).rejects.toBeInstanceOf(R2HttpError);
    await expect(pending).rejects.toMatchObject({ status, method: "HEAD" });
  });
  it.each([null, "invalid", "-1", "1.2", "9007199254740992"])(
    "rejects uncertain size metadata %s",
    async (length) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(null, {
            status: 200,
            headers: length === null ? {} : { "content-length": length },
          }),
        ),
      );
      await expect(metadataService().headObject("master.m3u8")).rejects.toThrow(
        "invalid object size",
      );
    },
  );
  it("preserves valid empty and nonempty object sizes", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { headers: { "content-length": "0" } }))
        .mockResolvedValueOnce(new Response(null, { headers: { "content-length": "128" } })),
    );
    expect((await metadataService().headObject("empty")).sizeBytes).toBe(0);
    expect((await metadataService().headObject("manifest")).sizeBytes).toBe(128);
  });

  it("sends Content-Length when streaming a canonical file to an R2 presigned PUT", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ayin-media-upload-test-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "canonical.mp4");
    const payload = Buffer.from("canonical-video-payload");
    await writeFile(filePath, payload);

    const authorizeSinglePut = vi.fn().mockResolvedValue({
      url: "https://example.invalid/canonical.mp4?signed=1",
      expiresAt: new Date(Date.now() + 300_000),
    });
    const storage = createR2Adapter(authorizeSinglePut);
    const config = loadMediaStorageConfig({
      APP_ENV: "test",
      R2_ACCOUNT_ID: "account123",
      R2_BUCKET: "ayin-media",
      R2_ACCESS_KEY_ID: "access-key",
      R2_SECRET_ACCESS_KEY: "secret-key",
      UPLOAD_SESSION_SECRET: "media-processing-test-secret-at-least-32-characters",
    } as NodeJS.ProcessEnv);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const service = new MediaProcessingStorageService(storage, config);
    await service.uploadFile("canonical/video.mp4", filePath, "video/mp4");

    expect(authorizeSinglePut).toHaveBeenCalledWith(
      expect.objectContaining({ key: "canonical/video.mp4", contentType: "video/mp4" }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.method).toBe("PUT");
    expect(request.headers).toEqual(
      expect.objectContaining({
        "content-type": "video/mp4",
        "content-length": String(payload.byteLength),
      }),
    );
  });

  it("rejects an empty canonical file before authorizing an R2 upload", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ayin-media-upload-test-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "canonical.mp4");
    await writeFile(filePath, Buffer.alloc(0));

    const authorizeSinglePut = vi.fn();
    const storage = createR2Adapter(authorizeSinglePut);
    const config = loadMediaStorageConfig({
      APP_ENV: "test",
      R2_ACCOUNT_ID: "account123",
      R2_BUCKET: "ayin-media",
      R2_ACCESS_KEY_ID: "access-key",
      R2_SECRET_ACCESS_KEY: "secret-key",
      UPLOAD_SESSION_SECRET: "media-processing-test-secret-at-least-32-characters",
    } as NodeJS.ProcessEnv);

    const service = new MediaProcessingStorageService(storage, config);

    await expect(service.uploadFile("canonical/video.mp4", filePath)).rejects.toThrow(
      /empty or unreadable/,
    );
    expect(authorizeSinglePut).not.toHaveBeenCalled();
  });
});

function createR2Adapter(authorizeSinglePut: ReturnType<typeof vi.fn>): MediaStorageAdapter {
  return {
    kind: "r2",
    available: true,
    createMultipartUpload: vi.fn(),
    authorizeMultipartPart: vi.fn(),
    authorizeSinglePut,
    listParts: vi.fn(),
    completeMultipartUpload: vi.fn(),
    abortMultipartUpload: vi.fn(),
    headObject: vi.fn(),
    deleteObject: vi.fn(),
    listMultipartUploads: vi.fn(),
  } as unknown as MediaStorageAdapter;
}
