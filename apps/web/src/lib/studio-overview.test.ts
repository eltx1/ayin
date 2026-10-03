import { describe, expect, it } from "vitest";
import { parseStudioOverview } from "./studio-overview";
import { studioOverviewAr, studioOverviewEn } from "./i18n/resources/studio-overview";
const snapshot = () => ({
  channel: { id: "channel-1", name: "Creator" },
  counters: { videos: 12, publishedVideos: 8, subscribers: 2, comments: 3, playlists: 1 },
  recentUploads: [{ id: "video-1", title: "My video", status: "PUBLISHED" }],
  monetization: { contractStatus: "ACTIVE", revenueShareBps: 7000 },
});
describe("Studio overview public presentation contract", () => {
  it("preserves real counts, statuses and nullable creator share", () => {
    expect(parseStudioOverview(snapshot())).toEqual(snapshot());
    const data = snapshot();
    expect(
      parseStudioOverview({
        ...data,
        monetization: { ...data.monetization, revenueShareBps: null },
      }).monetization.revenueShareBps,
    ).toBeNull();
  });
  it.each([-1, NaN, Infinity, 1.5, "12", null])(
    "rejects invalid counters %s instead of showing a fake zero",
    (count) => {
      const data = snapshot();
      expect(() =>
        parseStudioOverview({ ...data, counters: { ...data.counters, videos: count } }),
      ).toThrow();
    },
  );
  it("rejects missing data, unbounded duplicate uploads, unknown statuses and invalid revenue share", () => {
    const data = snapshot();
    for (const value of [
      {},
      { ...data, recentUploads: [data.recentUploads[0], data.recentUploads[0]] },
      {
        ...data,
        recentUploads: Array.from({ length: 7 }, (_, i) => ({
          ...data.recentUploads[0],
          id: String(i),
        })),
      },
      { ...data, recentUploads: [{ ...data.recentUploads[0], status: "UNKNOWN" }] },
      { ...data, monetization: { contractStatus: "ACTIVE", revenueShareBps: 10001 } },
    ])
      expect(() => parseStudioOverview(value)).toThrow();
  });
  it("does not propagate extra internal fields", () => {
    expect(parseStudioOverview({ ...snapshot(), credentials: "internal" })).not.toHaveProperty(
      "credentials",
    );
  });
  it("covers the same keys in English and Arabic", () => {
    expect(Object.keys(studioOverviewAr).sort()).toEqual(Object.keys(studioOverviewEn).sort());
  });
});
