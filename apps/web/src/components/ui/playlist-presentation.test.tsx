import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { PlaylistManager } from "@/components/playlist/playlist-manager";
import { DataTable, PageControls } from "./data-presentation";
import { FormSection } from "./design-system";

describe("playlist library shared presentation semantics", () => {
  it("groups native controls with a legend and retains disabled propagation", () => {
    const html = renderToStaticMarkup(
      <FormSection
        id="playlist-fields-test"
        layout="inline"
        legend="New playlist"
        description="A name and visibility"
        disabled
      >
        <input aria-label="Name" required />
        <button type="submit">Create</button>
      </FormSection>,
    );
    expect(html).toContain("<fieldset");
    expect(html).toContain('disabled=""');
    expect(html).toContain("<legend>New playlist</legend>");
    expect(html).toContain('required=""');
    expect(html).toContain('type="submit"');
    expect(html).not.toContain('role="group"');
    expect(html).toContain('data-layout="inline"');
    expect(html).toContain('aria-describedby="playlist-fields-test-description"');
  });
  it("retains a native caption and headers rather than a fake interactive grid", () => {
    const html = renderToStaticMarkup(
      <DataTable
        caption="Your playlists"
        scrollLabel="Scroll playlists"
        rows={[{ id: "one", name: "Actual title", count: 0 }]}
        rowKey={(row) => row.id}
        columns={[
          { key: "name", heading: "Playlist", rowHeader: true, render: (row) => row.name },
          { key: "count", heading: "Videos", render: (row) => row.count },
        ]}
      />,
    );
    expect(html).toContain("<table");
    expect(html).toContain("<caption>Your playlists</caption>");
    expect(html).toContain('scope="row"');
    expect(html).toContain("<td>0</td>");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Scroll playlists"');
    expect(html).not.toContain('role="grid"');
    expect(html).not.toContain('tabindex="-1"');
  });
  it("uses named native paging controls and an explicit live page status", () => {
    const html = renderToStaticMarkup(
      <PageControls
        label="Pages"
        summary="Page 1 of 2"
        previousLabel="Previous"
        nextLabel="Next"
        hasPrevious={false}
        hasNext
        onPrevious={() => {}}
        onNext={() => {}}
      />,
    );
    expect(html).toContain("<nav");
    expect(html).toContain('role="status">Page 1 of 2');
    expect(html.match(/type="button"/g)).toHaveLength(2);
    expect(html.match(/disabled=""/g)).toHaveLength(1);
  });
  it("does not show invented empty counts or create access before the owned snapshot loads", () => {
    for (const locale of ["en", "ar"] as const) {
      const html = renderToStaticMarkup(
        <I18nProvider locale={locale}>
          <PlaylistManager embedded />
        </I18nProvider>,
      );
      expect(html).toContain("<form");
      expect(html).toContain("<fieldset");
      expect(html).toContain('disabled=""');
      expect(html).toContain(locale === "en" ? "Loading your playlists" : "جارٍ تحميل قوائمك");
      expect(html).not.toContain("<table");
      expect(html).not.toContain("0 playlists");
      expect(html).not.toContain("No playlists yet");
      expect(html).not.toContain("<main");
    }
  });
  it("references existing semantic tokens without an untested second palette", () => {
    const tokens = readFileSync(new URL("../../styles/design-tokens.css", import.meta.url), "utf8");
    const declarations = new Set([...tokens.matchAll(/(--[a-z0-9-]+):/g)].map((match) => match[1]));
    for (const file of [
      "./data-presentation.module.css",
      "../playlist/playlist-library.module.css",
    ]) {
      const css = readFileSync(new URL(file, import.meta.url), "utf8");
      for (const match of css.matchAll(/var\((--[a-z0-9-]+)/g)) {
        expect(declarations.has(match[1]), match[1]).toBe(true);
      }
    }
  });
});
