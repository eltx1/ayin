import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";

import { ViewerShell } from "./viewer-shell";

describe("AYIN viewer shell", () => {
  it("renders the safe global shell with core navigation before feature flags load", () => {
    const shell = createElement(
      ViewerShell,
      null,
      createElement("main", null, "Shell content"),
    );
    const markup = renderToStaticMarkup(
      createElement(I18nProvider, { children: shell, locale: "en" }),
    );

    expect(markup).toContain("AYIN");
    expect(markup).toContain("Home");
    expect(markup).toContain("Search");
    expect(markup).toContain("Shell content");
    expect(markup).not.toContain(">Movies<");
    expect(markup).not.toContain(">Series<");
  });
});
