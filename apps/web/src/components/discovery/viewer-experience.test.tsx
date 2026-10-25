import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { WatchRecommendations } from "@/components/viewer/watch-recommendations";
import { HomeSpotlight } from "./home-spotlight";
import { localizedMediaTitle } from "@/lib/home-presentation";

vi.mock("@/lib/channel", () => ({
  mediaAssetUrl: (key: string | null) => (key ? `https://media.ayin.stream/${key}` : null),
}));

const film = {
  id: "film",
  type: "VIDEO" as const,
  title: "الربيع | Spring",
  href: "/watch/spring",
  kicker: "Recently added",
  meta: "Studio · 7:44",
  artworkObjectKey: "spring.jpg",
  durationMs: 464000,
  channelName: "Studio",
  description: "A complete short film.",
};

describe("viewer discovery and watch experience", () => {
  it.each(["en", "ar"] as const)(
    "makes hero artwork, title and action all navigable in %s",
    (locale) => {
      const html = renderToStaticMarkup(
        <I18nProvider locale={locale}>
          <HomeSpotlight item={film} hasMore />
        </I18nProvider>,
      );
      const path = locale === "ar" ? "/ar/watch/spring" : "/watch/spring";
      expect(html.match(new RegExp(`href="${path}"`, "g"))).toHaveLength(3);
      expect(html).toContain("spring.jpg");
      expect(html).toContain('data-tv-focus-id="hero-artwork"');
      expect(html).toContain('data-tv-focus-id="hero-title"');
      expect(html).toContain('href="#discovery"');
    },
  );
  it("shows image and precise duration with recommendations, excluding current and repeated titles", () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="en">
        <WatchRecommendations
          currentId="current"
          channelName="Studio"
          related={[]}
          items={[{ ...film, id: "current" }, film, film]}
        />
      </I18nProvider>,
    );
    expect(html.match(/href="\/watch\/spring"/g)).toHaveLength(1);
    expect(html).toContain("spring.jpg");
    expect(html).toContain("7:44");
    expect(html).toContain("Up next");
    expect(html).not.toContain("undefined");
  });
  it("keeps original names unless an explicit bilingual pair is supplied", () => {
    expect(localizedMediaTitle(film.title, "en")).toBe("Spring");
    expect(localizedMediaTitle(film.title, "ar")).toBe("الربيع");
    expect(localizedMediaTitle("Part one | Part two", "ar")).toBe("Part one | Part two");
    expect(localizedMediaTitle("الفيلم الجديد", "en")).toBe("الفيلم الجديد");
  });
});
