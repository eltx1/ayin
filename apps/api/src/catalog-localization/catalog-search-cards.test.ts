import { describe, expect, it, vi } from "vitest";
import { CatalogLocalizationService } from "./catalog-localization.service.js";

function service(kind: "MOVIE" | "SERIES", rows: unknown[], assets: unknown[] = []) {
  const findRows = vi.fn().mockResolvedValue(rows);
  const findAssets = vi.fn().mockResolvedValue(assets);
  const client = {
    movieLocalization: { findMany: findRows },
    seriesLocalization: { findMany: findRows },
    mediaAsset: { findMany: findAssets },
  };
  const localization = new CatalogLocalizationService({ client } as never, {} as never);
  return {
    findRows,
    findAssets,
    localize: (
      items: Array<{ id: string; title: string; poster?: { objectKey: string } | null }>,
      locale: string,
    ) => localization.localizeCatalogCards(kind, items, locale),
  };
}

describe("batched catalog search copy", () => {
  it("loads translated copy and validated artwork in bounded shared reads", async () => {
    const cards = Array.from({ length: 110 }, (_, index) => ({
      id: `film-${index}`,
      title: `Original ${index}`,
    }));
    const fixture = service(
      "MOVIE",
      cards.map((card) => ({
        movieId: card.id,
        locale: "ar",
        title: `رحلة ${card.id}`,
        posterMediaAssetId: "poster",
        backdropMediaAssetId: null,
      })),
      [
        {
          id: "poster",
          r2ObjectKey: "catalog/arabic-poster.png",
          mimeType: "image/png",
          width: 400,
          height: 600,
        },
      ],
    );
    const result = await fixture.localize(cards, "ar");
    expect(result).toHaveLength(110);
    expect(result[109]).toMatchObject({
      title: "رحلة film-109",
      poster: { objectKey: "catalog/arabic-poster.png" },
    });
    expect(fixture.findRows).toHaveBeenCalledTimes(1);
    expect(fixture.findAssets).toHaveBeenCalledTimes(1);
    expect(fixture.findAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          removedAt: null,
          status: "VALIDATED",
          mimeType: { startsWith: "image/", mode: "insensitive" },
        }),
      }),
    );
  });
  it("keeps requested, original and English artwork fallback order for series cards", async () => {
    const fixture = service(
      "SERIES",
      [
        {
          seriesId: "show",
          locale: "ar",
          title: null,
          posterMediaAssetId: "unavailable",
          backdropMediaAssetId: null,
        },
        {
          seriesId: "show",
          locale: "en",
          title: "English copy",
          posterMediaAssetId: "english",
          backdropMediaAssetId: null,
        },
      ],
      [
        {
          id: "english",
          r2ObjectKey: "catalog/english.png",
          mimeType: "image/png",
          width: 400,
          height: 600,
        },
      ],
    );
    const original = await fixture.localize(
      [{ id: "show", title: "Original title", poster: { objectKey: "catalog/original.png" } }],
      "ar",
    );
    expect(original[0]).toMatchObject({
      title: "Original title",
      poster: { objectKey: "catalog/original.png" },
    });
    const fallback = await fixture.localize(
      [{ id: "show", title: "Original title", poster: null }],
      "ar",
    );
    expect(fallback[0]?.poster?.objectKey).toBe("catalog/english.png");
  });
  it("does no localization or asset work for an empty eligible catalog", async () => {
    const fixture = service("MOVIE", []);
    expect(await fixture.localize([], "ar")).toEqual([]);
    expect(fixture.findRows).not.toHaveBeenCalled();
    expect(fixture.findAssets).not.toHaveBeenCalled();
  });
});
