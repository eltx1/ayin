import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicDirectory } from "./public-directory";

vi.mock("@/lib/trusted-region", () => ({
  trustedApiRegionHeaders: async () => ({ "x-ayin-edge-country": "JP" }),
}));
afterEach(() => vi.unstubAllGlobals());
const cursor = "00000000-0000-4000-8000-000000000024";
const nextCursor = "00000000-0000-4000-8000-000000000048";
const page = {
  items: [
    {
      id: "movie",
      title: "رحلة",
      slug: "journey",
      releaseYear: 2026,
      runtimeMinutes: 90,
      poster: null,
    },
  ],
  nextCursor,
};

describe("catalog directory search navigation", () => {
  it("preserves the Arabic query on paging/retry while a new native search resets the cursor", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(page)));
    vi.stubGlobal("fetch", fetcher);
    const html = renderToStaticMarkup(
      await PublicDirectory({ section: "movies", locale: "ar", query: " رحلة ", cursor }),
    );
    const endpoint = new URL(fetcher.mock.calls[0]![0]);
    expect(endpoint.searchParams.get("q")).toBe("رحلة");
    expect(endpoint.searchParams.get("cursor")).toBe(cursor);
    expect(html).toContain('action="/ar/movies"');
    expect(html).toContain('method="get"');
    expect(html).toContain('name="q"');
    expect(html).not.toContain('name="cursor"');
    expect(html).toContain(
      `href="/ar/movies?q=${encodeURIComponent("رحلة")}&amp;cursor=${nextCursor}"`,
    );
    expect(html).toContain(`href="/ar/movies?q=${encodeURIComponent("رحلة")}"`);
    expect(html).toContain('href="/ar/movies/journey"');
    expect(html).toContain("ابحث في الأفلام");
    fetcher.mockRejectedValue(new Error("unavailable"));
    const failed = renderToStaticMarkup(
      await PublicDirectory({ section: "movies", locale: "ar", query: "رحلة", cursor }),
    );
    expect(failed).toContain(
      `href="/ar/movies?q=${encodeURIComponent("رحلة")}&amp;cursor=${cursor}"`,
    );
    expect(failed).toContain("تعذّر تحميل هذه الصفحة");
    expect(failed).not.toContain("لا توجد عناوين مطابقة");
  });
  it("distinguishes no matches and rejects malformed queries without making a broad fetch", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null })));
    vi.stubGlobal("fetch", fetcher);
    const empty = renderToStaticMarkup(
      await PublicDirectory({ section: "series", locale: "en", query: "missing" }),
    );
    expect(empty).toContain("No matching titles");
    expect(empty).toContain("Clear search");
    for (const query of [["one", "two"], "x".repeat(101)]) {
      fetcher.mockClear();
      const invalid = renderToStaticMarkup(
        await PublicDirectory({ section: "series", locale: "en", query }),
      );
      expect(invalid).toContain("Use a search of up to 100 characters");
      expect(fetcher).not.toHaveBeenCalled();
    }
  });
});
