import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/i18n/i18n-provider";
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/content" }));
import { AdminAccessProvider, useAdminAccess } from "./admin-access";
import { AdminContentLibrary } from "./admin-content-library";
function Probe() {
  return (
    <span>
      {useAdminAccess().getScopeLease() === null ? "No browser lease" : "Unexpected lease"}
    </span>
  );
}
describe("content import server rendering", () => {
  it("keeps browser-only scope checks safe during actual provider SSR", () => {
    expect(() =>
      renderToStaticMarkup(
        <AdminAccessProvider>
          <Probe />
        </AdminAccessProvider>,
      ),
    ).not.toThrow();
    expect(
      renderToStaticMarkup(
        <AdminAccessProvider>
          <Probe />
        </AdminAccessProvider>,
      ),
    ).toContain("No browser lease");
  });
  it.each(["en", "ar"] as const)(
    "renders %s without exposing unverified native fields",
    (locale) => {
      const html = renderToStaticMarkup(
        <I18nProvider locale={locale}>
          <AdminAccessProvider>
            <AdminContentLibrary requestedChannelId="private-channel" />
          </AdminAccessProvider>
        </I18nProvider>,
      );
      expect(html).toContain(locale === "ar" ? "مكتبة محتوى AYIN" : "AYIN Content Library");
      expect(html).not.toContain("private-channel");
      expect(html).not.toContain("<input");
      expect(html).not.toContain("data-import-private");
    },
  );
});
