import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { PageAdLayoutProvider } from "./page-ad-layout-context";
import { PageAdSlot } from "./page-ad-slot";

const slots = [{ key: "home_top", routePatterns: ["/"], mobile: 100, desktop: 90 }];

function render(path: string, key = "home_top") {
  pathname = path;
  return renderToStaticMarkup(
    <PageAdLayoutProvider slots={slots}>
      <PageAdSlot placementKey={key} />
    </PageAdLayoutProvider>,
  );
}

describe("server-rendered ad space", () => {
  it("holds a serving slot's space in the first HTML, per breakpoint", () => {
    const html = render("/");
    expect(html).toContain('data-ad-reserve="home_top"');
    expect(html).toContain("--ad-m:140px");
    expect(html).toContain("--ad-d:130px");
  });

  it("matches localized routes the same as default-locale routes", () => {
    expect(render("/ar")).toContain('data-ad-reserve="home_top"');
  });

  it("reserves nothing for a slot that is off, on another page, or on kids routes", () => {
    expect(render("/", "header_below")).not.toContain("data-ad-reserve");
    expect(render("/search")).not.toContain("data-ad-reserve");
    expect(render("/kids")).toBe("");
  });
});
