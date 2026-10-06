import { describe, expect, it } from "vitest";

import { completionReached, resumablePositionMs, shouldPersistProgress } from "./player-progress";

describe("AYIN player watch-state helpers", () => {
  it("throttles routine progress writes but permits meaningful forced checkpoints", () => {
    expect(
      shouldPersistProgress({
        nowMs: 10_000,
        lastPersistedAtMs: 0,
        positionMs: 9_000,
        lastPersistedPositionMs: 0,
        intervalMs: 15_000,
      }),
    ).toBe(false);
    expect(
      shouldPersistProgress({
        nowMs: 16_000,
        lastPersistedAtMs: 0,
        positionMs: 15_000,
        lastPersistedPositionMs: 0,
        intervalMs: 15_000,
      }),
    ).toBe(true);
    expect(
      shouldPersistProgress({
        nowMs: 2_000,
        lastPersistedAtMs: 1_500,
        positionMs: 8_000,
        lastPersistedPositionMs: 6_000,
        intervalMs: 15_000,
        force: true,
      }),
    ).toBe(true);
    expect(
      shouldPersistProgress({
        nowMs: 2_000,
        lastPersistedAtMs: 1_500,
        positionMs: 6_100,
        lastPersistedPositionMs: 6_000,
        intervalMs: 15_000,
        force: true,
      }),
    ).toBe(false);
  });

  it("resumes meaningful unfinished progress and restarts completed or near-finished videos", () => {
    expect(resumablePositionMs({ positionMs: 42_000, completedAt: null }, 120_000)).toBe(42_000);
    expect(resumablePositionMs({ positionMs: 1_500, completedAt: null }, 120_000)).toBe(0);
    expect(resumablePositionMs({ positionMs: 115_500, completedAt: null }, 120_000)).toBe(0);
    expect(
      resumablePositionMs({ positionMs: 42_000, completedAt: "2026-08-29T00:00:00Z" }, 120_000),
    ).toBe(0);
  });

  it("uses the configured threshold for completion", () => {
    expect(completionReached(89_000, 100_000, 90)).toBe(false);
    expect(completionReached(90_000, 100_000, 90)).toBe(true);
  });
});

import { afterEach, vi } from "vitest";
import {
  persistWatchProgress,
  readWatchProgress,
  WatchProgressConflictError,
} from "./player-progress";

const videoId = "00000000-0000-4000-8000-000000000001";
const accountId = "00000000-0000-4000-8000-000000000002";
const profileId = "00000000-0000-4000-8000-000000000003";
const snapshot = {
  videoId,
  profileId,
  positionMs: 42_000,
  completedAt: null,
  lastWatchedAt: "2026-10-05T00:00:00.000Z",
  revision: "2026-10-05T00:00:00.000Z",
  policy: { progressSaveIntervalMs: 15_000, completionThresholdPercent: 90 },
};
const scope = () => ({ accountId, profileId, signal: new AbortController().signal });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("identity-bound watch progress transport", () => {
  it("sends explicit account, profile, no-store and cancellation on reads", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(snapshot));
    vi.stubGlobal("fetch", fetcher);
    await expect(readWatchProgress(videoId, scope())).resolves.toEqual(snapshot);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toContain(`/watch/progress/${videoId}?profileId=${profileId}`);
    expect(init).toMatchObject({
      method: "GET",
      cache: "no-store",
      credentials: "include",
      headers: { "x-ayin-expected-account": accountId },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("writes an explicit profile/account and returns only the actual server ACK position", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(snapshot));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      persistWatchProgress(
        videoId,
        { positionMs: 42_000.9, durationMs: 120_000.8, expectedRevision: null },
        scope(),
        true,
      ),
    ).resolves.toEqual(snapshot);
    const init = fetcher.mock.calls[0]![1];
    expect(init).toMatchObject({
      method: "PUT",
      keepalive: true,
      cache: "no-store",
      credentials: "include",
      headers: { "x-ayin-expected-account": accountId },
    });
    expect(JSON.parse(init.body)).toEqual({
      profileId,
      positionMs: 42_000,
      durationMs: 120_000,
      expectedRevision: null,
    });
  });

  for (const change of [
    { videoId: accountId },
    { profileId: accountId },
    { positionMs: "42000" },
    { positionMs: -1 },
    { positionMs: 1.5 },
    { positionMs: 604_800_001 },
    { completedAt: "invalid" },
    { lastWatchedAt: undefined },
    { policy: null },
    { policy: { progressSaveIntervalMs: 0, completionThresholdPercent: 90 } },
    { policy: { progressSaveIntervalMs: 15_000, completionThresholdPercent: 101 } },
  ]) {
    it(`rejects a malformed/mismatched response ${JSON.stringify(change)}`, async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...snapshot, ...change })));
      await expect(readWatchProgress(videoId, scope())).rejects.toMatchObject({
        code: "INVALID_PROGRESS_RESPONSE",
      });
    });
  }

  it("rejects a response claiming progress beyond this request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(snapshot)));
    await expect(
      persistWatchProgress(videoId, { positionMs: 30_000, expectedRevision: null }, scope()),
    ).rejects.toMatchObject({ code: "INVALID_PROGRESS_ACK" });
  });

  for (const status of [401, 403, 409, 500]) {
    it(`never acknowledges HTTP ${status}`, async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
      await expect(
        persistWatchProgress(videoId, { positionMs: 42_000, expectedRevision: null }, scope()),
      ).rejects.toMatchObject({ status });
    });
  }

  it("rejects malformed JSON, oversized bodies and lost acknowledgments", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("{"))
      .mockResolvedValueOnce(new Response(" ".repeat(16_385)))
      .mockRejectedValueOnce(new TypeError("Network failure"));
    vi.stubGlobal("fetch", fetcher);
    await expect(readWatchProgress(videoId, scope())).rejects.toThrow();
    await expect(readWatchProgress(videoId, scope())).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });
    await expect(
      persistWatchProgress(videoId, { positionMs: 42_000, expectedRevision: null }, scope()),
    ).rejects.toThrow("Network failure");
  });

  it("will not start an unbound or already canceled request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(readWatchProgress(videoId, { ...scope(), accountId: "" })).rejects.toMatchObject({
      code: "INVALID_PROGRESS_SCOPE",
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      readWatchProgress(videoId, { ...scope(), signal: controller.signal }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("cancels in flight and rejects late data even when fetch ignores abort", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const read = readWatchProgress(videoId, { ...scope(), signal: controller.signal });
    const rejected = expect(read).rejects.toThrow();
    controller.abort();
    resolve(Response.json(snapshot));
    await rejected;
    expect(fetcher.mock.calls[0]).toBeDefined();
  });

  it("bounds a stalled request with a deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener("abort", () => reject(new Error("Aborted")), {
              once: true,
            });
          }),
      ),
    );
    const read = readWatchProgress(videoId, scope());
    const rejected = expect(read).rejects.toThrow("Aborted");
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;
  });
});

