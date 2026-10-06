import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hashUploadFileIdentity } from "@ayin/types";
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

async function requiredFixture(
  options: {
    corrupt?: boolean;
    missingDigest?: boolean;
    rejectVerification?: boolean;
    finalize?: boolean;
    corruptCanonical?: boolean;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "ayin-required-worker-"));
  directories.push(directory);
  vi.stubEnv("MEDIA_PROCESSING_WORKDIR", directory);
  vi.stubEnv("FFMPEG_PATH", join(directory, "must-not-run-ffmpeg"));
  const bytes = Buffer.alloc(4 * 1024 * 1024 + 17, 29);
  const identity = await hashUploadFileIdentity(
    (async function* () {
      yield bytes;
    })(),
    bytes.length,
  );
  const downloaded = Buffer.from(bytes);
  if (options.corrupt) downloaded[bytes.length - 1] = downloaded[bytes.length - 1]! ^ 1;
  const sourceKey = "source-g1.mp4",
    outputKey = "canonical-g2.mp4";
  const objects = new Map([
    [sourceKey, downloaded],
    [outputKey, Buffer.from("unproven existing canonical")],
  ]);
  const storage = {
    headObject: vi.fn(async (key: string) => {
      const b = objects.get(key);
      if (!b) throw new Error("missing");
      return { sizeBytes: b.length, contentType: "video/mp4" };
    }),
    downloadToFile: vi.fn(async (key: string, path: string) => {
      const b = Buffer.from(objects.get(key)!);
      if (options.corruptCanonical && key === outputKey) b[b.length - 1] = b[b.length - 1]! ^ 1;
      await writeFile(path, b);
    }),
    uploadFile: vi.fn(async (key: string, path: string) => {
      objects.set(key, await readFile(path));
    }),
    deleteObject: vi.fn(),
  };
  const queue = { heartbeat: vi.fn().mockResolvedValue(true), requeueAfterFailure: vi.fn() };
  const lifecycle = {
    setOwnedStage: vi.fn().mockResolvedValue(true),
    recordInputVerification: vi.fn().mockResolvedValue(!options.rejectVerification),
    recordCanonicalVerification: vi.fn().mockResolvedValue(true),
    finalizeReady: vi
      .fn()
      .mockResolvedValue(options.finalize === false ? null : { job: { status: "READY" } }),
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
  const probe = vi
    .spyOn(subject as unknown as { probe(path: string): Promise<MediaProbeMetadata> }, "probe")
    .mockResolvedValue({
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
  const job = {
    id: "required",
    videoId: "video",
    sourceMimeType: "video/mp4",
    sourceSizeBytes: BigInt(bytes.length),
    stagingKey: `${sourceKey}#adaptive-backfill-g2`,
    inputR2ObjectKey: sourceKey,
    outputR2ObjectKey: outputKey,
    inputIntegrityVersion: 1,
    attempt: 1,
    currentOutputAttemptId: "66666666-6666-4666-8666-666666666666",
    inputIntegrityOwnerlessPlatform: false,
    inputIntegritySessionId: "session",
    inputIntegritySourceAssetId: "source",
    inputIntegrityAccountId: "account",
    inputIntegrityAlgorithm: identity.algorithm,
    inputIntegrityDigest: options.missingDigest ? null : identity.rootSha256,
    inputIntegrityParentJobId: "producer",
  } as MediaProcessingJob;
  return {
    subject,
    job,
    queue,
    lifecycle,
    adaptive,
    storage,
    probe,
    bytes,
    objects,
    identity,
    sourceKey,
    outputKey,
  };
}
it("regenerates unproven canonical, hashes source and remote canonical, and preserves durable source until cleanup", async () => {
  const f = await requiredFixture();
  await f.subject.process(f.job, "claim");
  expect(f.queue.requeueAfterFailure).not.toHaveBeenCalled();
  expect(f.storage.downloadToFile.mock.calls.map(([key]) => key)).toEqual([
    f.sourceKey,
    f.outputKey,
  ]);
  expect(f.objects.get(f.outputKey)?.equals(f.bytes)).toBe(true);
  expect(f.lifecycle.recordInputVerification).toHaveBeenCalledWith({
    jobId: f.job.id,
    workerId: "claim",
    attempt: 1,
    outputAttemptId: "66666666-6666-4666-8666-666666666666",
    identity: f.identity,
  });
  expect(f.lifecycle.recordCanonicalVerification).toHaveBeenCalledOnce();
  expect(f.storage.downloadToFile).toHaveBeenCalledWith(
    f.sourceKey,
    expect.any(String),
    expect.objectContaining({ exactSizeBytes: f.bytes.length, signal: expect.anything() }),
  );
  expect(f.storage.downloadToFile).toHaveBeenCalledWith(
    f.outputKey,
    expect.any(String),
    expect.objectContaining({ exactSizeBytes: f.bytes.length, signal: expect.anything() }),
  );
  expect(f.lifecycle.finalizeReady).toHaveBeenCalledOnce();
  expect(f.storage.deleteObject).not.toHaveBeenCalled();
});
for (const options of [
  { corrupt: true },
  { missingDigest: true },
  { rejectVerification: true },
  { corruptCanonical: true },
])
  it(`prevents READY and adaptive reuse: ${JSON.stringify(options)}`, async () => {
    const f = await requiredFixture(options);
    await f.subject.process(f.job, "claim");
    expect(f.lifecycle.finalizeReady).not.toHaveBeenCalled();
    expect(f.adaptive.process).not.toHaveBeenCalled();
    expect(f.storage.deleteObject).not.toHaveBeenCalled();
    expect(f.queue.requeueAfterFailure).toHaveBeenCalledOnce();
    if (!options.corruptCanonical) expect(f.probe).not.toHaveBeenCalled();
  });
it("keeps retained source when a crash/fence loss prevents READY, then verifies it again on retry", async () => {
  const f = await requiredFixture({ finalize: false });
  await f.subject.process(f.job, "claim-1");
  expect(f.objects.has(f.sourceKey)).toBe(true);
  expect(f.storage.deleteObject).not.toHaveBeenCalled();
  f.lifecycle.finalizeReady.mockResolvedValue({ job: { status: "READY" } });
  await f.subject.process(f.job, "claim-2");
  expect(f.lifecycle.recordInputVerification).toHaveBeenCalledTimes(2);
  expect(f.storage.uploadFile).toHaveBeenCalledTimes(2);
  expect(f.lifecycle.finalizeReady).toHaveBeenCalledTimes(2);
  expect(f.objects.has(f.sourceKey)).toBe(true);
});
