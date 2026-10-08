import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "./i18n-provider";
import { LocaleSwitcher } from "./locale-switcher";

const route = vi.hoisted(() => ({ pathname: "/clips" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
const render = (placement: "page" | "menu", locale: "en" | "ar") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <LocaleSwitcher placement={placement} />
    </I18nProvider>,
  );

describe("immersive Clips language placement", () => {
  it.each(["/clips", "/ar/clips", "/clips/"])(
    "keeps a single reachable menu switcher for %s",
    (pathname) => {
      route.pathname = pathname;
      expect(render("page", "ar")).toBe("");
      const menu = render("menu", "ar");
      expect(menu).toContain('aria-label="اللغة"');
      expect(menu).toContain('hrefLang="en"');
      expect(menu).toContain('hrefLang="ar"');
      expect(menu).toContain("?lang=en");
      expect(menu).toContain('data-tv-focus-id="locale-menu-en"');
      expect(menu).toContain('data-tv-focus-id="locale-menu-ar"');
      expect(menu).toContain("?lang=ar");
    },
  );
  it("leaves ordinary Viewer route placement unchanged", () => {
    route.pathname = "/browse";
    expect(render("page", "en")).toContain('aria-label="Language"');
    expect(render("menu", "en")).toBe("");
  });
});
