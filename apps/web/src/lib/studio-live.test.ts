import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStudioLive,
  getEncoderCredentials,
  getStudioLive,
  liveSessionInput,
  parseStudioLiveSnapshot,
  setStudioLiveChat,
  StudioLiveRequestError,
  syncStudioLive,
} from "./studio-live";
const streamId = "11111111-1111-4111-8111-111111111111",
  channelId = "22222222-2222-4222-8222-222222222222";
const stream = {
  id: streamId,
  channelId,
  slug: "session",
  title: "Session",
  status: "DRAFT",
  providerStreamId: null,
  scheduledStartAt: null,
  chatEnabled: true,
};
const snapshot = {
  channel: { id: channelId, name: "Channel", handle: "channel" },
  provider: { configured: false, productionEnabled: false },
  streams: [stream],
  nextCursor: null,
};
const signal = () => new AbortController().signal;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Studio Live client boundaries", () => {
  it("trims titles and rejects invalid, rolled-over and past schedule dates before submission", () => {
    expect(liveSessionInput("  Session  ", "")).toEqual({ title: "Session" });
    for (const [title, start] of [
      [" ", ""],
      ["x".repeat(201), ""],
      ["Session", "bad-date"],
      ["Session", "2030-02-31T10:30"],
      ["Session", "2000-01-01T10:30"],
    ])
      expect(() => liveSessionInput(title!, start!)).toThrow();
    expect(liveSessionInput("Session", "2035-09-28T10:30:00Z").scheduledStartAt).toBe(
      "2035-09-28T10:30:00.000Z",
    );
  });
  it("uses authenticated uncached reads and exact create/chat requests, propagating caller cancellation", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot)))
      .mockResolvedValueOnce(new Response(JSON.stringify(stream)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ streamId, chatEnabled: false })));
    vi.stubGlobal("fetch", fetch);
    const abort = signal();
    await getStudioLive(abort);
    await createStudioLive(" Session ", "", abort, channelId);
    await setStudioLiveChat(streamId, false, abort);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: "include", cache: "no-store" });
    expect(fetch.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ title: "Session" }),
    });
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    });
  });
  it.each([401, 403, 409, 503])(
    "preserves status %s and flat live errors without replay",
    async (status) => {
      const fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "LIVE_ERROR", message: "Provider unavailable" }), {
          status,
        }),
      );
      vi.stubGlobal("fetch", fetch);
      await expect(syncStudioLive(streamId, signal())).rejects.toMatchObject({
        status,
        message: "Provider unavailable",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("handles nested auth errors and invalid JSON without a false success", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { message: "Sign in" } }), { status: 401 }),
        ),
    );
    await expect(getStudioLive(signal())).rejects.toBeInstanceOf(StudioLiveRequestError);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("invalid")));
    await expect(getStudioLive(signal())).rejects.toThrow("could not be verified");
  });
  it("never repeats a lost credential request and rejects incomplete or foreign credentials", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Network unavailable"));
    vi.stubGlobal("fetch", fetch);
    await expect(getEncoderCredentials("stream/id", true, signal())).rejects.toThrow(
      "Network unavailable",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toContain("/stream%2Fid/rotate-key");
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ stream, encoder: { rtmps: { serverUrl: "rtmps://fixture" } } }),
      ),
    );
    await expect(getEncoderCredentials(streamId, false, signal())).rejects.toThrow(
      "could not be verified",
    );
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          stream: { ...stream, id: channelId },
          encoder: { rtmps: { serverUrl: "rtmps://fixture", streamKey: "key" } },
        }),
      ),
    );
    await expect(getEncoderCredentials(streamId, false, signal())).rejects.toThrow(
      "could not be verified",
    );
  });
  it("accepts only matching acknowledged chat state and bounded owned create/sync identities", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ streamId: channelId, chatEnabled: false })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ streamId, chatEnabled: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...stream, channelId: streamId })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            stream: { ...stream, id: channelId },
            evidence: { state: "IDLE", playable: false },
          }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(setStudioLiveChat(streamId, false, signal())).rejects.toThrow(
      "could not be verified",
    );
    await expect(setStudioLiveChat(streamId, false, signal())).rejects.toThrow(
      "could not be verified",
    );
    await expect(createStudioLive("Session", "", signal(), channelId)).rejects.toThrow(
      "could not be verified",
    );
    await expect(syncStudioLive(streamId, signal())).rejects.toThrow("could not be verified");
  });
  it("validates bounded pages/cursors and strips provider/diagnostic fields", () => {
    expect(parseStudioLiveSnapshot(snapshot).streams[0]).not.toHaveProperty("channelId");
    for (const value of [
      { ...snapshot, streams: Array(21).fill(stream) },
      { ...snapshot, streams: [stream, stream] },
      { ...snapshot, nextCursor: streamId },
      { ...snapshot, streams: [{ ...stream, status: "INVENTED" }] },
    ])
      expect(() => parseStudioLiveSnapshot(value)).toThrow();
  });
  it("expires stalled reads at15s and writes at30s without automatic replay", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url: unknown, options: RequestInit) =>
        new Promise((_resolve, reject) =>
          options.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          }),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const read = getStudioLive(signal());
    const rejectedRead = expect(read).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(15000);
    await rejectedRead;
    const write = createStudioLive("Session", "", signal());
    const rejectedWrite = expect(write).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(30000);
    await rejectedWrite;
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("aborts a pending read when its caller leaves without replay", async () => {
    const fetch = vi.fn(
      (_url: unknown, options: RequestInit) =>
        new Promise((_resolve, reject) =>
          options.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          }),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const read = getStudioLive(controller.signal);
    const rejected = expect(read).rejects.toThrow("aborted");
    controller.abort();
    await rejected;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
