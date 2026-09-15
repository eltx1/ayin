import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";

import { ViewerShell } from "./viewer-shell";

describe("AYIN viewer shell", () => {
  it("renders the safe global shell with core navigation before feature flags load", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider locale="en">
        <ViewerShell>
          <main>Shell content</main>
        </ViewerShell>
      </I18nProvider>,
    );

    expect(markup).toContain("AYIN");
    expect(markup).toContain("Home");
    expect(markup).toContain("Search");
    expect(markup).toContain("Shell content");
    expect(markup).not.toContain(">Movies<");
    expect(markup).not.toContain(">Series<");
  });
});
