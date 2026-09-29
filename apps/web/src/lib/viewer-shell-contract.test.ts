import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shell = readFileSync(
  new URL("../components/viewer/viewer-shell.module.css", import.meta.url),
  "utf8",
);

describe("shared Viewer shell spacing contract", () => {
  it("keeps the inherited gutter used by existing SSR pages and content rows", () => {
    expect(shell).toMatch(/\.shell\s*\{[^}]*--shell-gutter:\s*var\(--page-gutter\);/);
    const consumers = [
      "../components/viewer/public-directory.module.css",
      "../components/viewer/content-row.module.css",
      "../components/viewer/hero.module.css",
      "../components/viewer/view-states.module.css",
    ];
    for (const file of consumers) {
      expect(readFileSync(new URL(file, import.meta.url), "utf8")).toContain("var(--shell-gutter)");
    }
  });
});
