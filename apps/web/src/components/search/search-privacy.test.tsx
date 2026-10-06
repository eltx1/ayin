import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { SearchBox } from "./search-box";
import { SearchResults } from "./search-results";

const audience = vi.hoisted(() => ({
  identity: null,
  identityRevision: 0,
  audienceStatus: "loading",
  isAudienceCurrent: () => false,
  retryNavigation: vi.fn(),
}));
vi.mock("@/components/viewer/viewer-product-context", () => ({ useViewerProduct: () => audience }));
afterEach(() => vi.unstubAllGlobals());

describe("neutral Search document", () => {
  it.each(["en", "ar"] as const)(
    "renders only the query and neutral loading before %s audience verification",
    (locale) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const markup = renderToStaticMarkup(
        <I18nProvider locale={locale}>
          <SearchBox initialQuery="Journey" />
          <SearchResults query="Journey" />
        </I18nProvider>,
      );
      expect(markup).toContain('value="Journey"');
      expect(markup).toContain('role="status"');
      expect(markup).not.toContain("<ul");
      expect(markup).not.toContain("<section");
      expect(markup).not.toContain("/movies/");
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
