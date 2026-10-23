import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicPlaylistResponse } from "@/lib/playlist";
import type { SeoPlaylistResponse } from "@/lib/seo-content";

const state = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  permanentRedirect: vi.fn((href: string) => {
    throw new Error(`REDIRECT:${href}`);
  }),
}));
vi.mock("next/navigation", () => state);
vi.mock("@/lib/i18n/server", () => ({ getRequestLocale: async () => "ar" }));
vi.mock("@/lib/trusted-region", () => ({
  trustedApiRegionHeaders: async () => ({ "x-ayin-edge-country": "EG" }),
}));
vi.mock("@/lib/api", () => ({ apiBaseUrl: "https://api.example.test" }));

import PublicPlaylistPage, { generateMetadata } from "./page";

const raw = { handle: "نور.أفلام", slug: "أفلام-كلاسيكية-12ab34cd" };
const encoded = {
  handle: encodeURIComponent(raw.handle),
  slug: encodeURIComponent(raw.slug),
};
const publicPath = `/public/channels/${encoded.handle}/playlists/${encoded.slug}`;
const seoPath = `/public/seo/playlists/${encoded.handle}/${encoded.slug}`;
const pagePath = `/ar/c/${encoded.handle}/playlists/${encoded.slug}`;
const channel = { id: "channel", handle: raw.handle, name: "أفلام نور" };
const playlist = {
  id: "playlist",
  slug: raw.slug,
  name: "أفلام كلاسيكية",
  description: null,
  visibility: "PUBLIC" as const,
  systemKey: null,
};
const data: PublicPlaylistResponse = {
  canonicalHandle: raw.handle,
  redirectedFrom: null,
  channel,
  playlist,
  items: [],
};
const seo: SeoPlaylistResponse = {
  ...playlist,
  channel,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  items: [],
};
const props = (segments = encoded, kids = false) => ({
  params: Promise.resolve(segments),
  searchParams: Promise.resolve(kids ? { kids: "1" } : {}),
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("public playlist request boundary", () => {
  it.each([raw, encoded])(
    "encodes API and metadata requests once and preserves database canonical values: %j",
    async (segments) => {
      const fetcher = vi.fn(async (url: string) => {
        if (url === `https://api.example.test${publicPath}`) return Response.json(data);
        if (url === `https://api.example.test${seoPath}`) return Response.json(seo);
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal("fetch", fetcher);

      const metadata = await generateMetadata(props(segments));
      const html = renderToStaticMarkup(await PublicPlaylistPage(props(segments)));

      expect(metadata.title).toBe(playlist.name);
      expect(String(metadata.alternates?.canonical)).toMatch(new RegExp(`${pagePath}$`));
      expect(html).toContain(playlist.name);
      expect(html).toContain(pagePath);
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
        `https://api.example.test${seoPath}`,
        `https://api.example.test${publicPath}`,
        `https://api.example.test${seoPath}`,
      ]);
      expect(fetcher).toHaveBeenCalledWith(
        `https://api.example.test${publicPath}`,
        expect.objectContaining({
          headers: { "x-ayin-edge-country": "EG" },
          cache: "no-store",
        }),
      );
      expect(state.permanentRedirect).not.toHaveBeenCalled();
    },
  );

  it("keeps the Arabic retry and channel links singly encoded and retains kids policy", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);

    const html = renderToStaticMarkup(await PublicPlaylistPage(props(encoded, true)));

    expect(fetcher).toHaveBeenCalledWith(
      `https://api.example.test${publicPath}?kids=1`,
      expect.anything(),
    );
    expect(html).toContain(`href="${pagePath}?kids=1"`);
    expect(html).toContain(`href="/ar/c/${encoded.handle}?kids=1"`);
    expect(html).not.toContain("%25");
  });

  it("retains kids policy on metadata requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(seo));
    vi.stubGlobal("fetch", fetcher);

    const metadata = await generateMetadata(props(encoded, true));

    expect(fetcher).toHaveBeenCalledWith(
      `https://api.example.test${seoPath}?kids=1`,
      expect.anything(),
    );
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it("keeps a renamed channel redirect local and encodes canonical database values once", async () => {
    const canonicalHandle = "نور-الجديدة";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ ...data, redirectedFrom: raw.handle, canonicalHandle })),
    );

    await expect(PublicPlaylistPage(props(encoded, true))).rejects.toThrow("REDIRECT:");
    expect(state.permanentRedirect).toHaveBeenCalledWith(
      `/ar/c/${encodeURIComponent(canonicalHandle)}/playlists/${encoded.slug}?kids=1`,
    );
  });

  it.each(["%", "%D8", "%2F%2Fevil.test", "%5C", "%0A", "%25D8%25A3"])(
    "returns unavailable without requests or redirects for an unsafe route: %s",
    async (slug) => {
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      const segments = { ...encoded, slug };

      await expect(PublicPlaylistPage(props(segments))).rejects.toThrow("NOT_FOUND");
      const metadata = await generateMetadata(props(segments));

      expect(metadata.robots).toMatchObject({ index: false, follow: false });
      expect(metadata).not.toHaveProperty("alternates");
      expect(fetcher).not.toHaveBeenCalled();
      expect(state.permanentRedirect).not.toHaveBeenCalled();
    },
  );
});
