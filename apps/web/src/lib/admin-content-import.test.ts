import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canRollbackSeed,
  parseSeedBatch,
  parseSeedCreation,
  seedPhase,
  seedRequest,
  SeedRequestError,
} from "./admin-content-import";
const actor = {
  accountId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  authVersion: 1,
  roles: ["OPERATIONS" as const],
};
const item = {
  id: "33333333-3333-4333-8333-333333333333",
  status: "UPLOADING",
  rightsBasis: "LICENSED",
  sourceNotes: "Cleared test rights",
  video: {
    id: "44444444-4444-4444-8444-444444444444",
    slug: "original",
    title: "Original video",
    contentType: "DOCUMENTARY",
    status: "VALIDATING",
    mediaProcessingJobs: [{ status: "QUEUED" }],
  },
};
const batch = {
  id: "55555555-5555-4555-8555-555555555555",
  sourceLabel: "Original source",
  status: "READY",
  createdAt: "2026-10-06T01:00:00.000Z",
  channel: {
    id: "66666666-6666-4666-8666-666666666666",
    handle: "catalog",
    name: "Catalog",
    isPlatformOwned: true,
  },
  items: [item],
};
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("bounded native content import", () => {
  it("distinguishes pending upload, processing, ready, failed and protected publication from durable state", () => {
    const parsed = parseSeedBatch(batch),
      original = parsed.items[0]!;
    expect(seedPhase(original)).toBe("processing");
    expect(seedPhase({ ...original, status: "READY" })).toBe("processing");
    expect(seedPhase({ ...original, video: { ...original.video, mediaProcessingJobs: [] } })).toBe(
      "uploading",
    );
    expect(
      seedPhase({
        ...original,
        status: "READY",
        video: { ...original.video, mediaProcessingJobs: [{ status: "READY" }] },
      }),
    ).toBe("ready");
    expect(
      seedPhase({
        ...original,
        video: { ...original.video, mediaProcessingJobs: [{ status: "FAILED" }] },
      }),
    ).toBe("failed");
    expect(canRollbackSeed(parsed)).toBe(true);
    expect(
      canRollbackSeed({
        ...parsed,
        items: [{ ...original, video: { ...original.video, status: "PUBLISHED" } }],
      }),
    ).toBe(false);
    expect(canRollbackSeed({ ...parsed, status: "ROLLED_BACK" })).toBe(false);
  });
  it("accepts a single exact created item, rejects malformed and bulk acknowledgments", () => {
    const created = {
      batch: { id: batch.id },
      items: [{ ...item, video: { ...item.video, mediaProcessingJobs: undefined } }],
    };
    expect(parseSeedCreation(created).batchId).toBe(batch.id);
    expect(parseSeedCreation(created).item.id).toBe(item.id);
    expect(() => parseSeedCreation({ ...created, items: [item, item] })).toThrow();
    expect(() => parseSeedCreation({ ...created, batch: { id: "unverified" } })).toThrow();
  });
  it("reads the original batch with actor checks before and after; never confirms or uploads", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response(batch))
      .mockResolvedValueOnce(response(actor));
    vi.stubGlobal("fetch", fetch);
    const result = await seedRequest(
      `/admin/content-seeding/batches/${batch.id}`,
      parseSeedBatch,
      actor,
      new AbortController().signal,
    );
    expect(result.id).toBe(batch.id);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining("/admin/session"),
      expect.stringContaining(batch.id),
      expect.stringContaining("/admin/session"),
    ]);
    expect(fetch.mock.calls.every(([, init]) => !init.method)).toBe(true);
  });
  it("rejects an actor or role switch before any write", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ ...actor, authVersion: 2 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      seedRequest(
        "/admin/content-seeding/batches",
        parseSeedCreation,
        actor,
        new AbortController().signal,
        { method: "POST" },
      ),
    ).rejects.toMatchObject({ authorityLost: true, writeStarted: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("fences a committed result when the actor changes during its response", async () => {
    const ack = { batch: { id: batch.id }, items: [item] };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response(ack))
      .mockResolvedValueOnce(
        response({ ...actor, sessionId: "77777777-7777-4777-8777-777777777777" }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      seedRequest(
        "/admin/content-seeding/batches",
        parseSeedCreation,
        actor,
        new AbortController().signal,
        { method: "POST" },
      ),
    ).rejects.toMatchObject({
      authorityLost: true,
      acknowledged: { batchId: batch.id },
      writeStarted: true,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("retains acknowledgment independently of a later authority-read failure", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ id: item.video.id, status: "PUBLISHED" }))
      .mockRejectedValueOnce(new Error("Read offline"));
    vi.stubGlobal("fetch", fetch);
    await expect(
      seedRequest(
        "/admin/content-seeding/items/original/publish",
        (value) => value,
        actor,
        new AbortController().signal,
        { method: "POST" },
      ),
    ).rejects.toMatchObject({
      acknowledged: { id: item.video.id, status: "PUBLISHED" },
      authorityLost: true,
    });
    expect(fetch.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
  });
  it("does not replay a lost acknowledgment or a step-up rejection", async () => {
    for (const lost of [true, false]) {
      const fetch = vi.fn().mockResolvedValueOnce(response(actor));
      if (lost) fetch.mockRejectedValueOnce(new Error("Lost acknowledgment"));
      else
        fetch.mockResolvedValueOnce(
          response({ error: { code: "STEP_UP_REQUIRED", message: "Verify" } }, 403),
        );
      vi.stubGlobal("fetch", fetch);
      try {
        await seedRequest(
          "/admin/content-seeding/items/original/publish",
          (value) => value,
          actor,
          new AbortController().signal,
          { method: "POST" },
        );
        throw new Error("Expected rejection");
      } catch (cause) {
        expect(cause).toBeInstanceOf(SeedRequestError);
        expect(cause).toMatchObject({ writeStarted: true, verificationRequired: !lost });
      }
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  });
  it("bounds a stalled read and never follows it with a write", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          ),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const pending = seedRequest(
      "/admin/content-seeding/batches",
      parseSeedCreation,
      actor,
      new AbortController().signal,
      { method: "POST" },
    );
    const assertion = expect(pending).rejects.toMatchObject({
      writeStarted: false,
      authorityLost: true,
    });
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
