import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MediaProcessingJob } from "@ayin/db";
import { afterEach, expect, it, vi } from "vitest";

import { MediaProcessingExecutorService } from "./media-processing-executor.service.js";
import type { MediaProbeMetadata } from "./media-probe.js";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("copies validated backfill MP4 into an independent generation without transcoding or deleting the source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ayin-backfill-copy-"));
  directories.push(directory);
  vi.stubEnv("MEDIA_PROCESSING_WORKDIR", directory);
  vi.stubEnv("FFMPEG_PATH", join(directory, "must-not-run-ffmpeg"));
  const payload = Buffer.from("validated-mp4-test-payload");
  const sourceKey = "video/playback/g1.mp4";
  const outputKey = "video/playback/g2.mp4";
  const objects = new Map([[sourceKey, payload]]);
  const storage = {
    headObject: vi.fn(async (key: string) => {
      const content = objects.get(key);
      if (!content) throw new Error("not found");
      return { sizeBytes: content.length, contentType: "video/mp4" };
    }),
    downloadToFile: vi.fn(async (key: string, path: string) => {
      await writeFile(path, objects.get(key)!);
    }),
    uploadFile: vi.fn(async (key: string, path: string) => {
      objects.set(key, await readFile(path));
    }),
    deleteObject: vi.fn(),
  };
  const queue = { heartbeat: vi.fn().mockResolvedValue(true), requeueAfterFailure: vi.fn() };
  const lifecycle = {
    setOwnedStage: vi.fn().mockResolvedValue(true),
    finalizeReady: vi.fn().mockResolvedValue({ job: { status: "READY" } }),
  };
  const adaptive = { process: vi.fn() };
  const subject = new MediaProcessingExecutorService(
    queue as never,
    lifecycle as never,
    storage as never,
    adaptive as never,
    { ensureForCanonical: vi.fn().mockResolvedValue({ created: false }) } as never,
    { get: vi.fn() } as never,
  );
  vi.spyOn(
    subject as unknown as { probe(path: string): Promise<MediaProbeMetadata> },
    "probe",
  ).mockResolvedValue({
    durationMs: 1000,
    width: 640,
    height: 360,
    encodedWidth: 640,
    encodedHeight: 360,
    rotationDegrees: 0,
    videoCodec: "h264",
    audioCodec: "aac",
    hasAudio: true,
  });
  await subject.process(
    {
      id: "backfill-copy",
      videoId: "video",
      sourceMimeType: "video/mp4",
      stagingKey: `${sourceKey}#adaptive-backfill-g2`,
      inputR2ObjectKey: sourceKey,
      outputR2ObjectKey: outputKey,
    } as MediaProcessingJob,
    "worker:claim",
  );
  expect(queue.requeueAfterFailure).not.toHaveBeenCalled();
  expect(objects.get(outputKey)).toEqual(payload);
  expect(objects.get(sourceKey)).toEqual(payload);
  expect(storage.deleteObject).not.toHaveBeenCalled();
  expect(adaptive.process).toHaveBeenCalledOnce();
  expect(lifecycle.finalizeReady).toHaveBeenCalledWith(
    expect.objectContaining({
      metadata: { sizeBytes: payload.length, durationMs: 1000, width: 640, height: 360 },
    }),
  );
});
