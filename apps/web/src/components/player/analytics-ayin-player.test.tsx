import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AyinPlayerAnalytics } from "@/lib/ayin-player";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  track: vi.fn(),
  player: vi.fn(),
}));
vi.mock("@/lib/analytics", () => ({
  createPlayerAnalytics: mocks.create,
  trackAnalyticsEvent: mocks.track,
}));
vi.mock("@/components/viewer/viewer-product-context", () => ({
  useViewerProduct: () => ({ identity: null, identityRevision: 1 }),
}));
vi.mock("./ayin-player", () => ({
  AyinPlayer: (props: unknown) => {
    mocks.player(props);
    return null;
  },
}));
vi.mock("./ad-enabled-ayin-player", () => ({
  AdEnabledAyinPlayer: (props: unknown) => {
    mocks.player(props);
    return null;
  },
}));
import { AnalyticsAyinPlayer, createPlayerAnalyticsSession } from "./analytics-ayin-player";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockImplementation(() => ({ emit: vi.fn() }));
});

describe("player accounting lifetime", () => {
  it.each([false, true])(
    "honors the supplied tracker through ad-enabled=%s player remounts",
    (advertisingEnabled) => {
      const analytics: AyinPlayerAnalytics = { emit: vi.fn() };
      for (let mount = 0; mount < 2; mount++)
        renderToStaticMarkup(
          <AnalyticsAyinPlayer
            videoId="video"
            sourceUrl="/source.mp4"
            title="Video"
            advertisingEnabled={advertisingEnabled}
            analytics={analytics}
          />,
        );
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.player.mock.calls).toHaveLength(2);
      for (const [props] of mocks.player.mock.calls) expect(props.analytics).toBe(analytics);
    },
  );
  it("keeps one impression and tracker for a retained accounting session", () => {
    const session = createPlayerAnalyticsSession("video");
    session.recordImpression();
    session.recordImpression();
    expect(mocks.track.mock.calls).toEqual([["CONTENT_IMPRESSION", { videoId: "video" }]]);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(session.analytics).toBe(mocks.create.mock.results[0]!.value);
  });
  it("new owner or video sessions get independent accounting", () => {
    const first = createPlayerAnalyticsSession("video");
    const replacementViewer = createPlayerAnalyticsSession("video");
    const replacementVideo = createPlayerAnalyticsSession("new-video");
    first.completedAdBreaks.add("PRE_ROLL");
    expect(replacementViewer.completedAdBreaks.size).toBe(0);
    expect(replacementVideo.completedAdBreaks.size).toBe(0);
    for (const session of [first, replacementViewer, replacementVideo]) {
      session.recordImpression();
      session.recordImpression();
    }
    expect(
      new Set([first.analytics, replacementViewer.analytics, replacementVideo.analytics]).size,
    ).toBe(3);
    expect(mocks.track.mock.calls).toEqual([
      ["CONTENT_IMPRESSION", { videoId: "video" }],
      ["CONTENT_IMPRESSION", { videoId: "video" }],
      ["CONTENT_IMPRESSION", { videoId: "new-video" }],
    ]);
  });
  it("keeps the existing default tracker for callers without retained accounting", () => {
    renderToStaticMarkup(
      <AnalyticsAyinPlayer videoId="video" sourceUrl="/source.mp4" title="Video" />,
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.player.mock.calls[0]![0].analytics).toBe(mocks.create.mock.results[0]!.value);
  });
});
