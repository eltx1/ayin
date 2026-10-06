import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicPlaybackResponse } from "@/lib/ayin-player";
import type { PublicSeriesContext } from "@/lib/series-catalog";

const state = vi.hoisted(() => ({ locale: "ar", player: vi.fn() }));
vi.mock("@/lib/i18n/server", () => ({ getRequestLocale: async () => state.locale }));
vi.mock("@/lib/trusted-region", () => ({
  trustedApiRegionHeaders: async () => ({ "x-ayin-edge-country": "JP" }),
}));
vi.mock("@/lib/seo-content", () => ({ getSeoVideo: async () => null }));
vi.mock("@/lib/channel", () => ({
  mediaAssetUrl: (key: string) => `http://127.0.0.1:3001/media/${key}`,
}));
vi.mock("@/components/player/analytics-ayin-player", () => ({
  AnalyticsAyinPlayer: (props: unknown) => {
    state.player(props);
    return <div />;
  },
}));
vi.mock("@/components/comments/comments-panel", () => ({ CommentsPanel: () => null }));
vi.mock("@/components/social/video-social-actions", () => ({ VideoSocialActions: () => null }));
vi.mock("@/components/ads/page-ad-slot", () => ({ PageAdSlot: () => null }));
import WatchPage from "./page";
const episode = {
  id: "e1",
  episodeNumber: 1,
  title: "البداية",
  synopsis: "قصة البداية",
  sortOrder: 0,
  releaseDate: null,
  publishedAt: null,
  video: {
    id: "v1",
    title: "Raw video",
    slug: "episode-one",
    durationMs: 120000,
    href: "/watch/episode-one",
  },
};
const context: PublicSeriesContext = {
  series: { id: "s", title: "الرحلة", slug: "journey", href: "/series/journey" },
  season: { id: "season", seasonNumber: 1, title: "موسم البداية" },
  episode,
  nextEpisode: {
    ...episode,
    id: "e2",
    title: "العودة",
    seasonNumber: 2,
    video: { ...episode.video, id: "v2", slug: "episode-two", href: "/watch/episode-two" },
  },
};
function playback(series: PublicSeriesContext | null): PublicPlaybackResponse {
  return {
    video: {
      id: "v1",
      slug: "episode-one",
      title: "Raw video",
      description: null,
      durationMs: 120000,
      publishedAt: null,
      channel: { id: "channel", handle: "studio", name: "Studio" },
      source: { objectKey: "video.mp4", mimeType: "video/mp4" },
      adaptiveSource: null,
      captions: [],
      chapters: [],
    },
    detail: {
      saveHook: { action: "WATCH_LATER", available: true },
      commentsSlot: { reserved: true, enabled: true },
      externalAdPlacementKeys: [],
      related: [],
      ...(series
        ? { contentType: "SERIES_EPISODE", seriesContext: series, nextEpisode: series.nextEpisode }
        : { contentType: "CREATOR_VIDEO" }),
    },
    playerPolicy: { progressSaveIntervalMs: 15000, completionThresholdPercent: 90 },
  };
}
function respond(series: PublicSeriesContext | null) {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(playback(series))));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
beforeEach(() => {
  state.locale = "ar";
  state.player.mockClear();
});
afterEach(() => vi.unstubAllGlobals());
describe("Watch catalog episode navigation", () => {
  it("shows localized context and explicit cross-season navigation without changing player ownership or autoplay-next", async () => {
    const fetcher = respond(context);
    const html = renderToStaticMarkup(
      await WatchPage({
        params: Promise.resolve({ slug: "episode-one" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/playback?locale=ar"),
      expect.objectContaining({ headers: { "x-ayin-edge-country": "JP" }, cache: "no-store" }),
    );
    for (const text of ["الرحلة", "البداية", "الحلقة التالية", "الموسم ٢", "العودة"])
      expect(html).toContain(text);
    expect(html).toContain('href="/ar/series/journey?season=1"');
    expect(html).toContain('href="/ar/watch/episode-two"');
    expect(state.player.mock.calls[0]![0]).not.toHaveProperty("onNext");
    expect(state.player.mock.calls[0]![0]).toMatchObject({
      videoId: "v1",
      advertisingEnabled: true,
      progressPolicy: playback(null).playerPolicy,
    });
  });
  it("offers the series return at the last available episode and omits navigation on creator videos", async () => {
    state.locale = "en";
    respond({ ...context, nextEpisode: null });
    const last = renderToStaticMarkup(
      await WatchPage({
        params: Promise.resolve({ slug: "last" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(last).toContain("You are watching the last available episode.");
    expect(last).toContain('href="/series/journey?season=1"');
    expect(last).not.toContain("watch-next-episode");
    respond(null);
    const creator = renderToStaticMarkup(
      await WatchPage({
        params: Promise.resolve({ slug: "creator" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(creator).not.toContain("Series episodes");
  });
  it("suppresses all general catalog links in Kids even if an upstream response contains context", async () => {
    const fetcher = respond(context);
    const html = renderToStaticMarkup(
      await WatchPage({
        params: Promise.resolve({ slug: "kids" }),
        searchParams: Promise.resolve({ kids: "1" }),
      }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("locale=ar&kids=1"),
      expect.anything(),
    );
    expect(html).not.toContain("/series/");
    expect(html).not.toContain("/watch/episode-two");
    expect(state.player.mock.calls[0]![0]).toMatchObject({ advertisingEnabled: false });
  });
});
