import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { changedCatalogFields, draftChanged } from "./catalog-editor-workspace";
import { AdminMovieCatalog } from "./admin-movie-catalog";
import { AdminSeriesCatalog } from "./admin-series-catalog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("./admin-access", () => {
  const lease = {
    epoch: 1,
    session: {
      accountId: "test",
      sessionId: "test-session",
      authVersion: 0,
      roles: ["OPERATIONS"],
    },
  };
  return {
    useAdminAccess: () => ({
      getScopeLease: () => lease,
      getScopedDraft: () => null,
      setScopedDraft: () => true,
      subscribeScopeInvalidation: () => () => {},
      invalidateScope: () => {},
    }),
  };
});
describe("bounded catalog draft contracts", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("server renders a neutral access notice without consulting browser identity", () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="en">
        <AdminMovieCatalog />
      </I18nProvider>,
    );
    expect(html).toContain("Catalog data is hidden");
    expect(html).not.toContain("Movie details");
  });
  it("only patches changed fields, preserving hidden precision and metadata", () => {
    const before = {
      title: "Original",
      releaseDate: "2035-01-01T12:01",
      artwork: [{ type: "POSTER", mediaAssetId: "asset", altText: "Authored alt text" }],
      availability: [{ startsAt: "2035-01-01T12:01" }],
    };
    expect(changedCatalogFields(before, { ...before, title: "Changed" })).toEqual({
      title: "Changed",
    });
    expect(changedCatalogFields(before, structuredClone(before))).toEqual({});
    expect(draftChanged(before, { ...before, artwork: [] })).toBe(true);
  });
  for (const locale of ["en", "ar"] as const) {
    it(`keeps native movie and series fields accessible in ${locale}`, () => {
      vi.stubGlobal("document", {});
      const movie = renderToStaticMarkup(
        <I18nProvider locale={locale}>
          <AdminMovieCatalog />
        </I18nProvider>,
      );
      const series = renderToStaticMarkup(
        <I18nProvider locale={locale}>
          <AdminSeriesCatalog />
        </I18nProvider>,
      );
      for (const html of [movie, series]) {
        expect(html).toContain(`dir="${locale === "ar" ? "rtl" : "ltr"}"`);
        expect(html).toContain(locale === "ar" ? "اسم الرابط" : "Slug");
        expect(html).toContain(locale === "ar" ? "اللغة الأصلية" : "Original language");
        expect(html).toContain(locale === "ar" ? "إضافة قاعدة" : "Add rule");
        expect(html).toContain(locale === "ar" ? "تصفية حسب الحالة" : "Filter by status");
        expect(html).not.toContain("test-session");
        expect(html).not.toContain("<dialog");
      }
      expect(movie).toContain(locale === "ar" ? "المدة بالدقائق" : "Runtime (minutes)");
      expect(movie).toContain(locale === "ar" ? "الفيديو الأساسي" : "Primary playback");
      expect(series).toContain(locale === "ar" ? "إعلان المسلسل" : "Series trailer");
    });
  }
});
