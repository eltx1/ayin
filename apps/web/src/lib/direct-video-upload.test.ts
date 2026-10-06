import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadPreparedVideoDirectly } from "./direct-video-upload";
const id = "11111111-1111-4111-8111-111111111111";
const session = {
  assetId: id,
  sessionToken: "token",
  mode: "single" as const,
  upload: { url: "https://storage.example.test/put", method: "PUT" as const, headers: {} },
};
class FakeRequest {
  static instances: FakeRequest[] = [];
  static held = false;
  static responseStatus = 200;
  static rejectOpen = false;
  upload = {
    onprogress: null as null | ((event: { lengthComputable: boolean; loaded: number }) => void),
  };
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = FakeRequest.responseStatus;
  withCredentials = true;
  constructor() {
    FakeRequest.instances.push(this);
  }
  open() {
    if (FakeRequest.rejectOpen) throw new Error("Rejected URL");
  }
  setRequestHeader() {}
  getResponseHeader() {
    return '"etag"';
  }
  abort() {
    this.onabort?.();
  }
  send(blob: Blob) {
    if (!FakeRequest.held)
      queueMicrotask(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: blob.size });
        this.onload?.();
      });
  }
}
beforeEach(() => {
  FakeRequest.instances = [];
  FakeRequest.held = false;
  FakeRequest.responseStatus = 200;
  FakeRequest.rejectOpen = false;
  vi.stubGlobal("XMLHttpRequest", FakeRequest);
  vi.stubGlobal("window", globalThis);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("prepared upload transport", () => {
  it("offers one metadata-only completion callback after storage transfer without changing validation", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const completeUpload = vi.fn().mockResolvedValue({ assetId: id, status: "UPLOADED" });
    const progress = vi.fn();
    await expect(
      uploadPreparedVideoDirectly({
        session,
        file: new File(["bytes"], "video.mp4"),
        onProgress: progress,
        completeUpload,
      }),
    ).resolves.toEqual({ assetId: id, status: "UPLOADED" });
    expect(completeUpload).toHaveBeenCalledExactlyOnceWith({ sessionToken: "token", parts: [] });
    expect(FakeRequest.instances).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(progress).toHaveBeenLastCalledWith(100);
  });
  it("does not repeat a rejected custom completion or resend storage bytes", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const denied = new Error("Definitive verification rejection");
    const completeUpload = vi.fn().mockRejectedValue(denied),
      progress = vi.fn();
    await expect(
      uploadPreparedVideoDirectly({
        session,
        file: new File(["bytes"], "video.mp4"),
        onProgress: progress,
        completeUpload,
      }),
    ).rejects.toBe(denied);
    expect(completeUpload).toHaveBeenCalledTimes(1);
    expect(FakeRequest.instances).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalledWith(100);
  });
  it("rejects a mismatched custom completion acknowledgment", async () => {
    const completeUpload = vi
      .fn()
      .mockResolvedValue({ assetId: "22222222-2222-4222-8222-222222222222", status: "UPLOADED" });
    await expect(
      uploadPreparedVideoDirectly({
        session,
        file: new File(["bytes"], "video.mp4"),
        onProgress: vi.fn(),
        completeUpload,
      }),
    ).rejects.toThrow();
    expect(completeUpload).toHaveBeenCalledTimes(1);
    expect(FakeRequest.instances).toHaveLength(1);
  });
  it("does not retry a rejected part authorization", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ parts: [] })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Denied" } }), { status: 403 }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      uploadPreparedVideoDirectly({
        session: {
          assetId: id,
          sessionToken: "token",
          mode: "multipart",
          partCount: 1,
          partSizeBytes: 5,
        },
        file: new File(["bytes"], "video.mp4"),
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow("Denied");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(FakeRequest.instances).toHaveLength(0);
  });
  it("releases timers after synchronous XHR setup rejection", async () => {
    vi.useFakeTimers();
    FakeRequest.rejectOpen = true;
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      uploadPreparedVideoDirectly({
        session,
        file: new File(["bytes"], "video.mp4"),
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow("could not be prepared");
    expect(FakeRequest.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels backoff immediately without another PUT", async () => {
    vi.useFakeTimers();
    FakeRequest.responseStatus = 503;
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      uploadPreparedVideoDirectly({
        session,
        file: new File(["bytes"], "video.mp4"),
        onProgress: vi.fn(),
        signal: controller.signal,
        onStatus: (status) => {
          if (status.phase === "retrying") controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeRequest.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds a stalled completion response without replaying the mutation", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const operation = uploadPreparedVideoDirectly({
      session,
      file: new File(["bytes"], "video.mp4"),
      onProgress: vi.fn(),
    });
    const failure = expect(operation).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.runAllTimersAsync();
    await failure;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("omits storage credentials and reports100 only after matching completion", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ assetId: id, status: "UPLOADED" })));
    vi.stubGlobal("fetch", fetch);
    const progress = vi.fn();
    expect(
      await uploadPreparedVideoDirectly({
        session,
        file: new File(["bytes"], "video.mp4"),
        onProgress: progress,
      }),
    ).toEqual({ assetId: id, status: "UPLOADED" });
    expect(FakeRequest.instances).toHaveLength(1);
    expect(FakeRequest.instances[0]!.withCredentials).toBe(false);
    expect(progress.mock.calls.map((call) => call[0])).toEqual([99, 100]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not claim success or replay completion after a mismatched acknowledgment", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ assetId: "22222222-2222-4222-8222-222222222222", status: "UPLOADED" }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const progress = vi.fn();
    await expect(
      uploadPreparedVideoDirectly({
        session,
        file: new File(["bytes"], "video.mp4"),
        onProgress: progress,
      }),
    ).rejects.toThrow("could not be verified");
    expect(progress).not.toHaveBeenCalledWith(100);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects an unsafe session before storage or API calls", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      uploadPreparedVideoDirectly({
        session: { ...session, upload: { ...session.upload, url: "http://untrusted.example/put" } },
        file: new File(["bytes"], "video.mp4"),
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow();
    expect(FakeRequest.instances).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("cancels an active PUT without retrying or completing it", async () => {
    FakeRequest.held = true;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const operation = uploadPreparedVideoDirectly({
      session,
      file: new File(["bytes"], "video.mp4"),
      onProgress: vi.fn(),
      signal: controller.signal,
    });
    const rejection = expect(operation).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejection;
    expect(FakeRequest.instances).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
