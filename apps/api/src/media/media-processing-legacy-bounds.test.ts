import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MediaProcessingJob } from "@ayin/db";
import { afterEach, expect, it, vi } from "vitest";

import { MediaProcessingExecutorService } from "./media-processing-executor.service.js";
import { MediaProcessingStorageService } from "./media-processing-storage.service.js";
import { loadMediaStorageConfig } from "./media-storage.config.js";
import type { MediaProbeMetadata } from "./media-probe.js";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it.each(["source", "recovered canonical"] as const)(
  "bounds actual legacy %s transfer before probe/transcode and removes partial scratch",
  async (kind) => {
    const directory = await mkdtemp(join(tmpdir(), "ayin-legacy-stream-bound-"));
    directories.push(directory);
    vi.stubEnv("MEDIA_PROCESSING_WORKDIR", directory);
    vi.stubEnv("FFMPEG_PATH", join(directory, "must-not-run-ffmpeg"));
    const cancel = vi.fn();
    let pulls = 0;
    const chunks = [
      new Uint8Array(4),
      new Uint8Array(4),
      new Uint8Array(100_000),
      ...Array.from({ length: 20 }, () => new Uint8Array(1000)),
    ];
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const bytes = chunks[pulls++];
          if (bytes) controller.enqueue(bytes);
          else controller.close();
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL | string, request: RequestInit) => {
        if (request.method === "HEAD")
          return kind === "source"
            ? new Response(null, { status: 404 })
            : new Response(null, {
                headers: { "content-length": "8", "content-type": "video/mp4" },
              });
        // A chunked source has no trustworthy Content-Length. Exercise the
        // real downloader, not a spy that simply asserts its options object.
        return new Response(body);
      }),
    );
    const storage = new MediaProcessingStorageService(
      { available: true, kind: "r2" } as never,
      loadMediaStorageConfig({
        APP_ENV: "test",
        R2_ACCOUNT_ID: "controlled",
        R2_BUCKET: "controlled",
        R2_ACCESS_KEY_ID: "controlled",
        R2_SECRET_ACCESS_KEY: "controlled",
        UPLOAD_SESSION_SECRET: "controlled-stream-bound-secret-at-least-32",
      }),
    );
    const queue = { heartbeat: vi.fn(), requeueAfterFailure: vi.fn() };
    const lifecycle = {
      setOwnedStage: vi.fn().mockResolvedValue(true),
      finalizeReady: vi.fn(),
    };
    const executor = new MediaProcessingExecutorService(
      queue as never,
      lifecycle as never,
      storage,
      { process: vi.fn() } as never,
      { ensureForCanonical: vi.fn() } as never,
      { get: vi.fn() } as never,
    );
    const probe = vi
      .spyOn(executor as unknown as { probe(path: string): Promise<MediaProbeMetadata> }, "probe")
      .mockRejectedValue(new Error("Unbounded source reached the media probe"));
    await executor.process(
      {
        id: "controlled-legacy-bound",
        videoId: "controlled-video",
        sourceMimeType: "video/mp4",
        sourceSizeBytes: 8n,
        stagingKey: "source.mp4",
        inputR2ObjectKey: "source.mp4",
        outputR2ObjectKey: "canonical.mp4",
      } as MediaProcessingJob,
      "controlled-lease",
    );
    expect(probe).not.toHaveBeenCalled();
    expect(lifecycle.finalizeReady).not.toHaveBeenCalled();
    expect(queue.requeueAfterFailure).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    // Node's Web-stream adapter may prefetch a bounded chunk. It must cancel
    // instead of consuming the remainder after the transform detects overflow.
    expect(pulls).toBeLessThan(chunks.length);
    expect(await readdir(directory)).toEqual([]);
  },
);
