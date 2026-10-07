import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { ClipsClient } from "./clips-client";

const audience = vi.hoisted(() => ({
  identity: null,
  identityRevision: 0,
  audienceStatus: "loading" as "loading" | "ready" | "error",
  isAudienceCurrent: () => false,
  onAudienceInvalidated: vi.fn(),
  retryNavigation: vi.fn(),
}));
vi.mock("@/components/viewer/viewer-product-context", () => ({ useViewerProduct: () => audience }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
beforeEach(() => {
  audience.audienceStatus = "loading";
});

describe("Clips neutral server shell", () => {
  it.each(["en", "ar"] as const)(
    "contains no source, title, clip identifier, or action before %s audience verification",
    (locale) => {
      const html = renderToStaticMarkup(
        <I18nProvider locale={locale}>
          <ClipsClient />
        </I18nProvider>,
      );
      expect(html).toContain('role="status"');
      expect(html).not.toMatch(/<video|<source|data-video-id|data-clip-item|<button|\.mp4/);
    },
  );
  it.each(["en", "ar"] as const)(
    "keeps failed %s audience verification source-free with explicit retry",
    (locale) => {
      audience.audienceStatus = "error";
      const html = renderToStaticMarkup(
        <I18nProvider locale={locale}>
          <ClipsClient />
        </I18nProvider>,
      );
      expect(html).toContain("<button");
      expect(html).not.toMatch(/<video|<source|data-video-id|data-clip-item|\.mp4/);
    },
  );
});
