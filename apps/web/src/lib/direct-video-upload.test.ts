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
  static active = 0;
  static peakActive = 0;
  static waiters: { count: number; resolve: () => void }[] = [];
  static waitForUploads(count: number) {
    if (FakeRequest.instances.filter((request) => request.blob).length >= count)
      return Promise.resolve();
    return new Promise<void>((resolve) => FakeRequest.waiters.push({ count, resolve }));
  }
  upload = {
    onprogress: null as null | ((event: { lengthComputable: boolean; loaded: number }) => void),
  };
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = FakeRequest.responseStatus;
  withCredentials = true;
  url = "";
  headers: Record<string, string> = {};
  blob: Blob | null = null;
  etag: string | null = '"etag"';
  aborted = false;
  settled = false;
  constructor() {
    FakeRequest.instances.push(this);
  }
  open(_method: string, url: string) {
    if (FakeRequest.rejectOpen) throw new Error("Rejected URL");
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getResponseHeader() {
    return this.etag;
  }
  abort() {
    if (this.settled) return;
    this.aborted = true;
    this.settled = true;
    if (this.blob) FakeRequest.active -= 1;
    this.onabort?.();
  }
  progress(loaded: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded });
  }
  respond(status = 200, etag: string | null = this.etag) {
    if (this.settled) return;
    this.status = status;
    this.etag = etag;
    this.settled = true;
    FakeRequest.active -= 1;
    this.onload?.();
  }
  send(blob: Blob) {
    this.blob = blob;
    FakeRequest.active += 1;
    FakeRequest.peakActive = Math.max(FakeRequest.peakActive, FakeRequest.active);
    for (const waiter of FakeRequest.waiters) {
      if (FakeRequest.instances.filter((request) => request.blob).length >= waiter.count)
        waiter.resolve();
    }
    if (!FakeRequest.held)
      queueMicrotask(() => {
        if (this.settled) return;
        this.progress(blob.size);
        this.respond(this.status);
      });
  }
}
beforeEach(() => {
  FakeRequest.instances = [];
  FakeRequest.held = false;
  FakeRequest.responseStatus = 200;
  FakeRequest.rejectOpen = false;
  FakeRequest.active = 0;
  FakeRequest.peakActive = 0;
  FakeRequest.waiters = [];
  vi.stubGlobal("XMLHttpRequest", FakeRequest);
  vi.stubGlobal("window", globalThis);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function multipartSession(partCount: number, partSizeBytes = 5) {
  return {
    assetId: id,
    sessionToken: "token",
    mode: "multipart" as const,
    partCount,
    partSizeBytes,
  };
}

function mockMultipartApi(parts: { partNumber: number; sizeBytes: number; etag: string }[] = []) {
  const authorizedParts: number[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body)) as { partNumber: number };
    if (url.endsWith("/resume")) return new Response(JSON.stringify({ parts }));
    if (url.endsWith("/authorize-part")) {
      authorizedParts.push(payload.partNumber);
      return new Response(
        JSON.stringify({
          url: `https://storage.example.test/part/${payload.partNumber}?grant=${authorizedParts.length}`,
        }),
      );
    }
    if (url.endsWith("/complete"))
      return new Response(JSON.stringify({ assetId: id, status: "UPLOADED" }));
    throw new Error(`Unexpected upload API request: ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, authorizedParts };
}

function partRequest(partNumber: number, attempt = 0) {
  const request = FakeRequest.instances.filter((item) => item.url.includes(`/part/${partNumber}?`))[
    attempt
  ];
  if (!request) throw new Error(`Part ${partNumber}, attempt ${attempt + 1} was not sent.`);
  return request;
}
describe("prepared upload transport", () => {
  it("uploads at most three parts together and waits for every verified part before completion", async () => {
    FakeRequest.held = true;
    const { authorizedParts } = mockMultipartApi();
    let acknowledge!: (value: unknown) => void;
    let completionStarted!: () => void;
    const completionPending = new Promise<void>((resolve) => (completionStarted = resolve));
    const completeUpload = vi.fn(() => {
      completionStarted();
      return new Promise((resolve) => (acknowledge = resolve));
    });
    const onProgress = vi.fn(),
      onBytesProgress = vi.fn();
    const operation = uploadPreparedVideoDirectly({
      session: multipartSession(5),
      file: new File(["123456789012345678901"], "video.mp4"),
      onProgress,
      onBytesProgress,
      completeUpload,
    });
    await FakeRequest.waitForUploads(3);
    expect(authorizedParts).toEqual([1, 2, 3]);
    expect(FakeRequest.active).toBe(3);
    partRequest(1).progress(3);
    partRequest(2).progress(2);
    partRequest(3).progress(4);
    expect(onBytesProgress).toHaveBeenLastCalledWith(9, 21);

    partRequest(2).respond(200, '"part-2"');
    await FakeRequest.waitForUploads(4);
    partRequest(4).progress(5);
    partRequest(4).respond(200, '"part-4"');
    await FakeRequest.waitForUploads(5);
    expect(partRequest(5).blob?.size).toBe(1);
    partRequest(5).progress(9); // Browser progress cannot inflate the final short part.
    partRequest(3).respond(200, '"part-3"');
    partRequest(5).respond(200, '"part-5"');
    partRequest(1).progress(5);
    expect(onBytesProgress).toHaveBeenLastCalledWith(20, 21);
    expect(completeUpload).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalledWith(100);

    partRequest(1).respond(200, '"part-1"');
    await completionPending;
    expect(completeUpload).toHaveBeenCalledWith({
      sessionToken: "token",
      parts: [1, 2, 3, 4, 5].map((partNumber) => ({ partNumber, etag: `"part-${partNumber}"` })),
    });
    expect(onProgress).toHaveBeenLastCalledWith(99);
    acknowledge({ assetId: id, status: "UPLOADED" });
    await expect(operation).resolves.toEqual({ assetId: id, status: "UPLOADED" });
    expect(FakeRequest.peakActive).toBe(3);
    expect(FakeRequest.active).toBe(0);
    expect(onBytesProgress.mock.calls.map(([bytes]) => bytes)).toEqual([
      0, 3, 5, 9, 12, 17, 17, 18, 20, 21, 21, 21,
    ]);
    expect(onProgress).toHaveBeenLastCalledWith(100);
  });

  it("reconciles resumed parts before scheduling and preserves their ETags in the sorted manifest", async () => {
    FakeRequest.held = true;
    const { authorizedParts } = mockMultipartApi([
      { partNumber: 5, sizeBytes: 1, etag: '"saved-5"' },
      { partNumber: 2, sizeBytes: 5, etag: '"saved-2"' },
    ]);
    const completeUpload = vi.fn().mockResolvedValue({ assetId: id, status: "UPLOADED" });
    const onBytesProgress = vi.fn();
    const operation = uploadPreparedVideoDirectly({
      session: multipartSession(5),
      file: new File(["123456789012345678901"], "video.mp4"),
      onProgress: vi.fn(),
      onBytesProgress,
      completeUpload,
    });
    await FakeRequest.waitForUploads(3);
    expect(authorizedParts).toEqual([1, 3, 4]);
    expect(onBytesProgress).toHaveBeenLastCalledWith(6, 21);
    partRequest(1).progress(2);
    partRequest(3).progress(3);
    partRequest(4).progress(4);
    expect(onBytesProgress).toHaveBeenLastCalledWith(15, 21);
    partRequest(4).respond(200, '"new-4"');
    partRequest(1).respond(200, '"new-1"');
    partRequest(3).respond(200, '"new-3"');
    await operation;
    expect(onBytesProgress).toHaveBeenLastCalledWith(21, 21);
    expect(completeUpload).toHaveBeenCalledExactlyOnceWith({
      sessionToken: "token",
      parts: [
        { partNumber: 1, etag: '"new-1"' },
        { partNumber: 2, etag: '"saved-2"' },
        { partNumber: 3, etag: '"new-3"' },
        { partNumber: 4, etag: '"new-4"' },
        { partNumber: 5, etag: '"saved-5"' },
      ],
    });
  });

  it("completes an already uploaded multipart manifest without retransferring storage bytes", async () => {
    const { fetch, authorizedParts } = mockMultipartApi([
      { partNumber: 1, sizeBytes: 5, etag: '"saved"' },
    ]);
    const onBytesProgress = vi.fn();
    await uploadPreparedVideoDirectly({
      session: multipartSession(1),
      file: new File(["bytes"], "video.mp4"),
      onProgress: vi.fn(),
      onBytesProgress,
    });
    expect(authorizedParts).toEqual([]);
    expect(FakeRequest.instances).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onBytesProgress).toHaveBeenCalledExactlyOnceWith(5, 5);
  });

  it("retries only the failed part with fresh authorization and never double-counts retry bytes", async () => {
    vi.useFakeTimers();
    FakeRequest.held = true;
    const { authorizedParts } = mockMultipartApi();
    let retryStarted!: () => void;
    const retryPending = new Promise<void>((resolve) => (retryStarted = resolve));
    const onStatus = vi.fn((status) => {
      if (status.phase === "retrying") retryStarted();
    });
    const onBytesProgress = vi.fn();
    const operation = uploadPreparedVideoDirectly({
      session: multipartSession(3),
      file: new File(["123456789012345"], "video.mp4"),
      onProgress: vi.fn(),
      onBytesProgress,
      onStatus,
    });
    await FakeRequest.waitForUploads(3);
    partRequest(1).progress(4);
    partRequest(2).progress(5);
    partRequest(3).progress(3);
    partRequest(2).respond(200, '"part-2"');
    partRequest(1).respond(503);
    await retryPending;
    expect(FakeRequest.instances).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(800);
    await FakeRequest.waitForUploads(4);
    expect(authorizedParts).toEqual([1, 2, 3, 1]);
    expect(partRequest(1, 1).url).not.toBe(partRequest(1).url);
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: "uploading",
        partNumber: 1,
        attempt: 2,
      }),
    );
    partRequest(1, 1).progress(1);
    expect(onBytesProgress).toHaveBeenLastCalledWith(12, 15);
    partRequest(1, 1).progress(5);
    partRequest(1, 1).respond(200, '"fresh-1"');
    partRequest(3).respond(200, '"part-3"');
    await operation;
    expect(onBytesProgress.mock.calls.map(([bytes]) => bytes)).toEqual([
      0, 4, 9, 12, 12, 12, 13, 13, 15,
    ]);
    expect(FakeRequest.peakActive).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels every active multipart PUT and never schedules queued parts or completion", async () => {
    vi.useFakeTimers();
    FakeRequest.held = true;
    const { fetch, authorizedParts } = mockMultipartApi();
    const controller = new AbortController();
    const onProgress = vi.fn(),
      onBytesProgress = vi.fn();
    const operation = uploadPreparedVideoDirectly({
      session: multipartSession(5),
      file: new File(["123456789012345678901"], "video.mp4"),
      onProgress,
      onBytesProgress,
      signal: controller.signal,
    });
    const rejection = expect(operation).rejects.toMatchObject({ name: "AbortError" });
    await FakeRequest.waitForUploads(3);
    controller.abort();
    await rejection;
    expect(FakeRequest.instances.every((request) => request.aborted)).toBe(true);
    expect(FakeRequest.active).toBe(0);
    expect(authorizedParts).toEqual([1, 2, 3]);
    expect(fetch).toHaveBeenCalledTimes(4);
    partRequest(1).progress(5); // A late browser event cannot revive a cancelled upload.
    expect(onBytesProgress).toHaveBeenCalledExactlyOnceWith(0, 21);
    expect(onProgress).not.toHaveBeenCalledWith(100);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([null, "", " ", "bad\r\netag", "x".repeat(513)])(
    "rejects an unverifiable ETag (%j), aborting siblings without completing",
    async (etag) => {
      vi.useFakeTimers();
      FakeRequest.held = true;
      const { fetch, authorizedParts } = mockMultipartApi();
      const onProgress = vi.fn();
      const operation = uploadPreparedVideoDirectly({
        session: multipartSession(4),
        file: new File(["12345678901234567890"], "video.mp4"),
        onProgress,
      });
      const rejection = expect(operation).rejects.toMatchObject({
        name: "UploadBlobError",
        retryable: false,
      });
      await FakeRequest.waitForUploads(3);
      partRequest(1).respond(200, etag);
      await rejection;
      expect(partRequest(2).aborted).toBe(true);
      expect(partRequest(3).aborted).toBe(true);
      expect(FakeRequest.active).toBe(0);
      expect(authorizedParts).toEqual([1, 2, 3]);
      expect(fetch).toHaveBeenCalledTimes(4);
      expect(onProgress).not.toHaveBeenCalledWith(100);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("preserves the first terminal storage error while aborting sibling transfers", async () => {
    vi.useFakeTimers();
    FakeRequest.held = true;
    const { fetch } = mockMultipartApi();
    const operation = uploadPreparedVideoDirectly({
      session: multipartSession(4),
      file: new File(["12345678901234567890"], "video.mp4"),
      onProgress: vi.fn(),
    });
    const rejection = expect(operation).rejects.toMatchObject({
      name: "UploadBlobError",
      status: 403,
      retryable: false,
    });
    await FakeRequest.waitForUploads(3);
    partRequest(2).respond(403);
    await rejection;
    expect(partRequest(1).aborted).toBe(true);
    expect(partRequest(3).aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for aborted authorization requests to settle before returning a failed transfer", async () => {
    vi.useFakeTimers();
    FakeRequest.held = true;
    const releaseAbortedGrants: (() => void)[] = [];
    let siblingsAborted!: () => void;
    const siblingsPending = new Promise<void>((resolve) => (siblingsAborted = resolve));
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/resume")) return new Response(JSON.stringify({ parts: [] }));
      const { partNumber } = JSON.parse(String(init.body)) as { partNumber: number };
      if (partNumber === 1)
        return new Response(JSON.stringify({ url: "https://storage.example.test/part/1?grant=1" }));
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => {
            releaseAbortedGrants.push(() => reject(init.signal?.reason));
            if (releaseAbortedGrants.length === 2) siblingsAborted();
          },
          { once: true },
        );
      });
    });
    vi.stubGlobal("fetch", fetch);
    const settled = vi.fn();
    const completeUpload = vi.fn();
    const operation = uploadPreparedVideoDirectly({
      session: multipartSession(4),
      file: new File(["12345678901234567890"], "video.mp4"),
      onProgress: vi.fn(),
      completeUpload,
    });
    void operation.then(settled, settled);
    const rejection = expect(operation).rejects.toMatchObject({ status: 403 });
    await FakeRequest.waitForUploads(1);
    partRequest(1).respond(403);
    await siblingsPending;
    expect(settled).not.toHaveBeenCalled();
    expect(completeUpload).not.toHaveBeenCalled();
    for (const release of releaseAbortedGrants) release();
    await rejection;
    expect(settled).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops after four failed attempts and cancels siblings without completing or dequeuing more parts", async () => {
    vi.useFakeTimers();
    FakeRequest.held = true;
    const { fetch, authorizedParts } = mockMultipartApi();
    const operation = uploadPreparedVideoDirectly({
      session: multipartSession(4),
      file: new File(["12345678901234567890"], "video.mp4"),
      onProgress: vi.fn(),
    });
    const rejection = expect(operation).rejects.toMatchObject({ status: 503, retryable: true });
    await FakeRequest.waitForUploads(3);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      partRequest(1, attempt).respond(503);
      await vi.advanceTimersByTimeAsync(500 * 2 ** attempt + 300);
      await FakeRequest.waitForUploads(4 + attempt);
    }
    partRequest(1, 3).respond(503);
    await rejection;
    expect(authorizedParts).toEqual([1, 2, 3, 1, 1, 1]);
    expect(partRequest(2).aborted).toBe(true);
    expect(partRequest(3).aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(7);
    expect(FakeRequest.peakActive).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a contradictory resume manifest before authorizing any new parts", async () => {
    const { fetch, authorizedParts } = mockMultipartApi([
      { partNumber: 1, sizeBytes: 5, etag: '"saved-1"' },
      { partNumber: 1, sizeBytes: 5, etag: '"duplicate-1"' },
    ]);
    await expect(
      uploadPreparedVideoDirectly({
        session: multipartSession(2),
        file: new File(["1234567890"], "video.mp4"),
        onProgress: vi.fn(),
      }),
    ).rejects.toMatchObject({ name: "UploadProtocolError" });
    expect(authorizedParts).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(FakeRequest.instances).toHaveLength(0);
  });

  it("renews a single PUT grant on retry and reports monotonic logical bytes plus an uploading status", async () => {
    vi.useFakeTimers();
    FakeRequest.held = true;
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          url: "https://storage.example.test/renewed",
          method: "PUT",
          headers: { "content-type": "video/mp4" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const onBytesProgress = vi.fn(),
      onStatus = vi.fn();
    const completeUpload = vi.fn().mockResolvedValue({ assetId: id, status: "UPLOADED" });
    const operation = uploadPreparedVideoDirectly({
      session,
      file: new File(["bytes"], "video.mp4"),
      onProgress: vi.fn(),
      onBytesProgress,
      onStatus,
      completeUpload,
    });
    await FakeRequest.waitForUploads(1);
    FakeRequest.instances[0]!.progress(4);
    FakeRequest.instances[0]!.respond(503);
    await vi.advanceTimersByTimeAsync(800);
    await FakeRequest.waitForUploads(2);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/\/authorize-single$/),
      expect.objectContaining({
        body: JSON.stringify({ sessionToken: "token" }),
      }),
    );
    const retry = FakeRequest.instances[1]!;
    expect(retry.url).toBe("https://storage.example.test/renewed");
    expect(retry.headers).toEqual({ "content-type": "video/mp4" });
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "uploading", attempt: 2 }),
    );
    retry.progress(1);
    retry.progress(5);
    retry.respond();
    await operation;
    expect(onBytesProgress.mock.calls.map(([bytes]) => bytes)).toEqual([4, 4, 5, 5]);
    expect(completeUpload).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("renews a resumed single PUT before its first attempt instead of reusing an old URL", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          url: "https://storage.example.test/resumed",
          method: "PUT",
          headers: {},
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await uploadPreparedVideoDirectly({
      session,
      file: new File(["bytes"], "video.mp4"),
      onProgress: vi.fn(),
      renewSingleAuthorization: true,
      completeUpload: vi.fn().mockResolvedValue({ assetId: id, status: "UPLOADED" }),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(FakeRequest.instances).toHaveLength(1);
    expect(FakeRequest.instances[0]!.url).toBe("https://storage.example.test/resumed");
  });

  it("never retries an explicitly denied single grant renewal or reuses its stale URL", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Expired session" } }), { status: 401 }),
      );
    vi.stubGlobal("fetch", fetch);
    const completeUpload = vi.fn();
    await expect(
      uploadPreparedVideoDirectly({
        session,
        file: new File(["bytes"], "video.mp4"),
        onProgress: vi.fn(),
        renewSingleAuthorization: true,
        completeUpload,
      }),
    ).rejects.toMatchObject({ name: "UploadRequestError", status: 401 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(FakeRequest.instances).toHaveLength(0);
    expect(completeUpload).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

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
