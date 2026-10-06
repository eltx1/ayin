import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import type * as FileSystemPromises from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { MediaProcessingStorageService } from "./media-processing-storage.service.js";
import { loadMediaStorageConfig } from "./media-storage.config.js";

const { writes } = vi.hoisted(() => ({ writes: [] as Array<{ bytesWritten: number }> }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystemPromises>();
  return {
    ...actual,
    open: vi.fn(async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args);
      const create = file.createWriteStream.bind(file);
      file.createWriteStream = (...options: Parameters<typeof file.createWriteStream>) => {
        const stream = create(...options);
        writes.push(stream);
        return stream;
      };
      return file;
    }),
  };
});
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  writes.splice(0);
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
function service() {
  return new MediaProcessingStorageService(
    { kind: "r2", available: true } as never,
    loadMediaStorageConfig({
      APP_ENV: "test",
      R2_ACCOUNT_ID: "test",
      R2_BUCKET: "test",
      R2_ACCESS_KEY_ID: "test",
      R2_SECRET_ACCESS_KEY: "test",
      UPLOAD_SESSION_SECRET: "bounded-download-test-secret-only-more-than-32",
    } as NodeJS.ProcessEnv),
  );
}
async function destination() {
  const dir = await mkdtemp(join(tmpdir(), "ayin-download-cap-"));
  directories.push(dir);
  return join(dir, "input.mp4");
}
function response(chunks: Uint8Array[], length?: string, truncate = false) {
  let index = 0;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]!);
      else if (truncate) controller.error(new Error("remote connection truncated"));
      else controller.close();
    },
    cancel,
  });
  return {
    result: new Response(body, {
      headers: length === undefined ? {} : { "content-length": length },
    }),
    cancel,
  };
}
it("writes exact bytes with or without a Content-Length header", async () => {
  for (const length of [undefined, "6"]) {
    const path = await destination();
    const r = response([Buffer.from("abc"), Buffer.from("def")], length);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(r.result));
    await service().downloadToFile("source", path, { exactSizeBytes: 6 });
    expect(await readFile(path, "utf8")).toBe("abcdef");
  }
});
it("rejects oversized Content-Length before opening scratch", async () => {
  const path = await destination();
  const r = response([Buffer.alloc(20)], "20");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(r.result));
  await expect(service().downloadToFile("source", path, { exactSizeBytes: 8 })).rejects.toThrow(
    /size|bytes/i,
  );
  expect(writes).toHaveLength(0);
  await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  expect(r.cancel).toHaveBeenCalled();
});
for (const length of [undefined, "8"])
  it(`enforces streamed oversize despite ${length ?? "missing"} header and never writes beyond cap`, async () => {
    const path = await destination();
    const r = response([Buffer.alloc(4, 1), Buffer.alloc(4, 2), Buffer.alloc(100000, 3)], length);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(r.result));
    await expect(service().downloadToFile("source", path, { exactSizeBytes: 8 })).rejects.toThrow(
      /size|bytes/i,
    );
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((stream) => stream.bytesWritten <= 8)).toBe(true);
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });
it.each([false, true])(
  "removes short/truncated partial scratch (truncated=%s)",
  async (truncated) => {
    const path = await destination();
    const r = response([Buffer.alloc(4, 1)], "8", truncated);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(r.result));
    await expect(service().downloadToFile("source", path, { exactSizeBytes: 8 })).rejects.toThrow();
    expect(writes.every((stream) => stream.bytesWritten <= 8)).toBe(true);
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
it("cancels a stalled source, closes the reader and removes partial scratch", async () => {
  const path = await destination();
  const cancelled = vi.fn();
  const controller = new AbortController();
  const body = new ReadableStream<Uint8Array>({
    start(stream) {
      stream.enqueue(Buffer.alloc(4));
    },
    cancel: cancelled,
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
  const result = service()
    .downloadToFile("source", path, { exactSizeBytes: 8, signal: controller.signal })
    .then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
  await vi.waitFor(async () => {
    expect((await stat(path)).size).toBe(4);
  });
  controller.abort(new Error("claim cancelled"));
  expect(await result).toHaveProperty("error");
  expect(cancelled).toHaveBeenCalled();
  await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
});
it("does not remove a preexisting file it never owned", async () => {
  const path = await destination();
  await writeFile(path, "existing");
  const r = response([Buffer.alloc(8)], "8");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(r.result));
  await expect(service().downloadToFile("source", path, { exactSizeBytes: 8 })).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe("existing");
});
it("preserves the legacy unbounded-default download behavior", async () => {
  const path = await destination();
  const r = response([Buffer.from("legacy")]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(r.result));
  await service().downloadToFile("source", path);
  expect(await readFile(path, "utf8")).toBe("legacy");
});

it("does not request or create scratch for an already cancelled required download", async () => {
  const path = await destination();
  const controller = new AbortController();
  controller.abort(new Error("cancelled before transfer"));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    service().downloadToFile("source", path, { exactSizeBytes: 8, signal: controller.signal }),
  ).rejects.toThrow("cancelled before transfer");
  expect(fetch).not.toHaveBeenCalled();
  expect(writes).toHaveLength(0);
  await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
});
it.each([0, -1, Number.NaN, Number.MAX_SAFE_INTEGER])(
  "rejects invalid exact byte bound %s before provider I/O",
  async (exactSizeBytes) => {
    const path = await destination();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(service().downloadToFile("source", path, { exactSizeBytes })).rejects.toThrow(
      /limit/,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  },
);
