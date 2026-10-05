import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n/server", () => ({ getRequestLocale: async () => "ar" }));
vi.mock("@/lib/channel", () => ({
  mediaAssetUrl: (key: string | null) => (key ? `https://media.example.test/${key}` : null),
}));
vi.mock("@/components/search/search-box", () => ({ SearchBox: () => <div /> }));
vi.mock("@/components/search/search-analytics", () => ({
  SearchAnalytics: () => null,
  SearchResultLinkAnalytics: ({ children }: { children: ReactNode }) => children,
}));
import SearchPage from "./page";

afterEach(() => vi.unstubAllGlobals());

describe("search public result presentation", () => {
  it("uses validated artwork, localized type labels and locale routes without translating titles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
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
          }),
        ),
      ),
    );
    const html = renderToStaticMarkup(
      await SearchPage({ searchParams: Promise.resolve({ q: "original" }) }),
    );
    expect(html).toContain('src="https://media.example.test/posters/original.jpg"');
    expect(html).toContain('href="/ar/movies/original"');
    expect(html).toContain("Original authored title");
    expect(html).toContain("فيلم");
    expect(html).not.toContain(">Movie<");
  });
  it("offers a localized unavailable state after a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network down")));
    const html = renderToStaticMarkup(
      await SearchPage({ searchParams: Promise.resolve({ q: "original" }) }),
    );
    expect(html).toContain("البحث غير متاح");
  });
});
