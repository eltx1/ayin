import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublicDirectory, isDirectoryCursor } from "./public-directory";
import { getPublicMovie } from "./movie-catalog";
import { getPublicSeries } from "./series-catalog";

afterEach(() => vi.unstubAllGlobals());
describe("canonical catalog requests", () => {
  it("forwards only the supplied server region context, never revalidates shared rights", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "movie",
              title: "Film",
              slug: "film",
              releaseYear: 2026,
              runtimeMinutes: 90,
              poster: null,
            },
          ],
          nextCursor: null,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const page = await fetchPublicDirectory("movies", "ar", undefined, {
      "x-ayin-edge-country": "JP",
      "x-ayin-edge-token": "fixture-only",
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("/public/movies/directory?locale=ar&limit=24"),
      expect.objectContaining({
        cache: "no-store",
        headers: { "x-ayin-edge-country": "JP", "x-ayin-edge-token": "fixture-only" },
      }),
    );
    expect(fetcher.mock.calls[0]![1]).not.toHaveProperty("next");
    expect(page.items[0]).toMatchObject({
      title: "Film",
      href: "/movies/film",
      meta: "2026 · 90 دقيقة",
    });
  });
  it("distinguishes an upstream failure from a real empty directory", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 503 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: null }))),
    );
    await expect(fetchPublicDirectory("series", "en")).rejects.toThrow("503");
    await expect(fetchPublicDirectory("series", "en")).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });
  it("uses compact series cards and rejects provider/external creator destinations", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              items: [
                {
                  id: "series",
                  title: "Show",
                  slug: "show",
                  releaseYear: null,
                  episodeCount: 3,
                  artwork: [],
                },
              ],
              nextCursor: null,
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              items: [{ id: "tv", href: "https://provider.invalid" }],
              nextCursor: null,
            }),
          ),
        ),
    );
    expect((await fetchPublicDirectory("series", "en")).items[0]).toMatchObject({
      href: "/series/show",
      meta: "3 episodes",
    });
    await expect(fetchPublicDirectory("tv", "en")).rejects.toThrow("Invalid creator destination");
  });
  it("bounds cursors and keeps malformed response cursors out of links", async () => {
    expect(isDirectoryCursor("00000000-0000-4000-8000-000000000001")).toBe(true);
    for (const value of [[], "../account", "abc", "?cursor=bad"])
      expect(isDirectoryCursor(value)).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: "bad" }))),
    );
    await expect(fetchPublicDirectory("creators", "en")).rejects.toThrow(
      "Invalid directory response",
    );
  });
  it("catalog detail errors do not become false 404s, and missing records remain null", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(getPublicMovie("film", "en")).rejects.toThrow("503");
    await expect(getPublicSeries("show", "en")).rejects.toThrow("503");
    fetcher.mockImplementation(async () => new Response("", { status: 404 }));
    await expect(getPublicMovie("film", "en")).resolves.toBeNull();
    await expect(getPublicSeries("show", "en")).resolves.toBeNull();
  });
});
