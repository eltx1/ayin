import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { adminAdvertisingAr, adminAdvertisingEn } from "@/lib/i18n/resources/admin-advertising";
import { AdminAdvertisingNavigation } from "./admin-advertising-navigation";

describe("Advertising route navigation", () => {
  it("preserves both canonical destinations, the locale and exactly one current route", () => {
    for (const locale of ["en", "ar"] as const) {
      for (const current of ["page", "video"] as const) {
        const html = renderToStaticMarkup(
          <I18nProvider locale={locale}>
            <AdminAdvertisingNavigation current={current} />
          </I18nProvider>,
        );
        const prefix = locale === "ar" ? "/ar" : "";
        expect(html).toContain(`href="${prefix}/admin/advertising"`);
        expect(html).toContain(`href="${prefix}/admin/video-ads"`);
        expect(html.match(/aria-current="page"/g)).toHaveLength(1);
        expect(html).not.toContain('role="tab"');
        expect(html).not.toContain("<main");
        expect(html).not.toContain("<h1");
      }
    }
  });
  it("has matching nonempty route-local EN/AR vocabulary and states localization limits", () => {
    expect(Object.keys(adminAdvertisingAr).sort()).toEqual(Object.keys(adminAdvertisingEn).sort());
    for (const value of Object.values(adminAdvertisingAr)) expect(value.trim()).not.toBe("");
    expect(adminAdvertisingAr.legacyEditor).toContain("الإنجليزية");
  });
});
