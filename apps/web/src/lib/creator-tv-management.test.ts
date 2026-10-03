import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getTvManagement,
  getManagedTvStatus,
  parseTvManagement,
  parseTvPreferenceAck,
  saveTvPreference,
  tvPreferenceInput,
  type TvSnapshot,
} from "./creator-tv-management";
const accountId = "00000000-0000-4000-8000-000000000001",
  channelId = "00000000-0000-4000-8000-000000000002",
  tvId = "00000000-0000-4000-8000-000000000003",
  videoId = "00000000-0000-4000-8000-000000000004";
function data() {
  return {
    channel: { id: channelId, name: "Actual channel", handle: "actual-channel" },
    tv: { id: tvId, name: "Actual TV", status: "ACTIVE" },
    automation: {
      platformEnabled: false,
      channelAutoAddEnabled: false,
      channelScheduleEnabled: false,
      rotationMode: "PRIORITY_ORDER_OLDEST",
      fallbackDurationMs: 900000,
      guideWindowMinutes: 240,
    },
    videos: [
      {
        id: videoId,
        title: "Actual video",
        description: null,
        publishedAt: null,
        durationMs: null,
        effectiveDurationMs: 900000,
        included: false,
        priority: 0,
        sortOrder: 0,
        source: { objectKey: "internal/storage", mimeType: "video/mp4" },
      },
    ],
  };
}
const identity = { account: { id: accountId }, channel: { id: channelId } };
const snapshot = (): TvSnapshot => ({ ...parseTvManagement(data(), channelId), accountId });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Creator TV management boundaries", () => {
  it("preserves actual false, zero and unavailable durations without exposing storage metadata", () => {
    const result = parseTvManagement(data(), channelId);
    expect(result.videos[0]).toMatchObject({
      included: false,
      priority: 0,
      sortOrder: 0,
      durationMs: null,
    });
    expect(result.videos[0]).not.toHaveProperty("source");
    expect(result.automation.channelAutoAddEnabled).toBe(false);
  });
  it("rejects foreign channels, duplicate videos and invalid observed dates", () => {
    expect(() => parseTvManagement(data(), accountId)).toThrow();
    const duplicated = data();
    duplicated.videos.push(duplicated.videos[0]!);
    expect(() => parseTvManagement(duplicated, channelId)).toThrow();
    expect(() =>
      parseTvManagement(
        { ...data(), videos: [{ ...data().videos[0], publishedAt: "invalid" }] },
        channelId,
      ),
    ).toThrow();
  });
  it("distinguishes optional automatic order from explicit zero and rejects blank or fractional priority", () => {
    expect(tvPreferenceInput(false, "0", "")).toEqual({
      included: false,
      priority: 0,
      sortOrder: null,
    });
    expect(tvPreferenceInput(true, "-100000", "0").sortOrder).toBe(0);
    for (const priority of ["", "1.5", "1e2", "100001", "-100001"])
      expect(() => tvPreferenceInput(true, priority, "")).toThrow();
    for (const order of ["-1", "1000001", "1.5"])
      expect(() => tvPreferenceInput(true, "0", order)).toThrow();
  });
  it("only accepts a matching video and exact acknowledged preference", () => {
    const input = tvPreferenceInput(true, "10", "0"),
      ack = { preference: { ...input, videoId, updatedAt: "2026-10-03T00:00:00.000Z" } };
    expect(parseTvPreferenceAck(ack, videoId, input).sortOrder).toBe(0);
    expect(() => parseTvPreferenceAck(ack, channelId, input)).toThrow();
    expect(() => parseTvPreferenceAck(ack, videoId, { ...input, included: false })).toThrow();
  });
  it("rejects a changed actual identity before a PUT is sent", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ...identity, account: { id: tvId } }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveTvPreference(
        snapshot(),
        videoId,
        { included: true, priority: 0, sortOrder: null },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 403, writeStarted: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.method).toBeUndefined();
  });
  it("hides a completed management snapshot if the account changes during its read", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(identity))
      .mockResolvedValueOnce(Response.json(data()))
      .mockResolvedValueOnce(Response.json({ ...identity, account: { id: tvId } }));
    vi.stubGlobal("fetch", fetch);
    await expect(getTvManagement(new AbortController().signal)).rejects.toMatchObject({
      status: 403,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("does not display broadcast status obtained across an account switch", async () => {
    const status = {
      tvChannelId: tvId,
      checkedAt: "2026-10-03T00:00:00.000Z",
      output: {
        configured: false,
        status: "UNCONFIGURED",
        available: false,
        lastPlanGeneratedAt: null,
        lastManifestAt: null,
      },
      schedule: { generatedAt: "2026-10-03T00:00:00.000Z", programCount: 0 },
      fallback: { strategy: "PROGRESSIVE_MP4", enabled: true },
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(identity))
      .mockResolvedValueOnce(Response.json(status))
      .mockResolvedValueOnce(Response.json({ ...identity, account: { id: tvId } }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      getManagedTvStatus(tvId, { accountId, channelId }, new AbortController().signal),
    ).rejects.toMatchObject({ status: 403 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("bounds an actual stalled read and never retries it", async () => {
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
    const observed = getTvManagement(new AbortController().signal).catch((error) => error);
    await vi.advanceTimersByTimeAsync(15000);
    expect((await observed).name).toBe("AbortError");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
