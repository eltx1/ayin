import { afterEach, describe, expect, it, vi } from "vitest";
import { hashUploadBlob } from "./upload-file-identity-source";
import { identifyUploadFile } from "./upload-file-identity";

const CHUNK = 4194304;
function bytes(size: number) {
  const value = new Uint8Array(size);
  for (let i = 0; i < size; i++) value[i] = (i * 31 + (i >>> 8) + 17) & 255;
  return value;
}
describe("worker byte producer uses the frozen server vectors", () => {
  it.each([
    [3, "59b99b9bc1f6f3bf3575ad578d98e147194ab16425a47f582dea43dc5db4b498"],
    [CHUNK, "0be9826833824078f46fb4aa40cfa252c03b956e20d7415a5c41714f7b3ca7ad"],
    [2 * CHUNK + 137, "06ae86bc023892bbf7bb96b509ec4bf06c8116b57fe2711a3d9c3934d9267dcb"],
  ] as const)("hashes every byte of %i without reading the whole file", async (size, root) => {
    const file = new Blob([size === 3 ? "abc" : bytes(size)]),
      progress = vi.fn();
    const whole = vi.spyOn(file, "arrayBuffer").mockImplementation(() => {
      throw Error("Whole-file allocation forbidden");
    });
    const slice = vi.spyOn(file, "slice");
    expect((await hashUploadBlob(file, new AbortController().signal, progress)).rootSha256).toBe(
      root,
    );
    expect(whole).not.toHaveBeenCalled();
    for (const [start, end] of slice.mock.calls)
      expect((end ?? 0) - (start ?? 0)).toBeLessThanOrEqual(CHUNK);
    expect(progress).toHaveBeenLastCalledWith(size);
  });
  it("rejects empty and catches a middle-byte change with identical metadata", async () => {
    const signal = new AbortController().signal;
    await expect(hashUploadBlob(new Blob([]), signal, () => {})).rejects.toThrow();
    const original = bytes(CHUNK * 2 + 137);
    const first = await hashUploadBlob(new Blob([original]), signal, () => {});
    original[CHUNK + 721]! ^= 1;
    expect((await hashUploadBlob(new Blob([original]), signal, () => {})).rootSha256).not.toBe(
      first.rootSha256,
    );
  });
  it("does not pull another slice after cancellation", async () => {
    const controller = new AbortController(),
      file = new Blob([bytes(CHUNK * 2)]),
      slice = vi.spyOn(file, "slice");
    await expect(
      hashUploadBlob(file, controller.signal, () => controller.abort(new Error("Stopped"))),
    ).rejects.toThrow("Stopped");
    expect(slice).toHaveBeenCalledTimes(1);
  });
});
describe("dedicated worker lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  function worker() {
    const instance = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as (() => void) | null,
      onmessageerror: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    const construct = vi.fn(function (..._args: unknown[]) {
      void _args;
      return instance;
    });
    vi.stubGlobal("Worker", construct);
    return { instance, construct };
  }
  it("terminates immediately on abort; late worker messages cannot resolve", async () => {
    const { instance, construct } = worker(),
      controller = new AbortController(),
      progress = vi.fn();
    const result = identifyUploadFile(new File(["abc"], "a.mp4"), controller.signal, progress);
    const rejection = expect(result).rejects.toThrow("Stop");
    controller.abort(new Error("Stop"));
    await rejection;
    expect(instance.terminate).toHaveBeenCalledOnce();
    instance.onmessage?.({ data: { kind: "progress", bytes: 3 } } as MessageEvent);
    expect(progress).not.toHaveBeenCalled();
    expect(construct.mock.calls[0]?.[1]).toEqual({
      type: "module",
      name: "ayin-upload-file-identity",
    });
  });
  it("terminates stalled/invalid workers instead of continuing in the main thread", async () => {
    vi.useFakeTimers();
    const { instance } = worker();
    const result = identifyUploadFile(
      new File(["abc"], "a.mp4"),
      new AbortController().signal,
      () => {},
    );
    const rejection = expect(result).rejects.toThrow("stopped responding");
    await vi.advanceTimersByTimeAsync(60001);
    await rejection;
    expect(instance.terminate).toHaveBeenCalledOnce();
  });
  it("requires complete worker progress before accepting a valid digest", async () => {
    const { instance } = worker();
    const result = identifyUploadFile(
      new File(["abc"], "a.mp4"),
      new AbortController().signal,
      () => {},
    );
    const rejection = expect(result).rejects.toThrow("Incomplete file check");
    instance.onmessage?.({
      data: {
        kind: "done",
        identity: {
          algorithm: "AYIN_SHA256_CHUNKS_V1",
          version: 1,
          sizeBytes: 3,
          chunkSizeBytes: CHUNK,
          leafCount: 1,
          rootSha256: "59b99b9bc1f6f3bf3575ad578d98e147194ab16425a47f582dea43dc5db4b498",
        },
      },
    } as MessageEvent);
    await rejection;
    expect(instance.terminate).toHaveBeenCalledOnce();
  });
});
