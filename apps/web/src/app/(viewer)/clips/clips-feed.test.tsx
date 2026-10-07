import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { AyinIdentity } from "@/lib/api";
import type { ClipsPage } from "@/lib/clips";
import { translateClips } from "@/lib/i18n/clips";
import { ClipsFeed } from "./clips-feed";

const audience = vi.hoisted(() => ({
  identity: null as AyinIdentity | null,
  identityRevision: 0,
  audienceStatus: "loading" as "loading" | "ready" | "error",
  isIdentityCurrent: () => false,
  isAudienceCurrent: (): boolean => false,
  onBeforeIdentitySuspend: vi.fn(),
  retryNavigation: vi.fn(),
}));
vi.mock("@/components/viewer/viewer-product-context", () => ({ useViewerProduct: () => audience }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./clip-video", () => ({ ClipVideo: () => <video /> }));

const page: ClipsPage = {
  viewer: { isKids: false },
  enabled: true,
  items: [
    {
      id: "clip-1",
      slug: "first-clip",
      title: "First Clip",
      description: null,
      durationMs: 10_000,
      channel: { id: "channel-1", handle: "creator", name: "Creator" },
      mediaAssets: [{ kind: "SOURCE_VIDEO", r2ObjectKey: "clip.mp4" }],
      _count: { reactions: 0 },
    },
  ],
  nextCursor: null,
  autoplayEnabled: false,
  adPolicy: { enabled: false, minimumOrganicClips: 3 },
};

function render(locale: "en" | "ar") {
  const html = renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <ClipsFeed initialPage={page} />
    </I18nProvider>,
  );
  const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map(([tag]) => tag);
  return {
    html,
    like: buttons.find((tag) => tag.includes('data-tv-focus-id="clip-clip-1-like"')),
    subscribe: buttons.find((tag) => tag.includes('data-tv-focus-id="clip-clip-1-subscribe"')),
  };
}

beforeEach(() => {
  audience.identity = null;
  audience.audienceStatus = "loading";
  audience.isAudienceCurrent = () => false;
});

describe("Clips audience readiness", () => {
  it.each(["en", "ar"] as const)(
    "keeps %s social actions disabled until the session is verified",
    (locale) => {
      const view = render(locale);
      expect(view.like).toContain('disabled=""');
      expect(view.subscribe).toContain('disabled=""');
      expect(view.html).toContain(translateClips(locale, "clips.actionsLoading"));
    },
  );

  it.each(["en", "ar"] as const)(
    "presents failed %s verification as unavailable with explicit recovery",
    (locale) => {
      audience.audienceStatus = "error";
      const view = render(locale);
      expect(view.like).toContain('disabled=""');
      expect(view.subscribe).toContain('disabled=""');
      expect(view.html).toContain(translateClips(locale, "clips.actionsUnavailable"));
      expect(view.html).toContain(translateClips(locale, "clips.refreshActions"));
    },
  );

  it("allows sign-in actions only after a current verified anonymous read", () => {
    audience.audienceStatus = "ready";
    audience.isAudienceCurrent = () => true;
    const view = render("en");
    expect(view.like).toBeDefined();
    expect(view.subscribe).toBeDefined();
    expect(view.like).not.toContain('disabled=""');
    expect(view.subscribe).not.toContain('disabled=""');
    expect(view.html).not.toContain(translateClips("en", "clips.actionsLoading"));
  });

  it("does not enable anonymous actions for an expired audience lease", () => {
    audience.audienceStatus = "ready";
    const view = render("en");
    expect(view.like).toContain('disabled=""');
    expect(view.subscribe).toContain('disabled=""');
  });
});

// A final policy/asset recheck may remove all items in a selected page while
// preserving a continuation anchor. The next allowed page must stay reachable.
it("keeps pagination reachable when final revalidation removes a whole page", () => {
  const html = renderToStaticMarkup(
    <I18nProvider locale="en">
      <ClipsFeed
        initialPage={{ ...page, items: [], nextCursor: "00000000-0000-4000-8000-000000000001" }}
      />
    </I18nProvider>,
  );
  expect(html).toContain('data-tv-focus-id="clips-load-more"');
  expect(html).toContain(translateClips("en", "clips.emptyTitle"));
  expect(html).not.toContain("<video");
});
