import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { MediaStorageAdapter } from "./media-storage.adapter.js";
import { loadMediaStorageConfig } from "./media-storage.config.js";
import { R2HttpError } from "./r2-sigv4.js";
import { MediaProcessingStorageService } from "./media-processing-storage.service.js";
import type { MediaOutputWriteJournalService } from "./media-output-write-journal.js";

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
  function metadataService(journal?: MediaOutputWriteJournalService, authorizeSinglePut = vi.fn()) {
    return new MediaProcessingStorageService(
      createR2Adapter(authorizeSinglePut),
      loadMediaStorageConfig({
        APP_ENV: "test",
        R2_ACCOUNT_ID: "account123",
        R2_BUCKET: "ayin-media",
        R2_ACCESS_KEY_ID: "access-key",
        R2_SECRET_ACCESS_KEY: "secret-key",
        UPLOAD_SESSION_SECRET: "media-processing-test-secret-at-least-32-characters",
      } as NodeJS.ProcessEnv),
      journal,
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

  it.each(["canonical.mp4", "hls/master.m3u8", "hls/360p/segment-000001.ts", "thumbnail.jpg"])(
    "rejects an unjournaled immutable-attempt PUT for %s",
    async (suffix) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        metadataService().uploadFile(
          `channels/channel/videos/video/playback/g1/attempts/attempt/${suffix}`,
          "/missing-file",
        ),
      ).rejects.toThrow(/write-ahead journal/);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    "success",
    "timeout",
    "failure",
    "unexpected 2xx",
    "ack database loss",
    "dispatch database loss",
  ])(
    "records exact dispatch before provider I/O and preserves conservative outcome on %s",
    async (outcome) => {
      const directory = await mkdtemp(join(tmpdir(), "ayin-output-journal-"));
      temporaryDirectories.push(directory);
      const file = join(directory, "output.mp4");
      await writeFile(file, "output-bytes");
      const trace: string[] = [];
      const receipt = { id: "dispatch" };
      const journal = {
        dispatch: vi.fn(async () => {
          trace.push("dispatch-commit");
          if (outcome === "dispatch database loss") throw new Error("dispatch database loss");
          return receipt;
        }),
        acknowledge: vi.fn(async () => {
          trace.push("acknowledge");
          if (outcome === "ack database loss") throw new Error("ack database loss");
        }),
        markUnknown: vi.fn(async () => {
          trace.push("unknown");
        }),
      };
      const authorize = vi.fn(async () => {
        trace.push("authorize");
        return { url: "https://example.invalid/upload", expiresAt: new Date() };
      });
      const fetchMock = vi.fn(async () => {
        trace.push("put");
        if (outcome === "timeout") throw new Error("R2 upload timed out");
        return new Response(null, {
          status: outcome === "failure" ? 503 : outcome === "unexpected 2xx" ? 202 : 200,
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      const service = metadataService(journal as never, authorize);
      const context = { jobId: "job", workerId: "claim", attempt: 1, outputAttemptId: "attempt" };
      const work = service.uploadFile("key", file, "video/mp4", context);
      if (outcome === "success") await expect(work).resolves.toBeUndefined();
      else await expect(work).rejects.toThrow();
      expect(journal.dispatch).toHaveBeenCalledWith({
        ...context,
        objectKey: "key",
        expectedSizeBytes: 12,
        contentType: "video/mp4",
      });
      expect(trace[0]).toBe("dispatch-commit");
      if (outcome === "dispatch database loss") {
        expect(authorize).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(journal.markUnknown).not.toHaveBeenCalled();
      } else {
        expect(trace.slice(0, 3)).toEqual(["dispatch-commit", "authorize", "put"]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        if (outcome === "success") {
          expect(journal.acknowledge).toHaveBeenCalledWith(receipt);
          expect(journal.markUnknown).not.toHaveBeenCalled();
        } else expect(journal.markUnknown).toHaveBeenCalledWith(receipt);
        if (["timeout", "failure", "unexpected 2xx"].includes(outcome))
          expect(journal.acknowledge).not.toHaveBeenCalled();
      }
    },
  );
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
