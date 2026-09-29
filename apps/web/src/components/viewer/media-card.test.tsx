import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MediaCard, MediaCardSkeleton } from "./media-card";

describe("media card image foundation", () => {
  it("keeps a decorative stable fallback under the lazy image and the title in server HTML", () => {
    const html = renderToStaticMarkup(
      <MediaCard
        href="/ar/movies/example"
        title="فيلم عربي"
        meta="2026"
        artworkUrl="https://media.example.test/poster.jpg"
      />,
    );
    expect(html).toContain('data-artwork-fallback="true"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-label="فيلم عربي, 2026"');
    expect(html).toContain('href="/ar/movies/example"');
    expect(html).toContain('data-media-artwork="true"');
  });
  it("never requests an empty image URL or turns the fallback into an interactive element", () => {
    const html = renderToStaticMarkup(
      <MediaCard href="/c/example" title="Creator" variant="landscape" />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain('data-artwork-fallback="true"');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toContain("button");
  });
  it("keeps placeholder skeletons out of the accessibility tree and navigation", () => {
    const html = renderToStaticMarkup(<MediaCardSkeleton />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a ");
  });
});
