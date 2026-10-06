import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { catalogValidationCodes, catalogValidationReason } from "@/lib/catalog-validation-copy";
import { CatalogValidationIssues } from "./catalog-validation";

describe("native catalog validation copy", () => {
  it("covers every current Movie, Series and episode validation code in both languages", () => {
    expect(catalogValidationCodes.sort()).toEqual(
      [
        "TITLE_REQUIRED",
        "SAFE_SLUG_REQUIRED",
        "INVALID_SLUG",
        "SYNOPSIS_REQUIRED",
        "RELEASE_YEAR_INVALID",
        "RUNTIME_INVALID",
        "MATURITY_REQUIRED",
        "ORIGINAL_LANGUAGE_REQUIRED",
        "LANGUAGE_REQUIRED",
        "GENRE_REQUIRED",
        "POSTER_REQUIRED",
        "PRIMARY_VIDEO_REQUIRED",
        "PRIMARY_VIDEO_NOT_PUBLISHED",
        "PRIMARY_VIDEO_NOT_PUBLIC",
        "PRIMARY_VIDEO_UNAVAILABLE",
        "TRAILER_VIDEO_UNAVAILABLE",
        "ACTIVE_RIGHTS_REQUIRED",
        "PUBLISHED_EPISODE_REQUIRED",
        "PLAYABLE_PUBLISHED_EPISODE_REQUIRED",
        "ACTIVE_AVAILABILITY_REQUIRED",
        "VIDEO_REQUIRED",
        "VIDEO_UNAVAILABLE",
      ].sort(),
    );
    for (const code of catalogValidationCodes) {
      expect(catalogValidationReason(code, "en")).not.toContain(code);
      expect(catalogValidationReason(code, "ar")).toMatch(/[\u0600-\u06ff]/);
    }
  });
  for (const locale of ["en", "ar"] as const)
    it(`renders actionable ${locale} reasons with raw codes only in closed diagnostics`, () => {
      const html = renderToStaticMarkup(
        <I18nProvider locale={locale}>
          <CatalogValidationIssues
            issues={["PRIMARY_VIDEO_REQUIRED", "ACTIVE_RIGHTS_REQUIRED", "NEW_SERVER_CHECK"]}
          />
        </I18nProvider>,
      );
      const [visible, diagnostics] = html.split("<details");
      expect(visible).toContain(catalogValidationReason("PRIMARY_VIDEO_REQUIRED", locale));
      expect(visible).toContain(catalogValidationReason("NEW_SERVER_CHECK", locale));
      expect(visible).not.toContain("PRIMARY_VIDEO_REQUIRED");
      expect(diagnostics).toContain("PRIMARY_VIDEO_REQUIRED");
      expect(diagnostics).toContain("NEW_SERVER_CHECK");
      expect(html).not.toContain(" open=");
    });
});
