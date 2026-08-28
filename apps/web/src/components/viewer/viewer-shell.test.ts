import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ViewerShell } from "./viewer-shell";

describe("AYIN viewer shell", () => {
  it("renders the safe global shell with core navigation before feature flags load", () => {
    const markup = renderToStaticMarkup(
      createElement(ViewerShell, null, createElement("main", null, "Shell content")),
    );

    expect(markup).toContain("AYIN");
    expect(markup).toContain("Home");
    expect(markup).toContain("Search");
    expect(markup).toContain("Shell content");
    expect(markup).not.toContain(">Movies<");
    expect(markup).not.toContain(">Series<");
  });
});
