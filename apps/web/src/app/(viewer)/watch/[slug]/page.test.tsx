import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicPlaybackResponse } from "@/lib/ayin-player";
import type { PublicSeriesContext } from "@/lib/series-catalog";

const state = vi.hoisted(() => ({ locale: "ar", player: vi.fn(), seo: vi.fn(), region: vi.fn() }));
vi.mock("@/lib/i18n/server", () => ({ getRequestLocale: async () => state.locale }));
vi.mock("@/lib/trusted-region", () => ({
  trustedApiRegionHeaders: state.region,
}));
vi.mock("@/lib/seo-content", () => ({ getSeoVideo: state.seo }));
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
import WatchPage, { generateMetadata } from "./page";
import { WatchContent } from "./watch-client";
import { I18nProvider } from "@/components/i18n/i18n-provider";
vi.mock("@/components/viewer/viewer-product-context", () => ({
  useViewerProduct: () => ({
    identity: null,
    identityRevision: 0,
    audienceStatus: "loading",
    isAudienceCurrent: () => false,
    retryNavigation: () => undefined,
    onAudienceInvalidated: () => () => undefined,
  }),
}));
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
    viewer: { isKids: false },
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
beforeEach(() => {
  state.locale = "ar";
  state.player.mockClear();
  state.seo.mockReset().mockResolvedValue(null);
  state.region.mockReset().mockResolvedValue({ "x-ayin-edge-country": "JP" });
});
afterEach(() => vi.unstubAllGlobals());
const renderContent = (
  series: PublicSeriesContext | null,
  explicitKids = false,
  serverKids = false,
) =>
  renderToStaticMarkup(
    <I18nProvider locale={state.locale as "en" | "ar"}>
      <WatchContent
        data={{ ...playback(series), viewer: { isKids: serverKids } }}
        explicitKids={explicitKids}
      />
    </I18nProvider>,
  );

describe("Watch current audience boundary", () => {
  it.each([{}, { kids: "1" }])(
    "renders only a neutral boundary and metadata before verification: %j",
    async (query) => {
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      const html = renderToStaticMarkup(
        <I18nProvider locale="en">
          {await WatchPage({
            params: Promise.resolve({ slug: "adult-video" }),
            searchParams: Promise.resolve(query),
          })}
        </I18nProvider>,
      );
      const metadata = await generateMetadata({
        params: Promise.resolve({ slug: "adult-video" }),
        searchParams: Promise.resolve(query),
      });
      expect(html).toContain('role="status"');
      for (const forbidden of [
        "<video",
        "video.mp4",
        "Raw video",
        "application/ld+json",
        "/c/",
        "Comments",
      ])
        expect(html).not.toContain(forbidden);
      expect(metadata).not.toHaveProperty("openGraph");
      expect(fetcher).not.toHaveBeenCalled();
      expect(state.player).not.toHaveBeenCalled();
    },
  );
});

describe("Watch neutral SEO indexability", () => {
  const source = {
    slug: "public-video",
    visibility: "PUBLIC",
    title: "Restricted adult title",
    description: "Restricted adult synopsis",
    channel: { name: "Restricted creator", handle: "restricted-creator" },
    thumbnail: { objectKey: "restricted-poster.png" },
    source: { objectKey: "restricted-source.mp4" },
  };
  const metadata = (kids = false) =>
    generateMetadata({
      params: Promise.resolve({ slug: "public-video" }),
      searchParams: Promise.resolve(kids ? { kids: "1" } : {}),
    });
  it.each(["en", "ar"])(
    "preserves public indexability and localized canonical with neutral %s metadata",
    async (locale) => {
      state.locale = locale;
      state.seo.mockResolvedValue(source);
      const result = await metadata();
      expect(state.seo).toHaveBeenCalledWith("public-video", { "x-ayin-edge-country": "JP" });
      expect(result.robots).toMatchObject({ index: true, follow: true });
      expect(result.alternates?.canonical).toMatch(
        new RegExp(`${locale === "ar" ? "/ar" : ""}/watch/public-video$`),
      );
      expect(result.title).not.toBe(source.title);
      expect(Object.keys(result).sort()).toEqual(["alternates", "robots", "title"]);
      const serialized = JSON.stringify(result);
      for (const forbidden of [
        source.title,
        source.description,
        source.channel.name,
        source.channel.handle,
        source.thumbnail.objectKey,
        source.source.objectKey,
        "openGraph",
        "twitter",
        "application/ld+json",
      ])
        expect(serialized).not.toContain(forbidden);
    },
  );
  it.each([null, { ...source, visibility: "UNLISTED" }, { ...source, visibility: "UNKNOWN" }])(
    "keeps unavailable or nonpublic sources noindex: %j",
    async (response) => {
      state.seo.mockResolvedValue(response);
      expect((await metadata()).robots).toMatchObject({ index: false });
    },
  );
  it("fails noindex when the existing availability authority is unavailable", async () => {
    state.seo.mockRejectedValue(new Error("Availability could not be verified"));
    const result = await metadata();
    expect(result.robots).toMatchObject({ index: false });
    expect(result).not.toHaveProperty("alternates");
  });
  it("keeps explicit Kids noindex without fetching public source metadata", async () => {
    state.seo.mockResolvedValue(source);
    expect((await metadata(true)).robots).toMatchObject({ index: false });
    expect(state.seo).not.toHaveBeenCalled();
    expect(state.region).not.toHaveBeenCalled();
  });
});

describe("Watch catalog episode navigation", () => {
  it("shows localized context and explicit cross-season navigation without changing player ownership or autoplay-next", () => {
    const html = renderContent(context);
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
  it("offers the series return at the last available episode and omits navigation on creator videos", () => {
    state.locale = "en";
    const last = renderContent({ ...context, nextEpisode: null });
    expect(last).toContain("You are watching the last available episode.");
    expect(last).toContain('href="/series/journey?season=1"');
    expect(last).not.toContain("watch-next-episode");
    expect(renderContent(null)).not.toContain("Series episodes");
  });
  it.each([
    [true, false],
    [false, true],
    [true, true],
  ])(
    "suppresses general links and advertising for explicit=%s or current viewer=%s Kids",
    (explicitKids, serverKids) => {
      const html = renderContent(context, explicitKids, serverKids);
      expect(html).not.toContain("/series/");
      expect(html).not.toContain("/watch/episode-two");
      expect(html).not.toContain("/c/");
      expect(state.player.mock.calls[0]![0]).toMatchObject({ advertisingEnabled: false });
    },
  );
  it("preserves captions, chapters and explicit timeline restore in the accepted player", () => {
    const data = playback(null);
    data.video.captions = [
      {
        id: "caption",
        objectKey: "ar.vtt",
        mimeType: "text/vtt",
        label: "العربية",
        language: "ar",
        kind: "CAPTIONS",
        default: true,
      },
    ];
    data.video.chapters = [{ id: "chapter", title: "البداية", startMs: 12000 }];
    renderToStaticMarkup(
      <I18nProvider locale="ar">
        <WatchContent data={data} explicitKids={false} initialPositionMs={0} />
      </I18nProvider>,
    );
    expect(state.player.mock.calls[0]![0]).toMatchObject({
      initialPositionMs: 0,
      captions: [
        { id: "caption", src: "http://127.0.0.1:3001/media/ar.vtt", language: "ar", default: true },
      ],
      chapters: data.video.chapters,
    });
  });
});
