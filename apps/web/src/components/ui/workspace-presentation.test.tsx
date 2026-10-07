import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import UploadPage from "@/app/(viewer)/upload/page";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { StudioDashboard } from "@/components/studio/studio-dashboard";
import { ViewerProductProvider } from "@/components/viewer/viewer-product-context";
import { adminDashboardAr, adminDashboardEn } from "@/lib/i18n/resources/admin-dashboard";
import { studioNavigation } from "@/lib/workspace-navigation";
import { WorkspaceSidebar } from "./workspace-sidebar";

const route = vi.hoisted(() => ({ pathname: "/studio/content" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/admin/admin-access", () => ({
  useAdminAccess: () => ({
    session: { accountId: "operator", roles: ["OPERATIONS"] },
    loading: false,
    refresh: vi.fn(),
  }),
}));

describe("workspace presentation entrypoints", () => {
  for (const locale of ["en", "ar"] as const) {
    const prefix = locale === "ar" ? "/ar" : "";

    it(`${locale} upload keeps one main and heading with a native Studio destination`, () => {
      const html = renderToStaticMarkup(
        <I18nProvider locale={locale}>
          <ViewerProductProvider>
            <UploadPage />
          </ViewerProductProvider>
        </I18nProvider>,
      );
      expect(html.match(/<main(?:\s|>)/g)).toHaveLength(1);
      expect(html.match(/<h1(?:\s|>)/g)).toHaveLength(1);
      expect(html).toContain(`href="${prefix}/studio/content"`);
      expect(html).toContain(locale === "ar" ? "إدارة الفيديوهات المحفوظة" : "Manage saved videos");
      expect(html).not.toContain("Review saved uploads in Studio");
      expect(html).not.toContain("مراجعة الفيديوهات المحفوظة في الاستوديو");
      expect(html).toContain('role="radiogroup"');
      expect(html).not.toContain('role="button"');
    });

    it(`${locale} Studio retains one route heading and native loading actions`, () => {
      const html = renderToStaticMarkup(
        <I18nProvider locale={locale}>
          <StudioDashboard />
        </I18nProvider>,
      );
      expect(html.match(/<h1(?:\s|>)/g)).toHaveLength(1);
      expect(html).not.toMatch(/<main(?:\s|>)/);
      expect(html).toContain(`href="${prefix}/upload"`);
      expect(html).toContain('type="button"');
      expect(html).toContain('disabled=""');
      expect(html).not.toContain("<dl");
    });

    it(`${locale} Admin puts bounded search first without expanding role-authorized controls`, () => {
      const copy = locale === "ar" ? adminDashboardAr : adminDashboardEn;
      const html = renderToStaticMarkup(
        <I18nProvider locale={locale}>
          <AdminDashboard />
        </I18nProvider>,
      );
      expect(html.match(/<h1(?:\s|>)/g)).toHaveLength(1);
      expect(html).not.toMatch(/<main(?:\s|>)/);
      expect(html).toContain('role="search"');
      expect(html).toContain('minLength="2"');
      expect(html).toContain('maxLength="200"');
      expect(html.indexOf(`aria-label="${copy.search}"`)).toBeLessThan(
        html.indexOf(`aria-label="${copy.priorities}"`),
      );
      expect(html).toContain(`href="${prefix}/admin/videos"`);
      expect(html).not.toContain(`href="${prefix}/admin/revenue"`);
      expect(html).toContain(copy.financeHidden);
      expect(html).not.toContain("<dl");
    });

    it(`${locale} sidebar identifies the active destination and uses the shared upload action`, () => {
      route.pathname = `${prefix}/studio/content`;
      const html = renderToStaticMarkup(
        <I18nProvider locale={locale}>
          <WorkspaceSidebar kind="studio" groups={studioNavigation} />
        </I18nProvider>,
      );
      const navigation = html.match(/<nav(?:\s|>)[\s\S]*?<\/nav>/g) ?? [];
      // Desktop and closed mobile-dialog navigation each identify the same real destination.
      expect(navigation).toHaveLength(2);
      for (const nav of navigation) {
        expect(nav.match(/aria-current="page"/g)).toHaveLength(1);
      }
      expect(html).not.toMatch(/<dialog[^>]*\sopen(?:=|\s|>)/);
      expect(html).toContain(`href="${prefix}/upload"`);
      expect(html).toContain('data-tone="primary"');
      expect(html).toContain('aria-expanded="true"');
      expect(html).not.toContain('role="button"');
      expect(html).not.toContain("<main");
    });
  }
});
