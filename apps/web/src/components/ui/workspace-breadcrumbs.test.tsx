import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { studioNavigation } from "@/lib/workspace-navigation";
import { WorkspaceBreadcrumbs } from "./workspace-breadcrumbs";

const route = vi.hoisted(() => ({ pathname: "/studio/content" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

function render(pathname: string, locale: "en" | "ar" = "en") {
  route.pathname = pathname;
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <WorkspaceBreadcrumbs kind="studio" groups={studioNavigation} />
    </I18nProvider>,
  );
}

describe("workspace breadcrumbs", () => {
  it("does not repeat the same group and current page label in either locale", () => {
    for (const [pathname, locale] of [
      ["/studio/content", "en"],
      ["/ar/studio/content", "ar"],
    ] as const) {
      const html = render(pathname, locale);
      expect(html.match(/<li>/g)).toHaveLength(2);
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    }
  });
  it("keeps distinct group labels and generic details without printing internal IDs", () => {
    const html = render("/studio/playlists/sensitive-entity-id");
    expect(html.match(/<li>/g)).toHaveLength(4);
    expect(html).toContain("Content");
    expect(html).toContain("Playlists");
    expect(html).toContain("Details");
    expect(html).not.toContain("sensitive-entity-id");
  });
  it("keeps one current root and localized real navigation links", () => {
    expect(render("/studio").match(/<li>/g)).toHaveLength(1);
    expect(render("/ar/studio/playlists", "ar")).toContain('href="/ar/studio"');
  });
});
