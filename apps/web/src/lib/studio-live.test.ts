import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStudioLive,
  getEncoderCredentials,
  getStudioLive,
  liveSessionInput,
  setStudioLiveChat,
  StudioLiveRequestError,
  syncStudioLive,
} from "./studio-live";
afterEach(() => vi.unstubAllGlobals());
const signal = () => new AbortController().signal;
describe("Studio Live client boundaries", () => {
  it("trims titles and validates dates before submission", () => {
    expect(liveSessionInput("  Session  ", "")).toEqual({ title: "Session" });
    expect(() => liveSessionInput(" ", "")).toThrow();
    expect(() => liveSessionInput("x".repeat(201), "")).toThrow();
    expect(() => liveSessionInput("Session", "bad-date")).toThrow();
    expect(liveSessionInput("Session", "2026-09-28T10:30:00Z").scheduledStartAt).toBe(
      "2026-09-28T10:30:00.000Z",
    );
  });
  it("uses authenticated uncached reads and exact create/chat requests", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ id: "id", streamId: "id", chatEnabled: false })),
      );
    vi.stubGlobal("fetch", fetch);
    const abort = signal();
    await getStudioLive(abort);
    await createStudioLive(" Session ", "", abort);
    await setStudioLiveChat("id", false, abort);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include",
      cache: "no-store",
      signal: abort,
    });
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
      await expect(syncStudioLive("id", signal())).rejects.toMatchObject({
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
  it("never repeats a lost credential request and rejects incomplete credentials", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Network unavailable"));
    vi.stubGlobal("fetch", fetch);
    await expect(getEncoderCredentials("stream/id", true, signal())).rejects.toThrow(
      "Network unavailable",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toContain("/stream%2Fid/rotate-key");
    fetch.mockResolvedValue(
      new Response(JSON.stringify({ encoder: { rtmps: { serverUrl: "rtmps://fixture" } } })),
    );
    await expect(getEncoderCredentials("id", false, signal())).rejects.toThrow(
      "could not be verified",
    );
  });
  it("rejects an unverifiable chat result instead of reporting a saved setting", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ streamId: "other", chatEnabled: false }))),
    );
    await expect(setStudioLiveChat("id", false, signal())).rejects.toThrow("could not be verified");
  });
});
