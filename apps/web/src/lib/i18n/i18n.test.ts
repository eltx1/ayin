import { describe, expect, it } from "vitest";

import { defaultLocale, getTextDirection } from "./config";
import {
  localeFromPath,
  localeSwitchHref,
  localizePath,
  parseAcceptLanguage,
  resolveLocale,
  resolveRouteLocale,
  stripLocalePrefix,
} from "./routing";
import { localizedAlternates, localizedEntityAlternates, localizedEntitySitemapLinks } from "./seo";
import { translate } from "./translator";

describe("i18n locale resolution", () => {
  it("falls back to English for unsupported locale hints and translates supported Arabic", () => {
    expect(resolveLocale({ acceptLanguage: "fr-FR, de;q=0.8" })).toBe(defaultLocale);
    expect(translate("ar", "shell.productBy")).toBe("منتج من Horus Media");
  });

  it("resolves path before persisted cookie before Accept-Language", () => {
    expect(
      resolveLocale({ pathname: "/ar/movies", cookieLocale: "en", acceptLanguage: "en-US" }),
    ).toBe("ar");
    expect(resolveLocale({ pathname: "/movies", cookieLocale: "ar", acceptLanguage: "en" })).toBe(
      "ar",
    );
    expect(resolveLocale({ pathname: "/movies", acceptLanguage: "ar-EG,en;q=0.8" })).toBe("ar");
  });

  it("honors Accept-Language quality and regional tags as a preference signal", () => {
    expect(parseAcceptLanguage("en-US;q=0.7, ar-EG;q=0.9")).toBe("ar");
    expect(parseAcceptLanguage("fr-FR, en-GB;q=0.8")).toBe("en");
  });

  it("keeps canonical route selection on URL, persisted choice, then English", () => {
    expect(resolveRouteLocale({ pathname: "/ar/movies", cookieLocale: "en" })).toBe("ar");
    expect(resolveRouteLocale({ pathname: "/movies", cookieLocale: "ar" })).toBe("ar");
    expect(resolveRouteLocale({ pathname: "/movies" })).toBe("en");
  });
});

describe("i18n routing", () => {
  it("keeps English canonical routes unprefixed and prefixes non-default locales", () => {
    expect(localizePath("/movies", "en")).toBe("/movies");
    expect(localizePath("/movies", "ar")).toBe("/ar/movies");
    expect(localizePath("/ar/movies?tab=new#grid", "en")).toBe("/movies?tab=new#grid");
    expect(stripLocalePrefix("/ar/series/show?episode=2")).toBe("/series/show?episode=2");
    expect(localeFromPath("/ar/kids")).toBe("ar");
  });

  it("creates explicit locale switch URLs without duplicating route implementations", () => {
    expect(localeSwitchHref("/ar/movies", "en")).toBe("/movies?lang=en");
    expect(localeSwitchHref("/movies", "ar")).toBe("/movies?lang=ar");
  });

  it("exposes direction metadata and canonical/hreflang alternates", () => {
    expect(getTextDirection("en")).toBe("ltr");
    expect(getTextDirection("ar")).toBe("rtl");
    const alternates = localizedAlternates("/movies", "ar");
    expect(alternates.canonical).toMatch(/\/ar\/movies$/);
    expect(alternates.languages.en).toMatch(/\/movies$/);
    expect(alternates.languages.ar).toMatch(/\/ar\/movies$/);
    expect(alternates.languages["x-default"]).toMatch(/\/movies$/);
  });

  it("does not advertise entity hreflang routes for locales without localized metadata", () => {
    const fallback = localizedEntityAlternates("/movies/example", "ar", []);
    expect(fallback.canonical).toMatch(/\/movies\/example$/);
    expect(fallback.languages.ar).toBeUndefined();
    expect(fallback.languages.en).toMatch(/\/movies\/example$/);

    const localized = localizedEntityAlternates("/movies/example", "ar", ["ar"]);
    expect(localized.canonical).toMatch(/\/ar\/movies\/example$/);
    expect(localized.languages.ar).toMatch(/\/ar\/movies\/example$/);

    const links = localizedEntitySitemapLinks("/movies/example", ["fr", "ar"]);
    expect(links.map((link) => link.hreflang)).toEqual(["en", "ar", "x-default"]);
  });
});
