import { describe, expect, it } from "vitest";
import { translateCatalogDetail } from "./catalog-detail";
import { translatePublicDiscovery } from "./public-discovery";
import { catalogDetailAr, catalogDetailEn } from "./resources/catalog-detail";
import { publicDiscoveryAr, publicDiscoveryEn } from "./resources/public-discovery";

describe("route-scoped public discovery and catalog copy", () => {
  it("keeps complete Arabic and English key parity", () => {
    expect(Object.keys(publicDiscoveryAr)).toEqual(Object.keys(publicDiscoveryEn));
    expect(Object.keys(catalogDetailAr)).toEqual(Object.keys(catalogDetailEn));
    for (const text of [...Object.values(publicDiscoveryAr), ...Object.values(catalogDetailAr)])
      expect(text.trim()).not.toBe("");
  });
  it("localizes entity labels and interpolates supplied authored content unchanged", () => {
    expect(translatePublicDiscovery("ar", "type.MOVIE")).toBe("فيلم");
    expect(translatePublicDiscovery("en", "hero.CHANNEL.action")).toBe("Explore channel");
    expect(translateCatalogDetail("ar", "catalog.poster", { title: "Original film title" })).toBe(
      "ملصق Original film title",
    );
    expect(translateCatalogDetail("ar", "series.season", { count: "٢" })).toBe("الموسم ٢");
    expect(translateCatalogDetail("ar", "catalog.minutes", { count: "١١٨" })).toBe("١١٨ دقيقة");
  });
});
