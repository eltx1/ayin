import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChannelEditor } from "@/components/channel/channel-editor";
import { CreatorTvManager } from "@/components/creator-tv/creator-tv-manager";
import { PlaylistManager } from "@/components/playlist/playlist-manager";

const editors = [
  { name: "channel", Editor: ChannelEditor },
  { name: "playlists", Editor: PlaylistManager },
  { name: "Creator TV", Editor: CreatorTvManager },
];

// Render actual initial states, without network effects or a second navigation shell.
// Browser regression tests cover the authenticated data-loaded and resized workspaces.
describe("creator editor landmark ownership", () => {
  for (const { name, Editor } of editors) {
    it(`${name} preserves a main landmark on standalone creator routes`, () => {
      const html = renderToStaticMarkup(<Editor />);
      expect(html.match(/<main(?:\s|>)/g)).toHaveLength(1);
      expect(html.match(/<\/main>/g)).toHaveLength(1);
    });

    it(`${name} defers the main landmark to the Studio layout when embedded`, () => {
      const content = renderToStaticMarkup(<Editor embedded />);
      expect(content).not.toMatch(/<main(?:\s|>)/);
      expect(content).not.toContain('role="main"');
      const html = renderToStaticMarkup(
        <main>
          <Editor embedded />
        </main>,
      );
      expect(html.match(/<main(?:\s|>)/g)).toHaveLength(1);
      expect(html.match(/<\/main>/g)).toHaveLength(1);
    });
  }
});
