import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EditorTabs } from "./editor-tabs";

const tabs = [
  { id: "details", label: "Details", content: <input aria-label="Title" defaultValue="Draft" /> },
  {
    id: "advanced",
    label: "Advanced <options>",
    content: <input aria-label="Tags" defaultValue="Keep" />,
  },
];

describe("manual editor tabs", () => {
  it("links every panel and tab and preserves inactive form controls without duplicate active stops", () => {
    const html = renderToStaticMarkup(
      <EditorTabs label="Video sections" tabs={tabs} value="details" onChange={() => undefined} />,
    );
    expect(html).toContain('role="tablist" aria-label="Video sections"');
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(2);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/hidden=""/g)).toHaveLength(1);
    expect(html).toContain('value="Draft"');
    expect(html).toContain('value="Keep"');
    expect(html).toContain("Advanced &lt;options&gt;");
    const controlled = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((match) => match[1]);
    for (const id of controlled) expect(html).toContain(`id="${id}"`);
    expect(html).not.toContain("<main");
  });
  it("supports RTL and falls back to the first tab for an unavailable selection", () => {
    const html = renderToStaticMarkup(
      <EditorTabs
        label="الأقسام"
        tabs={tabs}
        value="missing"
        direction="rtl"
        onChange={() => undefined}
      />,
    );
    expect(html).toContain('dir="rtl"');
    expect(html).toMatch(/aria-selected="true" tabindex="0"[^>]*>Details/);
  });
});