describe("lifecycle keepalive delivery boundary", () => {
  it("lets only an already-started keepalive write survive owner teardown", async () => {
    let release!: (response: Response) => void;
    const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const owner = new AbortController();
    const result = persistWatchProgress(
      videoId,
      { positionMs: 42_000, expectedRevision: null },
      { ...scope(), signal: owner.signal },
      true,
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    owner.abort();
    const signal = fetcher.mock.calls[0]![1].signal;
    release(Response.json(snapshot));
    expect(signal?.aborted).toBe(false);
    await expect(result).resolves.toEqual({ value: snapshot });
  });

  it("never starts a keepalive write from an already-invalidated owner", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const owner = new AbortController();
    owner.abort();
    await expect(
      persistWatchProgress(
        videoId,
        { positionMs: 42_000, expectedRevision: null },
        { ...scope(), signal: owner.signal },
        true,
      ),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

it("bounds detached lifecycle delivery by its own five-second deadline without retry", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(new Error("Final delivery expired")), {
          once: true,
        });
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const owner = new AbortController();
  const pending = persistWatchProgress(
    videoId,
    { positionMs: 42_000, expectedRevision: null },
    { ...scope(), signal: owner.signal },
    true,
  );
  const rejected = expect(pending).rejects.toThrow("Final delivery expired");
  owner.abort();
  await vi.advanceTimersByTimeAsync(4_999);
  expect(fetcher.mock.calls[0]![1].signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await rejected;
  expect(fetcher).toHaveBeenCalledTimes(1);
});

describe("atomic progress freshness transport", () => {
  it("accepts the explicit absent-row revision and rejects a missing or mismatched revision", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ...snapshot, positionMs: 0, lastWatchedAt: null, revision: null }),
      )
      .mockResolvedValueOnce(Response.json({ ...snapshot, revision: undefined }))
      .mockResolvedValueOnce(Response.json({ ...snapshot, revision: "2026-10-05T00:00:00.001Z" }));
    vi.stubGlobal("fetch", fetcher);
    await expect(readWatchProgress(videoId, scope())).resolves.toMatchObject({
      positionMs: 0,
      revision: null,
    });
    await expect(readWatchProgress(videoId, scope())).rejects.toMatchObject({
      code: "INVALID_PROGRESS_RESPONSE",
    });
    await expect(readWatchProgress(videoId, scope())).rejects.toMatchObject({
      code: "INVALID_PROGRESS_RESPONSE",
    });
  });

  it("sends the observed revision and requires an advancing acknowledged revision", async () => {
    const next = {
      ...snapshot,
      revision: "2026-10-05T00:00:00.001Z",
      lastWatchedAt: "2026-10-05T00:00:00.001Z",
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(next))
      .mockResolvedValueOnce(Response.json(snapshot));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      persistWatchProgress(
        videoId,
        { positionMs: 42_000, expectedRevision: snapshot.revision },
        scope(),
      ),
    ).resolves.toEqual(next);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body).expectedRevision).toBe(snapshot.revision);
    await expect(
      persistWatchProgress(
        videoId,
        { positionMs: 42_000, expectedRevision: snapshot.revision },
        scope(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_PROGRESS_ACK" });
  });

  it("keeps a progress conflict separate from an account-identity failure", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: { code: "WATCH_PROGRESS_CONFLICT" } }, { status: 409 }),
      )
      .mockResolvedValueOnce(
        Response.json({ error: { code: "ACCOUNT_CHANGED" } }, { status: 409 }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      persistWatchProgress(
        videoId,
        { positionMs: 42_000, expectedRevision: snapshot.revision },
        scope(),
      ),
    ).rejects.toBeInstanceOf(WatchProgressConflictError);
    await expect(
      persistWatchProgress(
        videoId,
        { positionMs: 42_000, expectedRevision: snapshot.revision },
        scope(),
      ),
    ).rejects.toMatchObject({ status: 409, code: "PROGRESS_REJECTED" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("will not omit or send a malformed revision for a new Watch write", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const expectedRevision of [
      undefined,
      "invalid",
      "2026-10-05T00:00:00Z",
      "2026-10-05T00:00:00.000+00:00",
    ])
      await expect(
        persistWatchProgress(videoId, { positionMs: 42_000, expectedRevision } as never, scope()),
      ).rejects.toMatchObject({ code: "INVALID_PROGRESS_REVISION" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
