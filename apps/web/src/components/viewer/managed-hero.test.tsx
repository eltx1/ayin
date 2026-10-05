import type { ComponentProps, FocusEvent, FocusEventHandler } from "react";
import type { Hero } from "./hero";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { ManagedHero } from "./managed-hero";

const captured = vi.hoisted(() => ({
  focus: undefined as FocusEventHandler<HTMLElement> | undefined,
}));
vi.mock("./hero", async (importOriginal) => {
  const { Hero: OriginalHero } = await importOriginal<{ Hero: typeof Hero }>();
  return {
    Hero: (props: ComponentProps<typeof Hero>) => {
      captured.focus = props.onFocusCapture;
      return OriginalHero(props);
    },
  };
});

afterEach(() => vi.unstubAllGlobals());

const product = vi.hoisted(() => ({
  controls: null as null | {
    resolvedHero: {
      entityType: string;
      entityId: string;
      title: string;
      description: string | null;
      href: string;
    };
  },
  navigationStatus: "ready",
  retryNavigation: vi.fn(),
}));
vi.mock("./viewer-product-context", () => ({ useViewerProduct: () => product }));
const render = (locale: "en" | "ar" = "ar") =>
  renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <ManagedHero />
    </I18nProvider>,
  );

describe("shared managed hero", () => {
  beforeEach(() => {
    product.controls = null;
    product.navigationStatus = "ready";
  });
  it("localizes fallback copy and search while preserving the on-page discovery anchor", () => {
    const html = render();
    expect(html).toContain("هنا، للحكايات إيقاع مختلف.");
    expect(html).toContain('href="/ar/search"');
    expect(html).toContain('href="#discovery"');
    expect(html).not.toContain("Stories move differently here.");
  });
  it("uses shared resolved content with localized canonical actions and default description", () => {
    product.controls = {
      resolvedHero: {
        entityType: "PLAYLIST",
        entityId: "p1",
        title: "Creator original title",
        description: null,
        href: "/c/creator/playlists/first",
      },
    };
    const html = render();
    expect(html).toContain("Creator original title");
    expect(html).toContain("قائمة تشغيل مميزة");
    expect(html).toContain('href="/ar/c/creator/playlists/first"');
    expect(html).toContain("استكشف قائمة التشغيل");
    expect(html).toContain("اكتشف فيديوهات مختارة من صانع المحتوى.");
  });
  it("preserves server-required Kids context in locale-aware video links", () => {
    product.controls = {
      resolvedHero: {
        entityType: "VIDEO",
        entityId: "v1",
        title: "Kids title",
        description: null,
        href: "/watch/kids-title?kids=1",
      },
    };
    expect(render()).toContain('href="/ar/watch/kids-title?kids=1"');
  });
  it("preserves creator descriptions instead of translating their content", () => {
    product.controls = {
      resolvedHero: {
        entityType: "CHANNEL",
        entityId: "c1",
        title: "Creator name",
        description: "Creator description stays original",
        href: "/c/creator",
      },
    };
    expect(render()).toContain("Creator description stays original");
  });
  it("does not expose stale promoted content while shared controls load or fail", () => {
    product.controls = {
      resolvedHero: {
        entityType: "VIDEO",
        entityId: "v1",
        title: "Stale title",
        description: null,
        href: "/watch/stale",
      },
    };
    product.navigationStatus = "loading";
    const loading = render();
    expect(loading).toContain("جارٍ تحميل المحتوى المميز…");
    expect(loading).not.toContain("Stale title");
    product.navigationStatus = "error";
    const failed = render();
    expect(failed).toContain("تعذر تحميل المحتوى المميز.");
    expect(failed).toContain("إعادة المحاولة");
    expect(failed).not.toContain('href="/ar/watch/stale"');
  });
});

function focusFixture(covered: boolean) {
  render();
  let frame = () => {};
  const target = {
    isConnected: true,
    scrollIntoView: vi.fn(),
    getBoundingClientRect: () => ({ x: 0, width: 100, top: 780, bottom: 832 }),
    contains: (node: unknown) => node === target,
  };
  const document = {
    activeElement: target as unknown,
    elementFromPoint: vi.fn(() => (covered ? {} : target)),
  };
  vi.stubGlobal("window", {
    requestAnimationFrame: (callback: () => void) => {
      frame = callback;
      return 1;
    },
  });
  vi.stubGlobal("document", document);
  captured.focus!({ target } as unknown as FocusEvent<HTMLElement>);
  return { target, document, settle: () => frame() };
}

describe("bounded hero focus visibility", () => {
  it("keeps already uncovered actions stationary", () => {
    const { target, settle } = focusFixture(false);
    settle();
    expect(target.scrollIntoView).not.toHaveBeenCalled();
  });
  it("waits for native focus then reveals an obscured target", () => {
    const { target, settle } = focusFixture(true);
    expect(target.scrollIntoView).not.toHaveBeenCalled();
    settle();
    expect(target.scrollIntoView).toHaveBeenCalledExactlyOnceWith({
      block: "center",
      inline: "nearest",
      behavior: "instant",
    });
  });
  it("does not move a newer focus", () => {
    const { target, document, settle } = focusFixture(true);
    document.activeElement = {};
    settle();
    expect(document.elementFromPoint).not.toHaveBeenCalled();
    expect(target.scrollIntoView).not.toHaveBeenCalled();
  });
  it("does not scroll an unmounted target", () => {
    const { target, settle } = focusFixture(true);
    target.isConnected = false;
    settle();
    expect(target.scrollIntoView).not.toHaveBeenCalled();
  });
});
