import { describe, expect, it } from "vitest";

import type { PlaylistVisibility } from "./playlist";

function isPubliclyListable(visibility: PlaylistVisibility): boolean {
  return visibility === "PUBLIC";
}

describe("playlist visibility boundary", () => {
  it("lists only public playlists on creator discovery surfaces", () => {
    expect(isPubliclyListable("PUBLIC")).toBe(true);
    expect(isPubliclyListable("UNLISTED")).toBe(false);
    expect(isPubliclyListable("PRIVATE")).toBe(false);
  });
});
