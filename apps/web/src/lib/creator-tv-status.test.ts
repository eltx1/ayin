import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CreatorTvStatusError,
  getCreatorTvStatus,
  parseCreatorTvStatus,
} from "./creator-tv-status";
const snapshot = {
  tvChannelId: "tv-1",
  checkedAt: "2026-09-28T02:00:00Z",
  output: {
    configured: false,
    status: "UNCONFIGURED",
    available: false,
    lastPlanGeneratedAt: null,
    lastManifestAt: null,
  },
  schedule: { generatedAt: "2026-09-28T02:00:00Z", programCount: 0 },
  fallback: { strategy: "PROGRESSIVE_MP4", enabled: true },
};
afterEach(() => vi.unstubAllGlobals());
describe("Creator TV status contract", () => {
  it("rejects another TV snapshot and impossible readiness", () => {
    expect(parseCreatorTvStatus(snapshot, "tv-1").output.available).toBe(false);
    expect(() => parseCreatorTvStatus(snapshot, "other")).toThrow(CreatorTvStatusError);
    expect(() =>
      parseCreatorTvStatus(
        { ...snapshot, output: { ...snapshot.output, available: true } },
        "tv-1",
      ),
    ).toThrow();
    expect(() =>
      parseCreatorTvStatus(
        { ...snapshot, schedule: { ...snapshot.schedule, programCount: -1 } },
        "tv-1",
      ),
    ).toThrow();
  });
  it("uses an abortable private read and preserves auth failure without raw messages", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot)));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    await expect(getCreatorTvStatus("tv-1", signal)).resolves.toEqual(snapshot);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/creator/tv/tv-1/linear/summary"),
      { credentials: "include", cache: "no-store", signal },
    );
    fetcher.mockResolvedValue(new Response("private internal path", { status: 401 }));
    await expect(getCreatorTvStatus("tv-1", signal)).rejects.toMatchObject({
      status: 401,
      message: "Creator TV status could not be loaded.",
    });
  });
});
