import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminProductControls } from "./admin-product-controls";
const { readLease } = vi.hoisted(() => ({
  readLease: vi.fn(() => {
    throw new Error("Browser-only lease getter must not run during SSR");
  }),
}));
vi.mock("./admin-access", () => ({
  useAdminAccess: () => ({
    session: null,
    loading: true,
    getScopeLease: readLease,
    subscribeScopeInvalidation: vi.fn(),
    invalidateScope: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock("@/components/i18n/i18n-provider", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
describe("merchandising external lease snapshot", () => {
  it("uses the empty server snapshot without reading browser identity or rendering private controls", () => {
    const html = renderToStaticMarkup(<AdminProductControls />);
    expect(html).toContain("merch.loading");
    expect(html).toContain("hidden");
    expect(html).not.toContain("fieldset");
    expect(readLease).not.toHaveBeenCalled();
  });
});
