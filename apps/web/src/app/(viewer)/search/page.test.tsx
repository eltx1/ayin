import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { SearchResultContent, SearchResults } from "@/components/search/search-results";

vi.mock("@/lib/i18n/server", () => ({ getRequestLocale: async () => "ar" }));
vi.mock("@/lib/channel", () => ({
  mediaAssetUrl: (key: string | null) => (key ? `https://media.example.test/${key}` : null),
}));
vi.mock("@/components/search/search-box", () => ({ SearchBox: () => <div /> }));
vi.mock("@/components/search/search-analytics", () => ({
  SearchAnalytics: () => null,
  SearchResultLinkAnalytics: ({ children }: { children: ReactNode }) => children,
}));
const audience = vi.hoisted(() => ({
  identity: null,
  identityRevision: 0,
  audienceStatus: "loading",
  isAudienceCurrent: () => false,
  retryNavigation: vi.fn(),
}));
vi.mock("@/components/viewer/viewer-product-context", () => ({ useViewerProduct: () => audience }));
import SearchPage from "./page";

afterEach(() => {
  vi.unstubAllGlobals();
  audience.audienceStatus = "loading";
});

describe("search current-audience presentation", () => {
  it("uses validated artwork, localized type labels and locale routes without translating titles", () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="ar">
        <SearchResultContent
          query="original"
          results={{
            query: "original",
            items: [
              {
                id: "m1",
                type: "MOVIE",
                title: "Original authored title",
                href: "/movies/original",
                kicker: "Movie",
                meta: "2026",
                artworkObjectKey: "posters/original.jpg",
              },
            ],
            nextCursor: null,
            emptyMessage: null,
          }}
        />
      </I18nProvider>,
    );
    expect(html).toContain('src="https://media.example.test/posters/original.jpg"');
    expect(html).toContain('href="/ar/movies/original"');
    expect(html).toContain("Original authored title");
    expect(html).toContain("فيلم");
    expect(html).not.toContain(">Movie<");
  });
  it("keeps SSR neutral instead of requesting an unverified public audience", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const page = await SearchPage({ searchParams: Promise.resolve({ q: "original" }) });
    const html = renderToStaticMarkup(<I18nProvider locale="ar">{page}</I18nProvider>);
    expect(fetch).not.toHaveBeenCalled();
    expect(html).toContain('role="status"');
    expect(html).not.toContain("/movies/");
  });
  it("offers a localized unavailable state when audience verification fails", () => {
    audience.audienceStatus = "error";
    const html = renderToStaticMarkup(
      <I18nProvider locale="ar">
        <SearchResults query="original" />
      </I18nProvider>,
    );
    expect(html).toContain("البحث غير متاح");
  });
});
